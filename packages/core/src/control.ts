import { cloneJsonValue } from "@openturn/json";

import { createReadonlyValue } from "./readonly";
import { createGameTopology } from "./topology";
import type {
  AnyGame,
  GameControlMeta,
  GameControlMetadataEntry,
  GameControlState,
  GameControlSummary,
  GameNodes,
  GamePendingTargetSummary,
  GamePlayers,
  GameSnapshot,
  GameStateContext,
  MatchInput,
} from "./types";

export function collectGamePendingTargets<TMachine extends AnyGame>(
  machine: TMachine,
  path: readonly GameNodes<TMachine>[],
): readonly GameNodes<TMachine>[] {
  const orderedTargets: GameNodes<TMachine>[] = [];
  const seen = new Set<GameNodes<TMachine>>();

  for (const source of [...path].reverse()) {
    for (const transition of machine.transitions) {
      if (transition.from !== source || seen.has(transition.to)) {
        continue;
      }

      seen.add(transition.to);
      orderedTargets.push(transition.to);
    }
  }

  return orderedTargets;
}

export function getGameControlMeta<
  TMachine extends AnyGame,
  TMatch extends MatchInput<GamePlayers<TMachine>>,
>(
  machine: TMachine,
  snapshot: GameSnapshot<
    ReturnType<TMachine["setup"]>,
    any,
    GameNodes<TMachine>,
    TMatch,
    GameControlState<TMachine>
  >,
): GameControlMeta<GameNodes<TMachine>> {
  const stateDefinition = machine.states[snapshot.position.name];
  const context = createStateContext(snapshot);

  return {
    deadline: resolveStateValue(stateDefinition?.deadline, context) ?? snapshot.derived.controlMeta.deadline ?? null,
    label: resolveStateValue(stateDefinition?.label, context) ?? snapshot.derived.controlMeta.label ?? null,
    metadata: cloneJsonValue(
      resolveStateValue(stateDefinition?.metadata, context) ?? snapshot.derived.controlMeta.metadata,
    ) as readonly GameControlMetadataEntry[],
    pendingTargets: [...snapshot.derived.controlMeta.pendingTargets],
  };
}

export function describeGamePendingTargets<
  TMachine extends AnyGame,
  TMatch extends MatchInput<GamePlayers<TMachine>>,
>(
  machine: TMachine,
  snapshot: GameSnapshot<
    ReturnType<TMachine["setup"]>,
    any,
    GameNodes<TMachine>,
    TMatch,
    GameControlState<TMachine>
  >,
): readonly GamePendingTargetSummary<GameNodes<TMachine>>[] {
  const topology = createGameTopology(machine);

  return snapshot.derived.controlMeta.pendingTargets.map((nodeName) => {
    const stateDefinition = machine.states[nodeName];
    const node = topology.nodes[nodeName];
    const context = createStateContext(snapshot, {
      name: nodeName,
      path: [...(node?.path ?? [nodeName])],
    });

    return {
      deadline: resolveStateValue(stateDefinition?.deadline, context) ?? null,
      label: resolveStateValue(stateDefinition?.label, context) ?? null,
      metadata: cloneJsonValue(
        resolveStateValue(stateDefinition?.metadata, context) ?? [],
      ) as readonly GameControlMetadataEntry[],
      node: nodeName,
      path: [...(node?.path ?? [nodeName])],
    };
  });
}

export function getGameControlSummary<
  TMachine extends AnyGame,
  TMatch extends MatchInput<GamePlayers<TMachine>>,
>(
  machine: TMachine,
  snapshot: GameSnapshot<
    ReturnType<TMachine["setup"]>,
    any,
    GameNodes<TMachine>,
    TMatch,
    GameControlState<TMachine>
  >,
): GameControlSummary<TMatch["players"], GameControlState<TMachine>, GameNodes<TMachine>> {
  return {
    activePlayers: [...snapshot.derived.activePlayers],
    control: cloneJsonValue(snapshot.derived.control),
    current: {
      meta: getGameControlMeta(machine, snapshot),
      node: snapshot.position.name,
      path: [...snapshot.position.path],
    },
    pendingTargetDetails: describeGamePendingTargets(machine, snapshot),
  };
}

function createStateContext<
  TMachine extends AnyGame,
  TMatch extends MatchInput<GamePlayers<TMachine>>,
>(
  snapshot: GameSnapshot<
    ReturnType<TMachine["setup"]>,
    any,
    GameNodes<TMachine>,
    TMatch,
    GameControlState<TMachine>
  >,
  positionOverride?: {
    name: GameNodes<TMachine>;
    path: readonly GameNodes<TMachine>[];
  },
): GameStateContext<
  ReturnType<TMachine["setup"]>,
  GameNodes<TMachine>,
  TMatch["players"],
  GameControlState<TMachine>
> {
  type StateContext = GameStateContext<
    ReturnType<TMachine["setup"]>,
    GameNodes<TMachine>,
    TMatch["players"],
    GameControlState<TMachine>
  >;

  const position = {
    name: positionOverride?.name ?? snapshot.position.name as GameNodes<TMachine>,
    path: positionOverride?.path ?? [...snapshot.position.path] as readonly GameNodes<TMachine>[],
    turn: snapshot.position.turn,
  } satisfies StateContext["position"];

  const derivedState = snapshot.derived as StateContext["derived"];

  return {
    G: createReadonlyValue(snapshot.G) as StateContext["G"],
    position,
    derived: derivedState,
    match: cloneJsonValue(snapshot.meta.match) as TMatch,
    now: snapshot.meta.now,
  };
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
