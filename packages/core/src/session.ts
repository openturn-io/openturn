import { cloneJsonValue, parseJsonValue } from "@openturn/json";
import { createRng, resolveRoundRobinTurn, resolveTimeValue, type RngSnapshot } from "./runtime";

import { collectGamePendingTargets } from "./control";
import {
  applyProfileDelta,
  restrictDeltaMapToPlayers,
  validateProfileDelta,
  type GameProfileConfig,
} from "./profile";
import { createReadonlyValue } from "./readonly";
import { createGameTopology, topologyNodeToGraphNode, type GameTopology } from "./topology";
import type {
  AnyGame,
  LocalGameSession,
  LocalGameSessionOptions,
  GameActionRecordFor,
  GameBatch,
  GameControlMeta,
  GameControlMetadataEntry,
  GameControlState,
  GameDerivedState,
  GameErrorResult,
  GameEventContext,
  GameEventInput,
  GameEventRecord,
  GameGraph,
  GameGraphEdge,
  GameNodes,
  GameObservedTransition,
  GamePlayers,
  GamePlayerView,
  GamePublicView,
  GameQueuedEventRecord,
  GameResultState,
  GameRngTrace,
  GameSnapshot,
  GameStateConfig,
  GameStateContext,
  GameTransitionCandidateEvaluation,
  GameTransitionConfig,
  GameTransitionFamilyEvaluation,
  GameTransitionRejection,
  MatchInput,
  PlayerID,
  PlayerList,
  ProfileCommitDeltaMap,
  ProfileDelta,
  ReplayValue,
} from "./types";
import { validateGameDefinition } from "./validation";

type SnapshotFor<
  TMachine extends AnyGame,
  TMatch extends MatchInput<GamePlayers<TMachine>> = MatchInput<GamePlayers<TMachine>>,
> = GameSnapshot<
  ReturnType<TMachine["setup"]>,
  GameResultState<TMachine>,
  GameNodes<TMachine>,
  TMatch,
  GameControlState<TMachine>
>;

type TransitionFor<
  TMachine extends AnyGame,
  TMatch extends MatchInput<GamePlayers<TMachine>>,
> = GameTransitionConfig<
  ReturnType<TMachine["setup"]>,
  TMachine["events"],
  Exclude<GameResultState<TMachine>, null>,
  GameNodes<TMachine>,
  TMatch["players"],
  GameControlState<TMachine>
>;

type EventContextFor<
  TMachine extends AnyGame,
  TMatch extends MatchInput<GamePlayers<TMachine>>,
> = GameEventContext<
  ReturnType<TMachine["setup"]>,
  TMachine["events"],
  GameNodes<TMachine>,
  TMatch["players"],
  GameControlState<TMachine>
>;

type TransitionResolution<TMachine extends AnyGame, TMatch extends MatchInput<GamePlayers<TMachine>>> =
  | {
      enqueued: readonly GameEventInput<TMachine["events"]>[];
      snapshot: SnapshotFor<TMachine, TMatch>;
      transition: GameObservedTransition<GameNodes<TMachine>>;
    }
  | GameErrorResult;

interface EvaluatedTransition<
  TMachine extends AnyGame,
  TMatch extends MatchInput<GamePlayers<TMachine>>,
> {
  evaluation: GameTransitionCandidateEvaluation<GameNodes<TMachine>>;
  matches: boolean;
  rejection: GameTransitionRejection | null;
  result: Exclude<ReturnType<NonNullable<TransitionFor<TMachine, TMatch>["resolve"]>>, GameTransitionRejection> | undefined;
  rng: GameRngTrace | null;
  rngSnapshot: RngSnapshot;
  transition: TransitionFor<TMachine, TMatch>;
}

export function createLocalSession<
  const TMachine extends AnyGame,
  const TMatch extends MatchInput<GamePlayers<TMachine>>,
>(
  machine: TMachine,
  options: LocalGameSessionOptions<TMatch["players"]> & { match: TMatch },
): LocalGameSession<TMachine, TMatch> {
  const topology = createGameTopology(machine);
  const seed = options.seed ?? "default";
  const initialNow = options.now ?? 0;
  const match = hydrateMatchProfiles(
    machine,
    cloneJsonValue(parseJsonValue(options.match, "match")) as unknown as TMatch,
  );
  validateGameDefinition(machine, {
    match,
    now: initialNow,
    seed,
  });
  const initialSnapshot = createInitialSnapshot(machine, topology, match, seed, initialNow);

  return buildLocalSession<TMachine, TMatch>(machine, topology, {
    snapshot: initialSnapshot,
    seed,
    initialNow,
    match,
  });
}

export interface LocalGameSessionFromSnapshotOptions<
  TMachine extends AnyGame,
  TMatch extends MatchInput<GamePlayers<TMachine>>,
> {
  initialNow: number;
  match: TMatch;
  seed: string;
  snapshot: SnapshotFor<TMachine, TMatch>;
  /**
   * Skip the up-front `validateGameDefinition` call. Use this when you know
   * the game definition has already been validated (e.g. when re-hydrating a
   * snapshot for a tight `simulate()` loop). Default: `false`.
   */
  skipValidation?: boolean;
}

export function createLocalSessionFromSnapshot<
  const TMachine extends AnyGame,
  const TMatch extends MatchInput<GamePlayers<TMachine>>,
>(
  machine: TMachine,
  options: LocalGameSessionFromSnapshotOptions<TMachine, TMatch>,
): LocalGameSession<TMachine, TMatch> {
  const topology = createGameTopology(machine);
  const match = hydrateMatchProfiles(
    machine,
    cloneJsonValue(parseJsonValue(options.match, "match")) as unknown as TMatch,
  );
  if (options.skipValidation !== true) {
    validateGameDefinition(machine, {
      match,
      now: options.initialNow,
      seed: options.seed,
    });
  }
  const rehydrated = createSnapshot<TMachine, TMatch>(machine, topology, {
    G: options.snapshot.G,
    position: options.snapshot.position,
    meta: options.snapshot.meta,
  });

  return buildLocalSession<TMachine, TMatch>(machine, topology, {
    snapshot: rehydrated,
    seed: options.seed,
    initialNow: options.initialNow,
    match,
  });
}

interface LocalSessionInputs<
  TMachine extends AnyGame,
  TMatch extends MatchInput<GamePlayers<TMachine>>,
> {
  initialNow: number;
  match: TMatch;
  seed: string;
  snapshot: SnapshotFor<TMachine, TMatch>;
}

function buildLocalSession<
  TMachine extends AnyGame,
  TMatch extends MatchInput<GamePlayers<TMachine>>,
>(
  machine: TMachine,
  topology: GameTopology<GameNodes<TMachine>>,
  inputs: LocalSessionInputs<TMachine, TMatch>,
): LocalGameSession<TMachine, TMatch> {
  const { seed, initialNow, match } = inputs;
  let snapshot = inputs.snapshot;

  const applyEvent: LocalGameSession<TMachine, TMatch>["applyEvent"] = (playerID, event, ...payloadArgs) => {
    const payload = payloadArgs[0];

    if (snapshot.meta.result !== null) {
      return { ok: false, error: "game_over" as const };
    }

    if (!snapshot.meta.match.players.includes(playerID)) {
      return { ok: false, error: "unknown_player" as const };
    }

    if (!snapshot.derived.activePlayers.includes(playerID)) {
      return { ok: false, error: "inactive_player" as const };
    }

    if (!Object.hasOwn(machine.events, event)) {
      return { ok: false, error: "unknown_event" as const };
    }

    if (!isReplayValue(payload)) {
      return { ok: false, error: "non_serializable_args" as const };
    }

    const actionID = createNextActionID(snapshot.meta.log);
    const externalRecord = {
      actionID,
      at: snapshot.meta.now,
      event,
      payload: normalizePayload(payload),
      playerID,
      turn: snapshot.position.turn,
      type: "event",
    } as unknown as GameActionRecordFor<TMachine["events"], TMatch["players"][number]>;
    const batch = applyEventBatch(machine, topology, snapshot, externalRecord, [
      (
        payload === undefined
          ? { kind: event }
          : { kind: event, payload }
      ) as unknown as GameEventInput<TMachine["events"]>,
    ]);

    if (isErrorResult(batch)) {
      return batch;
    }

    snapshot = batch.snapshot as SnapshotFor<TMachine, TMatch>;
    return {
      ok: true,
      batch,
    };
  };

  const dispatch = Object.fromEntries(
    Object.keys(machine.events).map((eventName) => [
      eventName,
      (playerID: TMatch["players"][number], ...payloadArgs: unknown[]) =>
        applyEvent(playerID, eventName as keyof TMachine["events"] & string, ...payloadArgs as never),
    ]),
  ) as unknown as LocalGameSession<TMachine, TMatch>["dispatch"];

  return {
    applyEvent,
    dispatch,
    getGraph() {
      return compileGameGraph(machine);
    },
    getPlayerView(playerID) {
      const context = createRuleContext(snapshot);

      if (machine.views?.player === undefined) {
        return cloneJsonValue(snapshot.G) as GamePlayerView<TMachine>;
      }

      return cloneJsonValue(parseJsonValue(machine.views.player(context, playerID), "player_view")) as GamePlayerView<TMachine>;
    },
    getPublicView() {
      const context = createRuleContext(snapshot);

      if (machine.views?.public === undefined) {
        return cloneJsonValue(snapshot.G) as GamePublicView<TMachine>;
      }

      return cloneJsonValue(parseJsonValue(machine.views.public(context), "public_view")) as GamePublicView<TMachine>;
    },
    getReplayData() {
      return {
        actions: cloneJsonValue(snapshot.meta.log) as GameActionRecordFor<TMachine["events"], TMatch["players"][number]>[],
        initialNow,
        match: cloneJsonValue(match),
        seed,
      };
    },
    getResult() {
      return cloneJsonValue(snapshot.meta.result);
    },
    getState() {
      return cloneJsonValue(snapshot) as SnapshotFor<TMachine, TMatch>;
    },
  };
}

export function compileGameGraph(machine: AnyGame): GameGraph {
  const topology = createGameTopology(machine);

  return {
    initial: machine.initial,
    nodes: Object.values(topology.nodes).map((node) => topologyNodeToGraphNode(node)),
    edges: machine.transitions.map((transition: AnyGame["transitions"][number]): GameGraphEdge => ({
      event: transition.event,
      from: transition.from,
      resolver: describeResolver(transition),
      to: transition.to,
      turn: transition.turn ?? "preserve",
    })),
  };
}

function applyEventBatch<
  TMachine extends AnyGame,
  TMatch extends MatchInput<GamePlayers<TMachine>>,
>(
  machine: TMachine,
  topology: GameTopology<GameNodes<TMachine>>,
  current: SnapshotFor<TMachine, TMatch>,
  actionRecord: GameActionRecordFor<TMachine["events"], TMatch["players"][number]>,
  queue: GameEventInput<TMachine["events"]>[],
): GameBatch<TMachine> | GameErrorResult {
  const steps: Array<GameBatch<TMachine>["steps"][number]> = [];
  let nextSnapshot = current;
  let isFirst = true;

  while (queue.length > 0) {
    const nextInput = queue.shift()!;
    const eventRecord = isFirst
      ? actionRecord
      : {
          actionID: actionRecord.actionID,
          at: nextSnapshot.meta.now,
          event: nextInput.kind,
          payload: normalizePayload(nextInput.payload),
          playerID: null,
          turn: nextSnapshot.position.turn,
          type: "internal",
        } as GameEventRecord<TMachine["events"], TMatch["players"]>;

    const transitionResult = applySingleEvent(machine, topology, nextSnapshot, eventRecord, nextInput, actionRecord.playerID);
    if (isErrorResult(transitionResult)) {
      return transitionResult;
    }

    nextSnapshot = transitionResult.snapshot;
    if (eventRecord.type === "event") {
      steps.push({
        event: eventRecord,
        kind: "action",
        snapshot: structuredClone(nextSnapshot),
        transition: transitionResult.transition,
      });
    } else {
      steps.push({
        event: eventRecord,
        kind: "internal",
        snapshot: structuredClone(nextSnapshot),
        transition: transitionResult.transition,
      });
    }

    for (const enqueued of transitionResult.enqueued) {
      queue.push(enqueued);
    }

    isFirst = false;
  }

  const finalSnapshot: SnapshotFor<TMachine, TMatch> = {
    ...nextSnapshot,
    meta: {
      ...nextSnapshot.meta,
      log: [...nextSnapshot.meta.log, actionRecord],
    },
  };

  if (steps.length > 0) {
    const lastStep = steps[steps.length - 1]!;
    steps[steps.length - 1] = {
      ...lastStep,
      snapshot: structuredClone(finalSnapshot),
    };
  }

  return {
    snapshot: finalSnapshot,
    steps,
  };
}

function applySingleEvent<
  TMachine extends AnyGame,
  TMatch extends MatchInput<GamePlayers<TMachine>>,
>(
  machine: TMachine,
  topology: GameTopology<GameNodes<TMachine>>,
  current: SnapshotFor<TMachine, TMatch>,
  eventRecord: GameEventRecord,
  eventInput: GameEventInput<TMachine["events"]>,
  actingPlayerID: PlayerID,
): TransitionResolution<TMachine, TMatch> {
  const familyEvaluations: GameTransitionFamilyEvaluation<GameNodes<TMachine>>[] = [];
  let selected: EvaluatedTransition<TMachine, TMatch> | null = null;
  let rejected: EvaluatedTransition<TMachine, TMatch> | null = null;

  for (const source of [...current.position.path].reverse()) {
    const transitions = machine.transitions.filter((transition: TMachine["transitions"][number]): transition is TransitionFor<TMachine, TMatch> =>
      transition.from === source && transition.event === eventInput.kind);

    if (transitions.length === 0) {
      continue;
    }

    const evaluated = transitions.map((transition: TransitionFor<TMachine, TMatch>) =>
      evaluateTransition(machine, transition, current, eventInput, eventRecord, actingPlayerID));
    const matching = evaluated.filter((candidate: EvaluatedTransition<TMachine, TMatch>) => candidate.matches);
    familyEvaluations.push({
      event: eventInput.kind,
      from: source,
      matchedTo: matching.length === 1 ? matching[0]!.transition.to : null,
      outcome: matching.length > 1 ? "ambiguous" : matching.length === 1 ? "selected" : "no_match",
      path: [...topology.nodes[source].path],
      transitions: evaluated.map((candidate: EvaluatedTransition<TMachine, TMatch>) => candidate.evaluation),
    });

    if (matching.length > 1) {
      return { ok: false, error: "ambiguous_transition" };
    }

    if (matching.length === 1) {
      selected = matching[0]!;
      break;
    }

    rejected ??= evaluated.find((candidate: EvaluatedTransition<TMachine, TMatch>) => candidate.rejection !== null) ?? null;
  }

  if (selected === null) {
    return rejected?.rejection === null || rejected === null
      ? { ok: false, error: "invalid_event" }
      : {
          ok: false,
          error: "invalid_event",
          ...(rejected.rejection.reason === undefined ? {} : { reason: rejected.rejection.reason }),
          ...(rejected.rejection.details === undefined ? {} : { details: rejected.rejection.details }),
        };
  }

  const selectedResult = selected.result && typeof selected.result === "object" ? selected.result : undefined;
  const transitionOutputError = validateTransitionResult(machine, selectedResult);
  if (transitionOutputError !== null) {
    return transitionOutputError;
  }
  const profileApplication = applyTransitionProfileDelta(
    current.meta.match,
    (selectedResult as { profile?: ProfileCommitDeltaMap } | undefined)?.profile,
  );
  if (!profileApplication.ok) {
    return { ok: false, error: "invalid_transition_result" };
  }
  const nextTurnEffect = selectedResult?.turn ?? selected.transition.turn ?? "preserve";
  const targetNode = topology.nodes[selected.transition.to];
  const nextPosition = {
    name: selected.transition.to,
    path: [...targetNode.path],
    turn: nextTurnEffect === "increment" ? current.position.turn + 1 : current.position.turn,
  };
  const nextSnapshot = createSnapshot<TMachine, TMatch>(machine, topology, {
    G: cloneJsonValue(selectedResult?.G ?? current.G),
    position: nextPosition,
    meta: {
      ...current.meta,
      match: profileApplication.match as TMatch,
      now: eventRecord.at,
      result: ("result" in (selectedResult ?? {}))
        ? ((selectedResult?.result ?? null) as GameResultState<TMachine>)
        : current.meta.result,
      rng: selected.rngSnapshot,
    },
  });
  const enqueued = cloneJsonValue(selectedResult?.enqueue ?? []);

  return {
    enqueued,
    snapshot: nextSnapshot,
    transition: {
      enqueued: enqueued.map((event) => normalizeQueuedEvent(event)),
      event: eventInput.kind,
      evaluations: familyEvaluations,
      from: current.position.name,
      fromPath: [...current.position.path],
      matchedFrom: selected.transition.from,
      matchedFromPath: [...topology.nodes[selected.transition.from].path],
      ...(profileApplication.applied === undefined ? {} : { profile: profileApplication.applied }),
      resolver: describeResolver(selected.transition),
      rng: selected.rng,
      to: selected.transition.to,
      toPath: [...targetNode.path],
      turn: nextTurnEffect,
    },
  };
}

interface ProfileApplicationResult<TMatch extends MatchInput<PlayerList>> {
  applied?: ProfileCommitDeltaMap;
  match: TMatch;
  ok: true;
}

interface ProfileApplicationFailure {
  ok: false;
}

/**
 * Apply a transition's `profile` delta to `match.profiles`. Returns an updated
 * match with mutated profiles, along with the restricted (seated-only) delta
 * that was actually applied. `ok: false` indicates a grammar-valid delta whose
 * ops couldn't apply (e.g. `inc` on a string) — treat as invalid_transition_result.
 */
function applyTransitionProfileDelta<TMatch extends MatchInput<PlayerList>>(
  match: TMatch,
  delta: ProfileCommitDeltaMap | undefined,
): ProfileApplicationResult<TMatch> | ProfileApplicationFailure {
  if (delta === undefined) {
    return { match, ok: true };
  }
  const restricted = restrictDeltaMapToPlayers(match, delta);
  const entries = Object.entries(restricted) as [string, ProfileDelta | undefined][];
  const hadEntries = entries.some(([, ops]) => ops !== undefined);
  if (!hadEntries) {
    return { match, ok: true };
  }
  const profiles: Record<string, ReplayValue> = {
    ...((match.profiles ?? {}) as Record<string, ReplayValue>),
  };
  for (const [playerID, ops] of entries) {
    if (ops === undefined) continue;
    if (!validateProfileDelta(ops)) {
      return { ok: false };
    }
    const current = profiles[playerID] ?? null;
    const applied = applyProfileDelta(current, ops);
    if (!applied.ok) {
      return { ok: false };
    }
    profiles[playerID] = applied.data;
  }
  return {
    applied: restricted,
    match: { ...match, profiles } as TMatch,
    ok: true,
  };
}

function evaluateTransition<
  TMachine extends AnyGame,
  TMatch extends MatchInput<GamePlayers<TMachine>>,
>(
  _machine: TMachine,
  transition: TransitionFor<TMachine, TMatch>,
  snapshot: SnapshotFor<TMachine, TMatch>,
  eventInput: GameEventInput<TMachine["events"]>,
  eventRecord: GameEventRecord,
  actingPlayerID: PlayerID,
): EvaluatedTransition<TMachine, TMatch> {
  if (transition.resolve === undefined) {
    return {
      evaluation: {
        from: transition.from,
        matched: true,
        rejectedBy: null,
        resolver: describeResolver(transition),
        to: transition.to,
      },
      matches: true,
      rejection: null,
      result: undefined,
      rng: null,
      rngSnapshot: snapshot.meta.rng,
      transition,
    };
  }

  const rng = createRng(snapshot.meta.seed, snapshot.meta.rng);
  const before = rng.getSnapshot();
  const context = createEventContext(snapshot, eventInput, eventRecord.playerID ?? actingPlayerID, eventRecord.actionID, rng);
  const output = transition.resolve?.(context);

  if (output === false || output === null || output === undefined) {
    return {
      evaluation: {
        from: transition.from,
        matched: false,
        rejectedBy: "resolver",
        resolver: describeResolver(transition),
        to: transition.to,
      },
      matches: false,
      rejection: null,
      result: output,
      rng: null,
      rngSnapshot: before,
      transition,
    };
  }

  if (isTransitionRejection(output)) {
    return {
      evaluation: {
        ...(output.details === undefined ? {} : { details: output.details }),
        from: transition.from,
        matched: false,
        ...(output.reason === undefined ? {} : { reason: output.reason }),
        rejectedBy: "reject",
        resolver: describeResolver(transition),
        to: transition.to,
      },
      matches: false,
      rejection: output,
      result: undefined,
      rng: null,
      rngSnapshot: before,
      transition,
    };
  }

  const after = rng.getSnapshot();
  return {
    evaluation: {
      from: transition.from,
      matched: true,
      rejectedBy: null,
      resolver: describeResolver(transition),
      to: transition.to,
    },
    matches: true,
    rejection: null,
    result: output,
    rng: after.draws === before.draws
      ? null
      : {
          after: after.state,
          before: before.state,
          draws: after.draws - before.draws,
        },
    rngSnapshot: after,
    transition,
  };
}

function createInitialSnapshot<
  TMachine extends AnyGame,
  TMatch extends MatchInput<GamePlayers<TMachine>>,
>(
  machine: TMachine,
  topology: GameTopology<GameNodes<TMachine>>,
  match: TMatch,
  seed: string,
  now: number,
): SnapshotFor<TMachine, TMatch> {
  const G = machine.setup({ match, now, seed });
  parseJsonValue(G, "setup_state");
  const initialNode = topology.nodes[machine.initial as GameNodes<TMachine>]!;

  return createSnapshot<TMachine, TMatch>(machine, topology, {
    G,
    position: {
      name: machine.initial,
      path: [...initialNode.path],
      turn: 1,
    },
    meta: {
      log: [],
      match,
      now,
      result: null as GameResultState<TMachine>,
      rng: createRng(seed).getSnapshot(),
      seed,
    },
  });
}

function createSnapshot<
  TMachine extends AnyGame,
  TMatch extends MatchInput<GamePlayers<TMachine>>,
>(
  machine: TMachine,
  topology: GameTopology<GameNodes<TMachine>>,
  base: Pick<SnapshotFor<TMachine, TMatch>, "G" | "position" | "meta">,
): SnapshotFor<TMachine, TMatch> {
  const stateContext = createStateContext<TMachine, TMatch>(base);
  const stateDefinition = machine.states[base.position.name];

  if (stateDefinition === undefined) {
    throw new Error(`Game state "${String(base.position.name)}" is not declared.`);
  }

  if (topology.nodes[base.position.name as GameNodes<TMachine>]!.kind !== "leaf") {
    throw new Error(`Game active state "${String(base.position.name)}" must be a leaf node.`);
  }

  if (stateDefinition.activePlayers === undefined) {
    throw new Error(`Game leaf state "${String(base.position.name)}" must declare activePlayers.`);
  }

  const activePlayers = stateDefinition.activePlayers(stateContext);
  const control = stateDefinition.control?.(stateContext) ?? null;
  const selectors = Object.fromEntries(
    Object.entries(machine.selectors ?? {}).map(([key, select]) => [key, select(stateContext)]),
  );
  const controlMeta = createControlMeta(machine, base.position.path, stateDefinition, stateContext);

  return {
    G: cloneJsonValue(base.G),
    position: structuredClone(base.position),
    derived: {
      activePlayers: [...activePlayers],
      control: cloneJsonValue(control),
      controlMeta: cloneJsonValue(controlMeta),
      selectors: cloneJsonValue(selectors),
    },
    meta: cloneJsonValue(base.meta),
  };
}

function createStateContext<
  TMachine extends AnyGame,
  TMatch extends MatchInput<GamePlayers<TMachine>>,
>(
  base: Pick<SnapshotFor<TMachine, TMatch>, "G" | "position" | "meta">,
): GameStateContext<
  ReturnType<TMachine["setup"]>,
  GameNodes<TMachine>,
  TMatch["players"],
  GameControlState<TMachine>
> {
  const emptyDerived: GameDerivedState<TMatch["players"], GameControlState<TMachine>, GameNodes<TMachine>> = {
    activePlayers: [],
    control: null,
    controlMeta: {
      deadline: null,
      label: null,
      metadata: [],
      pendingTargets: [],
    },
    selectors: {},
  };

  return {
    G: createReadonlyValue(base.G),
    position: structuredClone(base.position) as Readonly<SnapshotFor<TMachine, TMatch>["position"]>,
    derived: structuredClone(emptyDerived) as Readonly<
      GameDerivedState<TMatch["players"], GameControlState<TMachine>, GameNodes<TMachine>>
    >,
    match: structuredClone(base.meta.match),
    now: base.meta.now,
  };
}

function createRuleContext<
  TMachine extends AnyGame,
  TMatch extends MatchInput<GamePlayers<TMachine>>,
>(
  snapshot: SnapshotFor<TMachine, TMatch>,
) {
  return {
    G: createReadonlyValue(snapshot.G),
    position: structuredClone(snapshot.position) as Readonly<typeof snapshot.position>,
    derived: structuredClone(snapshot.derived) as Readonly<typeof snapshot.derived>,
    match: structuredClone(snapshot.meta.match),
    now: snapshot.meta.now,
  };
}

function createEventContext<
  TMachine extends AnyGame,
  TMatch extends MatchInput<GamePlayers<TMachine>>,
>(
  snapshot: SnapshotFor<TMachine, TMatch>,
  eventInput: GameEventInput<TMachine["events"]>,
  playerID: PlayerID | null,
  actionID: string,
  rng: ReturnType<typeof createRng>,
): EventContextFor<TMachine, TMatch> {
  return {
    ...createRuleContext<TMachine, TMatch>(snapshot),
    actionID,
    event: {
      kind: eventInput.kind,
      payload: normalizePayload(eventInput.payload) as EventContextFor<TMachine, TMatch>["event"]["payload"],
    },
    playerID,
    rng,
    turn: resolveRoundRobinTurn(snapshot.meta.match.players, snapshot.position.turn),
  };
}

function createControlMeta<
  TMachine extends AnyGame,
  TMatch extends MatchInput<GamePlayers<TMachine>>,
>(
  machine: TMachine,
  path: readonly GameNodes<TMachine>[],
  stateDefinition: GameStateConfig<
    ReturnType<TMachine["setup"]>,
    GameNodes<TMachine>,
    TMatch["players"],
    GameControlState<TMachine>
  >,
  context: GameStateContext<
    ReturnType<TMachine["setup"]>,
    GameNodes<TMachine>,
    TMatch["players"],
    GameControlState<TMachine>
  >,
): GameControlMeta<GameNodes<TMachine>> {
  return {
    deadline: resolveTimeValue(stateDefinition.deadline, context) ?? null,
    label: resolveStateValue(stateDefinition.label, context) ?? null,
    metadata: cloneJsonValue(resolveStateValue(stateDefinition.metadata, context) ?? []) as readonly GameControlMetadataEntry[],
    pendingTargets: collectGamePendingTargets(machine, path),
  };
}

function normalizeQueuedEvent(event: { kind: string; payload?: ReplayValue | undefined }): GameQueuedEventRecord {
  return {
    kind: event.kind,
    payload: normalizePayload(event.payload),
  };
}

function validateTransitionResult(
  machine: AnyGame,
  result: {
    G?: ReplayValue;
    enqueue?: readonly { kind: string; payload?: ReplayValue }[];
    profile?: unknown;
    result?: ReplayValue | null;
    turn?: "increment" | "preserve";
  } | undefined,
): GameErrorResult | null {
  if (result === undefined) {
    return null;
  }

  if ("G" in result && result.G !== undefined && !isReplayValue(result.G)) {
    return { ok: false, error: "invalid_transition_result" };
  }

  if ("result" in result && result.result !== undefined && result.result !== null && !isReplayValue(result.result)) {
    return { ok: false, error: "invalid_transition_result" };
  }

  if ("enqueue" in result && result.enqueue !== undefined) {
    for (const enqueued of result.enqueue) {
      if (!Object.hasOwn(machine.events, enqueued.kind) || !isReplayValue(enqueued.payload)) {
        return { ok: false, error: "invalid_transition_result" };
      }
    }
  }

  if ("profile" in result && result.profile !== undefined) {
    const profile = result.profile;
    if (typeof profile !== "object" || profile === null || Array.isArray(profile)) {
      return { ok: false, error: "invalid_transition_result" };
    }
    for (const ops of Object.values(profile)) {
      if (ops !== undefined && !validateProfileDelta(ops)) {
        return { ok: false, error: "invalid_transition_result" };
      }
    }
  }

  return null;
}

function describeResolver(transition: { label?: string; resolve?: unknown }): string | null {
  if (transition.label !== undefined) {
    return transition.label;
  }

  if (typeof transition.resolve === "function" && transition.resolve.name.length > 0) {
    return `resolver:${transition.resolve.name}`;
  }

  return transition.resolve === undefined ? null : "resolver:inline";
}

function resolveStateValue<TValue, TContext>(
  value: TValue | ((context: TContext) => TValue) | undefined,
  context: TContext,
): TValue | undefined {
  if (typeof value === "function") {
    return (value as (nextContext: TContext) => TValue)(context);
  }

  return value;
}

function createNextActionID(log: readonly { actionID: string }[]): string {
  return `m_${log.length + 1}`;
}

function isErrorResult(value: unknown): value is GameErrorResult {
  return typeof value === "object" && value !== null && "ok" in value && value.ok === false;
}

function isTransitionRejection(value: unknown): value is GameTransitionRejection {
  return typeof value === "object" && value !== null && "kind" in value && value.kind === "reject";
}

function normalizePayload(payload: unknown): ReplayValue | null {
  if (payload === undefined) {
    return null;
  }

  return cloneJsonValue(parseJsonValue(payload, "payload")) as ReplayValue;
}

function isReplayValue(value: unknown): value is ReplayValue | undefined {
  if (value === undefined) {
    return true;
  }

  try {
    parseJsonValue(value, "value");
    return true;
  } catch {
    return false;
  }
}

/**
 * Normalize `match.profiles` for games that declare `profile`: fill in `default`
 * for any seated player missing a profile, and run `parse()` on each entry if
 * the game declared one. Returns a new match (no mutation). Games without a
 * declared profile pass through unchanged.
 */
function hydrateMatchProfiles<
  TMachine extends AnyGame,
  TMatch extends MatchInput<GamePlayers<TMachine>>,
>(machine: TMachine, match: TMatch): TMatch {
  const profileConfig = (machine as { profile?: unknown }).profile as
    | GameProfileConfig<ReplayValue, TMatch["players"], ReplayValue | null>
    | undefined;

  if (profileConfig === undefined) return match;

  const existing = (match.profiles ?? {}) as Record<string, ReplayValue>;
  const resolved: Record<string, ReplayValue> = {};
  const players = match.players as readonly string[];
  for (const playerID of players) {
    const raw = existing[playerID];
    const value = raw === undefined ? cloneJsonValue(profileConfig.default) : raw;
    const parsed = profileConfig.parse === undefined ? value : profileConfig.parse(value);
    resolved[playerID] = cloneJsonValue(parseJsonValue(parsed, `profile:${playerID}`)) as ReplayValue;
  }

  return { ...match, profiles: resolved } as TMatch;
}
