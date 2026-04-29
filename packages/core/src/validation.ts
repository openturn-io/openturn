import { resolveTimeValue } from "./runtime";
import { parseJsonValue } from "@openturn/json";

import { createReadonlyValue } from "./readonly";
import { createGameTopology } from "./topology";
import type {
  AnyGame,
  GameControlMeta,
  GameControlState,
  GameDerivedState,
  GameNodes,
  GameStateContext,
  MatchInput,
  PlayerID,
  ReplayValue,
} from "./types";

export type GameValidationSeverity = "error" | "warning";

export type GameValidationCode =
  | "active_players_duplicate"
  | "active_players_missing"
  | "active_players_unknown"
  | "compound_transition_target"
  | "duplicate_transition_signature"
  | "initial_missing"
  | "initial_non_leaf"
  | "invalid_deadline"
  | "invalid_hierarchy"
  | "invalid_label"
  | "invalid_metadata"
  | "invalid_player_view"
  | "invalid_public_view"
  | "invalid_selector"
  | "invalid_setup_state"
  | "invalid_state_control"
  | "missing_state"
  | "missing_transition_event"
  | "no_states"
  | "state_derivation_failed"
  | "structurally_ambiguous_family"
  | "suspicious_initial_activity"
  | "suspicious_terminal_leaf"
  | "unreachable_state";

export interface GameValidationDiagnostic {
  code: GameValidationCode;
  context?: Readonly<Record<string, ReplayValue>>;
  event?: string;
  from?: string;
  hint?: string;
  message: string;
  severity: GameValidationSeverity;
  state?: string;
  to?: string;
}

export interface GameValidationReportSummary {
  byCode: ReadonlyArray<{
    code: GameValidationCode;
    count: number;
    severity: GameValidationSeverity;
  }>;
  errors: number;
  warnings: number;
}

export interface GameValidationReport {
  diagnostics: readonly GameValidationDiagnostic[];
  ok: boolean;
  summary: GameValidationReportSummary;
}

interface ValidationOptions {
  match?: MatchInput;
  now?: number;
  seed?: string;
}

export class InvalidGameDefinitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidGameDefinitionError";
  }
}

export function getGameValidationReport(
  machine: AnyGame,
  options?: ValidationOptions,
): GameValidationReport {
  const diagnostics: GameValidationDiagnostic[] = [];
  const stateNames = new Set(Object.keys(machine.states));
  const eventNames = new Set(Object.keys(machine.events));

  const pushDiagnostic = (diagnostic: GameValidationDiagnostic) => {
    diagnostics.push(diagnostic);
  };

  if (stateNames.size === 0) {
    pushDiagnostic({
      code: "no_states",
      hint: "Declare at least one leaf state before validating the game.",
      message: "Game must declare at least one state.",
      severity: "error",
    });
  }

  if (!stateNames.has(machine.initial)) {
    pushDiagnostic({
      code: "initial_missing",
      context: { initial: machine.initial },
      message: `Initial state "${machine.initial}" is not declared.`,
      severity: "error",
      state: machine.initial,
    });
  }

  let topology: ReturnType<typeof createGameTopology<typeof machine>> | null = null;

  try {
    topology = createGameTopology(machine);
  } catch (error) {
    pushDiagnostic({
      code: "invalid_hierarchy",
      context: { initial: machine.initial },
      hint: "Fix the parent chain so every referenced parent exists and the hierarchy remains acyclic.",
      message: (error as Error).message,
      severity: "error",
    });
  }

  const initialNode = topology === null ? null : topology.nodes[machine.initial as GameNodes<typeof machine>] ?? null;

  if (initialNode !== null && initialNode.kind !== "leaf") {
    pushDiagnostic({
      code: "initial_non_leaf",
      context: { initial: machine.initial },
      hint: "Point the machine at a leaf state; compound states can structure ancestry but cannot be entered directly.",
      message: `Initial state "${machine.initial}" must be a leaf state.`,
      severity: "error",
      state: machine.initial,
    });
  }

  const outgoingByState = new Map<string, number>();
  const familyIndex = new Map<string, AnyGame["transitions"][number][]>();

  for (const transition of machine.transitions) {
    if (!stateNames.has(transition.from)) {
      pushDiagnostic({
        code: "missing_state",
        context: { direction: "from", event: transition.event },
        from: transition.from,
        message: `Transition source "${transition.from}" is not declared.`,
        severity: "error",
        state: transition.from,
      });
    }

    if (!stateNames.has(transition.to)) {
      pushDiagnostic({
        code: "missing_state",
        context: { direction: "to", event: transition.event },
        message: `Transition target "${transition.to}" is not declared.`,
        severity: "error",
        state: transition.to,
        to: transition.to,
      });
    } else if (topology !== null) {
      const targetNode = topology.nodes[transition.to as GameNodes<typeof machine>]!;

      if (targetNode.kind !== "leaf") {
        pushDiagnostic({
          code: "compound_transition_target",
          context: { targetPath: targetNode.path },
          hint: "Target a concrete leaf state; compound parents exist for fallback matching and grouping only.",
          event: transition.event,
          from: transition.from,
          message: `Transition target "${transition.to}" must be a leaf state.`,
          severity: "error",
          to: transition.to,
        });
      }
    }

    if (!eventNames.has(transition.event)) {
      pushDiagnostic({
        code: "missing_transition_event",
        context: { target: transition.to },
        event: transition.event,
        from: transition.from,
        message: `Transition event "${transition.event}" is not declared.`,
        severity: "error",
      });
    }

    outgoingByState.set(transition.from, (outgoingByState.get(transition.from) ?? 0) + 1);

    const familyKey = `${transition.from}::${transition.event}`;
    const family = familyIndex.get(familyKey) ?? [];
    family.push(transition);
    familyIndex.set(familyKey, family);
  }

  for (const [familyKey, family] of familyIndex) {
    const unconditional = family.filter((transition) => transition.resolve === undefined);

    if (unconditional.length > 1) {
      pushDiagnostic({
        code: "structurally_ambiguous_family",
        context: {
          family: familyKey,
          unconditionalTargets: unconditional.map((transition) => transition.to),
        },
        hint: "Keep at most one unconditional transition in a family or add resolver logic so only one edge can match.",
        from: unconditional[0]?.from,
        event: unconditional[0]?.event,
        message: `Transition family "${familyKey}" contains multiple unconditional edges and is structurally ambiguous.`,
        severity: "error",
      });
    }

    const seen = new Set<string>();

    for (const transition of family) {
      const signature = [
        transition.from,
        transition.event,
        transition.to,
        transition.turn ?? "preserve",
        transition.label ?? describeResolver(transition.resolve),
      ].join("|");

      if (seen.has(signature)) {
        pushDiagnostic({
          code: "duplicate_transition_signature",
          context: { family: familyKey, signature },
          hint: "Remove the duplicate edge or make the branch meaningfully distinct by target, turn effect, or resolver label.",
          event: transition.event,
          from: transition.from,
          message: `Transition family "${familyKey}" contains a duplicate edge signature targeting "${transition.to}".`,
          severity: "error",
          to: transition.to,
        });
      }

      seen.add(signature);
    }
  }

  if (topology !== null && initialNode !== null) {
    const reachable = new Set<string>(initialNode.path);
    const pending = [...initialNode.path];

    while (pending.length > 0) {
      const current = pending.pop()!;

      for (const transition of machine.transitions) {
        if (transition.from !== current || !stateNames.has(transition.to)) {
          continue;
        }

        for (const nodeName of topology.nodes[transition.to as GameNodes<typeof machine>]!.path) {
          if (reachable.has(nodeName)) {
            continue;
          }

          reachable.add(nodeName);
          pending.push(nodeName);
        }
      }
    }

    for (const stateName of stateNames) {
      if (!reachable.has(stateName)) {
        pushDiagnostic({
          code: "unreachable_state",
          context: { initial: machine.initial },
          hint: "Either add a path that can reach this state or remove the dead declaration.",
          message: `State "${stateName}" is unreachable from "${machine.initial}".`,
          severity: "error",
          state: stateName,
        });
      }
    }
  }

  if (options?.match !== undefined && topology !== null && initialNode !== null) {
    collectStateDiagnostics(
      machine,
      topology,
      initialNode,
      outgoingByState,
      {
        match: options.match,
        now: options.now ?? 0,
        seed: options.seed ?? "default",
      },
      pushDiagnostic,
    );
  }

  return {
    diagnostics,
    ok: diagnostics.every((diagnostic) => diagnostic.severity !== "error"),
    summary: summarizeDiagnostics(diagnostics),
  };
}

export function validateGameDefinition(
  machine: AnyGame,
  options?: ValidationOptions,
): void {
  const report = getGameValidationReport(machine, options);
  const failure = report.diagnostics.find((diagnostic) => diagnostic.severity === "error");

  if (failure !== undefined) {
    throw new InvalidGameDefinitionError(failure.message);
  }
}

function collectStateDiagnostics(
  machine: AnyGame,
  topology: ReturnType<typeof createGameTopology<typeof machine>>,
  initialNode: ReturnType<typeof createGameTopology<typeof machine>>["nodes"][GameNodes<typeof machine>],
  outgoingByState: ReadonlyMap<string, number>,
  options: Required<ValidationOptions>,
  pushDiagnostic: (diagnostic: GameValidationDiagnostic) => void,
): void {
  let G: ReturnType<typeof machine.setup>;

  try {
    G = machine.setup({
      match: options.match,
      now: options.now,
      seed: options.seed,
    });
  } catch (error) {
    pushDiagnostic({
      code: "state_derivation_failed",
      hint: "Run setup with the same match/now/seed inputs and keep authoritative outputs replay-pure by using recorded @openturn/runtime inputs only.",
      message: `Machine setup failed during validation: ${(error as Error).message}`,
      severity: "error",
    });
    return;
  }

  if (!isReplayValue(G)) {
    pushDiagnostic({
      code: "invalid_setup_state",
      hint: "Authoritative game state must be replay-safe: null, booleans, numbers, strings, arrays, and plain objects.",
      message: "Machine setup returned non-serializable authoritative state.",
      severity: "error",
    });
    return;
  }

  const emptyDerived: GameDerivedState<typeof options.match.players, GameControlState<typeof machine>, GameNodes<typeof machine>> = {
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
  const baseContext: GameStateContext<
    typeof G,
    GameNodes<typeof machine>,
    typeof options.match.players,
    GameControlState<typeof machine>
  > = {
    G: createReadonlyValue(G),
    position: createReadonlyValue({
      name: machine.initial,
      path: [...initialNode.path],
      turn: 1,
    }),
    derived: createReadonlyValue(emptyDerived),
    match: structuredClone(options.match),
    now: options.now,
  };

  for (const stateName of topology.leafNodes) {
    const state = machine.states[stateName];
    const stateNode = topology.nodes[stateName]!;

    if (state?.activePlayers === undefined) {
      pushDiagnostic({
        code: "active_players_missing",
        hint: "Every leaf state must declare activePlayers explicitly, even when the value is an empty list.",
        message: `Leaf state "${stateName}" must declare activePlayers.`,
        severity: "error",
        state: stateName,
      });
      continue;
    }

    const activePlayers = evaluateStateDerivations(
      machine,
      stateName,
      stateNode.path,
      {
        ...baseContext,
        position: createReadonlyValue({
          name: stateName as GameNodes<typeof machine>,
          path: [...stateNode.path],
          turn: 1,
        }),
      },
      pushDiagnostic,
    );

    if (stateName === machine.initial && activePlayers.length === 0 && hasReachableOutgoing(stateNode.path, outgoingByState)) {
      pushDiagnostic({
        code: "suspicious_initial_activity",
        context: { path: stateNode.path, reachableTransitions: true },
        hint: "If this state should still progress, expose the acting players. If it is terminal, remove the outgoing edge or change the initial state.",
        message: `Initial state "${machine.initial}" derives no active players even though it can transition.`,
        severity: "warning",
        state: machine.initial,
      });
    }

    if (!hasReachableOutgoing(stateNode.path, outgoingByState) && activePlayers.length > 0) {
      pushDiagnostic({
        code: "suspicious_terminal_leaf",
        context: { path: stateNode.path, activePlayers },
        hint: "If this leaf is truly terminal, derive no active players. Otherwise add an outgoing transition on the leaf or one of its parents.",
        message: `State "${stateName}" has no outgoing transitions in its ancestry but still exposes active players.`,
        severity: "warning",
        state: stateName,
      });
    }
  }
}

function evaluateStateDerivations(
  machine: AnyGame,
  stateName: string,
  path: readonly string[],
  context: GameStateContext<any, any, any, any>,
  pushDiagnostic: (diagnostic: GameValidationDiagnostic) => void,
): readonly PlayerID[] {
  const state = machine.states[stateName];

  if (state === undefined) {
    return [];
  }

  try {
    const activePlayers = state.activePlayers?.(context) ?? [];
    assertKnownPlayers(activePlayers, context.match.players, stateName, pushDiagnostic);

    const control = state.control?.(context) ?? null;
    if (control !== null && !isReplayValue(control)) {
      pushDiagnostic({
        code: "invalid_state_control",
        hint: "Return only replay-safe values from control derivations: null, booleans, numbers, strings, arrays, and plain objects.",
        message: `State "${stateName}" derives non-serializable control.`,
        severity: "error",
        state: stateName,
      });
    }

    const deadline = resolveTimeValue(state.deadline, context) ?? null;
    if (deadline !== null && !Number.isFinite(deadline)) {
      pushDiagnostic({
        code: "invalid_deadline",
        hint: "Deadlines must resolve to a finite number or null.",
        message: `State "${stateName}" derives a non-finite deadline.`,
        severity: "error",
        state: stateName,
      });
    }

    const label = resolveStateValue(state.label, context) ?? null;
    if (label !== null && typeof label !== "string") {
      pushDiagnostic({
        code: "invalid_label",
        hint: "State labels must resolve to a string or null so tooling can render them consistently.",
        message: `State "${stateName}" derives a non-string label.`,
        severity: "error",
        state: stateName,
      });
    }

    const metadata = resolveStateValue(state.metadata, context) ?? [];
    if (!metadata.every((entry) => typeof entry.key === "string" && isReplayValue(entry.value))) {
      pushDiagnostic({
        code: "invalid_metadata",
        hint: "Metadata entries must use string keys and replay-safe values.",
        message: `State "${stateName}" derives non-serializable control metadata.`,
        severity: "error",
        state: stateName,
      });
    }

    for (const select of Object.values(machine.selectors ?? {})) {
      const selected = select(context);

      if (!isReplayValue(selected)) {
        pushDiagnostic({
          code: "invalid_selector",
          hint: "Selectors must stay replay-pure and replay-safe so snapshots, protocol payloads, and devtools can serialize them consistently.",
          message: `State "${stateName}" derives a non-serializable selector value.`,
          severity: "error",
          state: stateName,
        });
      }
    }

    const publicView = machine.views?.public?.(context);
    if (publicView !== undefined && !isReplayValue(publicView)) {
      pushDiagnostic({
        code: "invalid_public_view",
        hint: "Public views must derive replay-safe values from snapshot data plus recorded @openturn/runtime inputs only.",
        message: `State "${stateName}" derives a non-serializable public view.`,
        severity: "error",
        state: stateName,
      });
    }

    const playerView = machine.views?.player?.(context, context.match.players[0]!);
    if (playerView !== undefined && !isReplayValue(playerView)) {
      pushDiagnostic({
        code: "invalid_player_view",
        hint: "Player views must derive replay-safe values from snapshot data plus recorded @openturn/runtime inputs only.",
        message: `State "${stateName}" derives a non-serializable player view.`,
        severity: "error",
        state: stateName,
      });
    }

    const controlMeta: GameControlMeta = {
      deadline,
      label,
      metadata,
      pendingTargets: path,
    };
    void controlMeta;

    return activePlayers;
  } catch (error) {
    pushDiagnostic({
      code: "state_derivation_failed",
      hint: "Keep state derivations replay-pure so validation can evaluate them with deterministic @openturn/runtime inputs.",
      message: `State "${stateName}" failed during validation: ${(error as Error).message}`,
      severity: "error",
      state: stateName,
    });
    return [];
  }
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

function hasReachableOutgoing(path: readonly string[], outgoingByState: ReadonlyMap<string, number>): boolean {
  return path.some((nodeName) => (outgoingByState.get(nodeName) ?? 0) > 0);
}

function assertKnownPlayers(
  activePlayers: readonly PlayerID[],
  players: readonly PlayerID[],
  stateName: string,
  pushDiagnostic: (diagnostic: GameValidationDiagnostic) => void,
): void {
  const unique = new Set<PlayerID>();

  for (const playerID of activePlayers) {
    if (!players.includes(playerID)) {
      pushDiagnostic({
        code: "active_players_unknown",
        context: { knownPlayers: players },
        message: `State "${stateName}" derives unknown active player "${playerID}".`,
        severity: "error",
        state: stateName,
      });
    }

    if (unique.has(playerID)) {
      pushDiagnostic({
        code: "active_players_duplicate",
        context: { duplicate: playerID },
        message: `State "${stateName}" derives duplicate active player "${playerID}".`,
        severity: "error",
        state: stateName,
      });
    }

    unique.add(playerID);
  }
}

function isReplayValue(value: unknown): value is ReplayValue {
  try {
    parseJsonValue(value, "value");
    return true;
  } catch {
    return false;
  }
}

function summarizeDiagnostics(
  diagnostics: readonly GameValidationDiagnostic[],
): GameValidationReportSummary {
  const byCode = new Map<GameValidationCode, { count: number; severity: GameValidationSeverity }>();
  let errors = 0;
  let warnings = 0;

  for (const diagnostic of diagnostics) {
    if (diagnostic.severity === "error") {
      errors += 1;
    } else {
      warnings += 1;
    }

    const current = byCode.get(diagnostic.code);

    if (current === undefined) {
      byCode.set(diagnostic.code, {
        count: 1,
        severity: diagnostic.severity,
      });
      continue;
    }

    byCode.set(diagnostic.code, {
      count: current.count + 1,
      severity: current.severity === "error" ? "error" : diagnostic.severity,
    });
  }

  return {
    byCode: [...byCode.entries()].map(([code, value]) => ({
      code,
      count: value.count,
      severity: value.severity,
    })),
    errors,
    warnings,
  };
}

function describeResolver(value: unknown): string | null {
  if (typeof value === "function" && value.name.length > 0) {
    return `resolver:${value.name}`;
  }

  return value === undefined ? null : "resolver:inline";
}
