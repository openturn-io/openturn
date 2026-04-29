import {
  defineGame as defineCoreGame,
  type AnyGame,
  type DeepReadonly,
  type DefaultPlayerIDs,
  type GameDefinition,
  type GameEventContext,
  type GameEventInput,
  type GameProfileConfig,
  type GameRuleContext,
  type LegalAction,
  type LegalActionsResolver,
  type GameStateConfig,
  type GameStateContext,
  type GameTransitionConfig,
  type GameViews,
  type MatchInput,
  type PlayerID,
  type PlayerList,
  type PlayerRecord,
  type ProfileCommitDeltaMap,
  type ProfileMutation,
  type ReplayValue,
  type Serializable,
  profile,
  rejectTransition,
} from "@openturn/core";

/** Local mirror of core's `DefaultPlayerIDsBound` so gamekit's overloads resolve cleanly. */
export type DefaultPlayerIDsBoundLocal<N extends number> =
  DefaultPlayerIDs<N> extends PlayerList ? DefaultPlayerIDs<N> : PlayerList;

function generateDefaultPlayerIDsLocal(maxPlayers: number | undefined): readonly string[] {
  if (maxPlayers === undefined) {
    throw new Error(
      "defineGame: must declare either `maxPlayers` (e.g. `maxPlayers: 4`) or `playerIDs` (e.g. `playerIDs: [\"white\",\"black\"] as const`).",
    );
  }
  if (!Number.isInteger(maxPlayers) || maxPlayers < 1) {
    throw new Error(`defineGame: maxPlayers must be a positive integer, got ${maxPlayers}.`);
  }
  const out: string[] = [];
  for (let i = 0; i < maxPlayers; i++) out.push(String(i));
  return out;
}
import type { JsonValue } from "@openturn/json";
import { resolveRoundRobinTurn, type DeterministicRng, type TurnContext } from "@openturn/core";
import {
  evaluateNumber,
  evaluateValue,
} from "./modifiers";

export type {
  AnyGame,
  DefaultPlayerIDs,
  PlayerIDOf,
} from "@openturn/core";
export { JsonValueSchema, type JsonCompatible, type JsonValue } from "@openturn/json";
export {
  applyProfileCommit,
  applyProfileDelta,
  computeProfileCommit,
  profile,
  validateProfileDelta,
  type ApplyProfileCommitInput,
  type ApplyProfileCommitOutput,
  type Draft,
  type DraftArray,
  type DraftObject,
  type GameProfileCommitContext,
  type GameProfileConfig,
  type ProfileApplyRejectionDetail,
  type ProfileApplyResult,
  type ProfileCommitDeltaMap,
  type ProfileDelta,
  type ProfileMutation,
  type ProfileOp,
  type ProfilePath,
  type ProfilePathInput,
  type LegalAction,
  type LegalActionsResolver,
  type BotDescriptorShape,
  type BotRegistryShape,
} from "@openturn/core";
export type {
  AppliedModifier,
  EvaluateNumberOptions,
  EvaluateValueOptions,
  Modifier,
  ModifierEvaluation,
} from "./modifiers";

export type GamekitResultState = Record<string, JsonValue | undefined> & {
  draw?: true;
  winner?: PlayerID;
};

/**
 * Gamekit-flavored `defineProfile`. Same as core's but defaults `TResult` to
 * `GamekitResultState | null`, so `commit({ result })` has `result.winner`
 * typed without a cast. `TProfile` is inferred from `default`.
 */
export function defineProfile<
  TProfile extends ReplayValue,
  TPlayers extends PlayerList = PlayerList,
  TResult = GamekitResultState | null,
>(
  config: GameProfileConfig<TProfile, TPlayers, TResult>,
): GameProfileConfig<TProfile, TPlayers, TResult> {
  return config;
}

export type GamekitInternalState = Record<string, JsonValue | undefined> & {
  result: GamekitResultState | null;
};

type GamekitAuthorState<TState extends object = Record<string, JsonValue>> =
  TState & { [key: string]: JsonValue };

/**
 * Compile-time guard intersected with `defineGame`'s parameter type. Each
 * arm contributes a `{ openturnError: "<readable message>" }` requirement
 * when its slot fails the JSON-compatibility check. TS surfaces the message
 * directly in the "missing property 'openturnError'" diagnostic — the
 * older `__state_must_be_json_compatible__: never` keys produced opaque
 * "missing branded property" errors that authors had to decode.
 */
type JsonCompatibilityChecks<TState, TPublic, TPlayer> =
  JsonCompatibilityError<TState, "state">
  & JsonCompatibilityError<TPublic, "public view">
  & JsonCompatibilityError<TPlayer, "player view">;

type JsonCompatibilityError<T, TLabel extends string> =
  [Serializable<T>] extends [never]
    ? { openturnError: `'${TLabel}' is not JSON-compatible — remove functions, classes, Maps/Sets, symbols, or undefined property values from the type` }
    : {};

export type GamekitState<TState extends object> = GamekitAuthorState<TState> & {
  __gamekit: GamekitInternalState;
};

export type AnyQueuedEvent = { kind: string; payload?: ReplayValue };

export type { TurnContext } from "@openturn/core";

export interface MovePlayerContext<TPlayerID extends string = string> {
  id: TPlayerID;
}

export interface MovePermissionContext<
  TState extends object,
  TComputed extends Record<string, JsonValue>,
  TPhase extends string = string,
  TPlayers extends readonly PlayerID[] = readonly PlayerID[],
  TProfile extends ReplayValue = ReplayValue,
> {
  C: TComputed;
  G: DeepReadonly<GamekitAuthorState<TState>>;
  phase: TPhase;
  player: MovePlayerContext<TPlayers[number]>;
  /**
   * Per-player profile snapshot. Reflects any profile deltas applied earlier
   * in this match by prior moves. Empty object when the game declares no profile.
   */
  profiles: Readonly<Record<TPlayers[number], TProfile>>;
  rng: DeterministicRng;
  turn: TurnContext<TPlayers[number]>;
}

type GamekitBuiltInNode<TPhase extends string> = TPhase | "__gamekit_finished";
type GamekitNode<TPhase extends string, TCoreNode extends string = never> = GamekitBuiltInNode<TPhase> | TCoreNode;

type MoveOutcome<
  TState extends object,
  TPhase extends string = string,
  TPlayerID extends string = string,
  TQueuedEvent extends { kind: string } = AnyQueuedEvent,
> =
  | { endTurn?: boolean; enqueue?: readonly TQueuedEvent[]; kind: "goto"; patch?: Partial<TState>; phase: TPhase; profile?: ProfileCommitDeltaMap }
  | { details?: JsonValue; enqueue?: readonly TQueuedEvent[]; kind: "invalid"; reason?: string }
  | { enqueue?: readonly TQueuedEvent[]; kind: "stay"; patch?: Partial<TState>; profile?: ProfileCommitDeltaMap }
  | { enqueue?: readonly TQueuedEvent[]; kind: "endTurn"; patch?: Partial<TState>; profile?: ProfileCommitDeltaMap }
  | { enqueue?: readonly TQueuedEvent[]; kind: "finish"; patch?: Partial<TState>; profile?: ProfileCommitDeltaMap; result: GamekitResultState };

interface MoveOutcomeOptions<TQueuedEvent extends { kind: string }> {
  enqueue?: readonly TQueuedEvent[];
  /**
   * Per-player profile deltas applied atomically with this move. Keys not
   * seated in the match are dropped. Use `profile.bind(...).inc/push/set/remove`
   * or `profile.update(...)` to build ops. Apply failures reject the move.
   */
  profile?: ProfileCommitDeltaMap;
}

export interface MoveHelpers<
  TState extends object,
  TPhase extends string = string,
  TPlayerID extends string = string,
  TQueuedEvent extends { kind: string } = AnyQueuedEvent,
> {
  endTurn(
    patch?: Partial<TState>,
    options?: MoveOutcomeOptions<TQueuedEvent>,
  ): MoveOutcome<TState, TPhase, TPlayerID, TQueuedEvent>;
  /**
   * Terminate the match with an arbitrary result record. The conventional
   * `{ winner }` and `{ draw: true }` shapes are typed for ergonomics, but any
   * JSON-compatible record is accepted (multi-winner, ranked, scored, co-op).
   */
  finish(
    result: GamekitResultState & { winner?: TPlayerID },
    patch?: Partial<TState>,
    options?: MoveOutcomeOptions<TQueuedEvent>,
  ): MoveOutcome<TState, TPhase, TPlayerID, TQueuedEvent>;
  goto(
    phase: TPhase,
    patch?: Partial<TState>,
    options?: MoveOutcomeOptions<TQueuedEvent> & { endTurn?: boolean },
  ): MoveOutcome<TState, TPhase, TPlayerID, TQueuedEvent>;
  invalid(reason?: string, details?: JsonValue): MoveOutcome<TState, TPhase, TPlayerID, TQueuedEvent>;
  stay(
    patch?: Partial<TState>,
    options?: MoveOutcomeOptions<TQueuedEvent>,
  ): MoveOutcome<TState, TPhase, TPlayerID, TQueuedEvent>;
}

export interface MoveRunContext<
  TState extends object,
  TComputed extends Record<string, JsonValue>,
  TArgs,
  TPhase extends string = string,
  TPlayers extends readonly PlayerID[] = readonly PlayerID[],
  TQueuedEvent extends { kind: string } = AnyQueuedEvent,
  TProfile extends ReplayValue = ReplayValue,
> extends MovePermissionContext<TState, TComputed, TPhase, TPlayers, TProfile> {
  args: TArgs;
  move: MoveHelpers<TState, TPhase, TPlayers[number], TQueuedEvent>;
  profile: ProfileMutation<TPlayers, TProfile>;
}

export interface GamekitMoveDefinition<
  TState extends object,
  TComputed extends Record<string, JsonValue>,
  TArgs,
  TPhase extends string = string,
  TPlayers extends readonly PlayerID[] = readonly PlayerID[],
  TQueuedEvent extends { kind: string } = AnyQueuedEvent,
  TProfile extends ReplayValue = ReplayValue,
> {
  args?: TArgs;
  canPlayer?: (context: MovePermissionContext<TState, TComputed, TPhase, TPlayers, TProfile>) => boolean;
  phases?: readonly NoInfer<TPhase>[];
  run: (
    context: MoveRunContext<TState, TComputed, TArgs, TPhase, TPlayers, TQueuedEvent, TProfile>,
  ) => MoveOutcome<TState, TPhase, TPlayers[number], TQueuedEvent>;
}

type MoveArgs<TMove> =
  TMove extends { args?: infer TArgs } ? TArgs
    : TMove extends GamekitMoveDefinition<any, any, infer TArgs, any, any> ? TArgs
    : TMove extends { run: (context: infer TContext) => any }
      ? TContext extends { args: infer TArgs }
        ? TArgs
        : never
      : never;

export type ComputedMap<TState extends object, TPhase extends string = string, TPlayers extends readonly PlayerID[] = readonly PlayerID[]> = Record<
  string,
  (context: {
    G: DeepReadonly<GamekitAuthorState<TState>>;
    phase: TPhase;
    turn: TurnContext<TPlayers[number]>;
  }) => JsonValue
>;

type ComputedValues<TComputed extends ComputedMap<any, any, any> | undefined> =
  TComputed extends Record<string, (...args: never[]) => infer TResult>
    ? { [TKey in keyof TComputed]: ReturnType<TComputed[TKey]> }
    : Record<string, JsonValue>;

type GamekitEventMap<TMoves> = {
  [TMoveName in keyof TMoves & string]: MoveArgs<TMoves[TMoveName]>;
};

type GamekitQueuedEvent<TMoves> = GameEventInput<GamekitEventMap<TMoves>>;

type QueueFactory<TMoves> = (
  kind: keyof TMoves & string,
  payload?: ReplayValue,
) => AnyQueuedEvent;

interface BoundMoveDefinitionFactory<
  TState extends object,
  TComputed extends Record<string, ReplayValue>,
  TPhase extends string,
  TPlayers extends readonly PlayerID[],
  TQueuedEvent extends { kind: string },
  TProfile extends ReplayValue = ReplayValue,
> {
  <TArgs = undefined>(
    definition: Omit<GamekitMoveDefinition<TState, TComputed, TArgs, TPhase, TPlayers, TQueuedEvent, TProfile>, "args">
      & { args?: TArgs },
  ): GamekitMoveDefinition<TState, TComputed, TArgs, TPhase, TPlayers, TQueuedEvent, TProfile>;
}

type MoveFactoryInput<
  TState extends object,
  TComputed extends ComputedMap<TState, TPhase, TPlayers> | undefined,
  TPhase extends string,
  TPlayers extends readonly PlayerID[],
  TMoves extends Record<string, GamekitMoveDefinition<TState, any, any, any, TPlayers, AnyQueuedEvent, any>>,
  TProfile extends ReplayValue = ReplayValue,
> = (
  helpers: {
    move: BoundMoveDefinitionFactory<TState, ComputedValues<TComputed>, TPhase, TPlayers, AnyQueuedEvent, TProfile>;
    queue: QueueFactory<TMoves>;
  },
) => TMoves;

type MovesInput<
  TState extends object,
  TComputed extends ComputedMap<TState, TPhase, TPlayers> | undefined,
  TPhase extends string,
  TPlayers extends readonly PlayerID[],
  TMoves extends Record<string, GamekitMoveDefinition<TState, any, any, any, TPlayers, AnyQueuedEvent, any>>,
  TProfile extends ReplayValue = ReplayValue,
> = TMoves | MoveFactoryInput<TState, TComputed, TPhase, TPlayers, TMoves, TProfile>;

type ViewContext<
  TState extends object,
  TComputed extends Record<string, JsonValue>,
  TPhase extends string,
  TPlayers extends readonly PlayerID[],
> = {
  C: TComputed;
  G: DeepReadonly<GamekitAuthorState<TState>>;
  phase: TPhase;
  turn: TurnContext<TPlayers[number]>;
};

export interface TurnPolicy {
  kind: "round_robin";
}

export interface GamekitPhaseConfig<
  TState extends object = Record<string, JsonValue>,
  TComputed extends Record<string, JsonValue> = Record<string, JsonValue>,
  TPhase extends string = string,
  TPlayers extends readonly PlayerID[] = readonly PlayerID[],
> {
  activePlayers?: (context: ViewContext<TState, TComputed, TPhase, TPlayers>) => readonly TPlayers[number][];
  label?: string | ((context: ViewContext<TState, TComputed, TPhase, TPlayers>) => string | null);
}

export interface GamekitViews<
  TState extends object,
  TComputed extends Record<string, ReplayValue>,
  TPhase extends string,
  TPlayers extends readonly PlayerID[],
  TPublic,
  TPlayer,
> {
  player?: (context: ViewContext<TState, TComputed, TPhase, TPlayers>, player: MovePlayerContext<TPlayers[number]>) => TPlayer;
  public?: (context: ViewContext<TState, TComputed, TPhase, TPlayers>) => TPublic;
}

type GamekitCoreRuleContext<TState extends object, TNode extends string, TPlayers extends PlayerList> =
  Omit<GameRuleContext<GamekitState<TState>, TNode, TPlayers, ReplayValue>, "G"> & {
    G: DeepReadonly<GamekitAuthorState<TState>>;
  };

type GamekitCoreStateContext<TState extends object, TNode extends string, TPlayers extends PlayerList> =
  Omit<GameStateContext<GamekitState<TState>, TNode, TPlayers, ReplayValue>, "G"> & {
    G: DeepReadonly<GamekitAuthorState<TState>>;
  };

type GamekitCoreStateConfig<TState extends object, TNode extends string, TPlayers extends PlayerList> = Omit<
  GameStateConfig<GamekitState<TState>, TNode, TPlayers, ReplayValue>,
  "activePlayers" | "control" | "deadline" | "label" | "metadata"
> & {
  activePlayers?: (
    context: GamekitCoreStateContext<TState, TNode, TPlayers>,
  ) => readonly TPlayers[number][];
  control?: (
    context: GamekitCoreStateContext<TState, TNode, TPlayers>,
  ) => ReplayValue;
  deadline?:
    | number
    | null
    | ((context: GamekitCoreStateContext<TState, TNode, TPlayers>) => number | null);
  label?:
    | string
    | null
    | ((context: GamekitCoreStateContext<TState, TNode, TPlayers>) => string | null);
  metadata?:
    | readonly { key: string; value: ReplayValue }[]
    | ((context: GamekitCoreStateContext<TState, TNode, TPlayers>) => readonly { key: string; value: ReplayValue }[]);
};

type GamekitCoreViews<TState extends object, TPlayers extends PlayerList> = {
  player?: (
    context: GamekitCoreRuleContext<TState, string, TPlayers>,
    playerID: TPlayers[number],
  ) => unknown;
  public?: (
    context: GamekitCoreRuleContext<TState, string, TPlayers>,
  ) => unknown;
};

type GamekitCoreDefinition<
  TState extends object,
  TMoves extends Record<string, GamekitMoveDefinition<TState, any, any, any, any, AnyQueuedEvent, any>>,
  TPlayers extends PlayerList,
  TPhase extends string,
  TCoreNode extends string = never,
> = {
  initial?: GamekitNode<TPhase, TCoreNode>;
  selectors?: Record<
    string,
    (context: GamekitCoreRuleContext<TState, GamekitNode<TPhase, TCoreNode>, TPlayers>) => ReplayValue
  >;
  states?: Record<TCoreNode, GamekitCoreStateConfig<TState, GamekitNode<TPhase, TCoreNode>, TPlayers>>;
  transitions?: readonly GameTransitionConfig<
    GamekitState<TState>,
    GamekitEventMap<TMoves>,
    GamekitResultState,
    GamekitNode<TPhase, TCoreNode>,
    TPlayers,
    ReplayValue
  >[];
  views?: {
    player?: (
      context: GamekitCoreRuleContext<TState, GamekitNode<TPhase, TCoreNode>, TPlayers>,
      playerID: TPlayers[number],
    ) => unknown;
    public?: (
      context: GamekitCoreRuleContext<TState, GamekitNode<TPhase, TCoreNode>, TPlayers>,
    ) => unknown;
  };
};

export interface GamekitDefinition<
  TState extends object,
  TMoves extends Record<string, GamekitMoveDefinition<TState, any, any, any, TPlayers, AnyQueuedEvent, any>>,
  TPhase extends string = "play",
  TPlayers extends PlayerList = PlayerList,
  TComputed extends ComputedMap<TState, TPhase, TPlayers> | undefined = ComputedMap<TState, TPhase, TPlayers> | undefined,
  TPublic = TState,
  TPlayer = TPublic,
  TCoreNode extends string = never,
  TProfile extends ReplayValue = ReplayValue,
> {
  /**
   * Player pool. Pass `maxPlayers: N` for default IDs `"0",..,"N-1"`, or
   * `playerIDs` for named seats (e.g. `["white","black"] as const`). Exactly
   * one of the two must be provided.
   */
  playerIDs?: TPlayers;
  /** Number of seats. Use this for unnamed seats; the framework generates `"0",..,"N-1"`. */
  maxPlayers?: number;
  /** Lower bound on seated players for `lobby:start` to succeed. Defaults to the player pool size. */
  minPlayers?: number;
  computed?: TComputed;
  core?: GamekitCoreDefinition<TState, TMoves, TPlayers, TPhase, TCoreNode>;
  initialPhase?: NoInfer<TPhase>;
  /**
   * Optional enumerator that surfaces legal moves for a given seat to the
   * `@openturn/bot` runtime. The engine never reads this field. Authors
   * who don't ship AI bots can omit it. The context exposes the author's
   * `G` (the same shape `views` and moves see), not the gamekit-wrapped
   * internal state.
   */
  legalActions?: (
    context: GamekitCoreRuleContext<TState, GamekitNode<TPhase, TCoreNode>, TPlayers>,
    playerID: TPlayers[number],
  ) => readonly LegalAction[];
  moves: MovesInput<TState, TComputed, TPhase, TPlayers, TMoves, TProfile>;
  phases?: Record<TPhase, GamekitPhaseConfig<TState, ComputedValues<TComputed>, TPhase, TPlayers>>;
  /**
   * Persistent per-player state, hydrated into `match.profiles` before setup and
   * mutated via `profile.commit` after the match terminates. Use gamekit's
   * `defineProfile({...})` to declare one — `TProfile` is inferred from
   * `default`, and `commit`'s `result` is typed as `GamekitResultState | null`.
   */
  profile?: GameProfileConfig<TProfile, TPlayers, GamekitResultState | null>;
  setup: (context: GamekitSetupContext<TPlayers, TProfile>) => TState;
  turn?: TurnPolicy;
  views?: GamekitViews<TState, ComputedValues<TComputed>, TPhase, TPlayers, TPublic, TPlayer>;
}

export interface GamekitSetupContext<
  TPlayers extends PlayerList = PlayerList,
  TProfile extends ReplayValue = ReplayValue,
> {
  match: MatchInput<TPlayers>;
  now: number;
  /**
   * Per-player profile snapshot, hydrated with defaults for any seated player
   * who had no stored profile. Empty object when the game declares no profile.
   */
  profiles: Readonly<PlayerRecord<TPlayers, TProfile>>;
  seed: string;
}

export type CoreGameDefinitionFor<
  TState extends object,
  TMoves extends Record<string, GamekitMoveDefinition<any, any, any, any, any, AnyQueuedEvent, any>>,
  TPlayers extends PlayerList,
  TPhase extends string,
  TPublic,
  TPlayer,
  TCoreNode extends string = never,
> = GameDefinition<
  GamekitState<TState>,
  GamekitEventMap<TMoves>,
  GamekitResultState,
  TPlayers,
  GamekitNode<TPhase, TCoreNode>,
  TPublic,
  TPlayer,
  ReplayValue
>;

export const modifiers = {
  evaluateNumber,
  evaluateValue,
};

export const permissions = {
  currentPlayer<TState extends object, TComputed extends Record<string, ReplayValue>, TPhase extends string, TPlayers extends readonly PlayerID[]>(
    context: MovePermissionContext<TState, TComputed, TPhase, TPlayers>,
  ): boolean {
    return context.player.id === context.turn.currentPlayer;
  },
};

export const turn = {
  roundRobin(): TurnPolicy {
    return { kind: "round_robin" };
  },
};

export function defineMoves<
  const TMoves extends Record<string, GamekitMoveDefinition<any, any, any, any, any, any, any>>,
>(moves: TMoves): TMoves {
  return moves;
}

export const view = {
  computed<
    TComputed extends Record<string, JsonValue>,
    const TKeys extends readonly (keyof TComputed)[],
  >(
    context: { C: TComputed },
    ...keys: TKeys
  ): Pick<TComputed, TKeys[number]> {
    return Object.fromEntries(keys.map((key) => [key, context.C[key]])) as Pick<TComputed, TKeys[number]>;
  },
  merge<
    TView extends object,
    TComputed extends Record<string, JsonValue>,
    const TKeys extends readonly (keyof TComputed)[],
  >(
    base: TView,
    context: { C: TComputed },
    ...keys: TKeys
  ): TView & Pick<TComputed, TKeys[number]> {
    return {
      ...base,
      ...view.computed(context, ...keys),
    };
  },
};

interface MoveDefinitionFactory {
  <
  TArgs = undefined,
  TState extends object = Record<string, JsonValue>,
  TComputed extends Record<string, ReplayValue> = Record<string, ReplayValue>,
  TPhase extends string = string,
  TPlayers extends readonly PlayerID[] = readonly PlayerID[],
  TQueuedEvent extends { kind: string } = never,
  >(
    definition: Omit<GamekitMoveDefinition<TState, TComputed, TArgs, TPhase, TPlayers, TQueuedEvent>, "args">
      & { args?: TArgs },
  ): GamekitMoveDefinition<TState, TComputed, TArgs, TPhase, TPlayers, TQueuedEvent>;
  args<TArgs>(): TArgs;
  withArgs<TArgs>(): <
    TState extends object,
    TComputed extends Record<string, ReplayValue>,
    TPhase extends string = string,
    TPlayers extends readonly PlayerID[] = readonly PlayerID[],
    TQueuedEvent extends { kind: string } = never,
  >(
    definition: Omit<GamekitMoveDefinition<TState, TComputed, TArgs, TPhase, TPlayers, TQueuedEvent>, "args">,
  ) => GamekitMoveDefinition<TState, TComputed, TArgs, TPhase, TPlayers, TQueuedEvent>;
}

export const move: MoveDefinitionFactory = Object.assign(
  function move<
    TArgs = undefined,
    TState extends object = Record<string, JsonValue>,
    TComputed extends Record<string, ReplayValue> = Record<string, ReplayValue>,
    TPhase extends string = string,
    TPlayers extends readonly PlayerID[] = readonly PlayerID[],
    TQueuedEvent extends { kind: string } = never,
  >(
    definition: Omit<GamekitMoveDefinition<TState, TComputed, TArgs, TPhase, TPlayers, TQueuedEvent>, "args">
      & { args?: TArgs },
  ): GamekitMoveDefinition<TState, TComputed, TArgs, TPhase, TPlayers, TQueuedEvent> {
    return definition as GamekitMoveDefinition<TState, TComputed, TArgs, TPhase, TPlayers, TQueuedEvent>;
  },
  {
    args<TArgs>(): TArgs {
      return undefined as TArgs;
    },
    withArgs<TArgs>() {
      return function moveWithArgs<
        TState extends object,
        TComputed extends Record<string, ReplayValue>,
        TPhase extends string = string,
        TPlayers extends readonly PlayerID[] = readonly PlayerID[],
        TQueuedEvent extends { kind: string } = never,
      >(
        definition: Omit<GamekitMoveDefinition<TState, TComputed, TArgs, TPhase, TPlayers, TQueuedEvent>, "args">,
      ): GamekitMoveDefinition<TState, TComputed, TArgs, TPhase, TPlayers, TQueuedEvent> {
        return definition as GamekitMoveDefinition<TState, TComputed, TArgs, TPhase, TPlayers, TQueuedEvent>;
      };
    },
  },
);

function createBoundMoveFactory<
  TState extends object,
  TComputed extends Record<string, ReplayValue>,
  TPhase extends string,
  TPlayers extends readonly PlayerID[],
  TQueuedEvent extends { kind: string },
  TProfile extends ReplayValue = ReplayValue,
>(): BoundMoveDefinitionFactory<TState, TComputed, TPhase, TPlayers, TQueuedEvent, TProfile> {
  return (<TArgs = undefined>(
    definition: Omit<GamekitMoveDefinition<TState, TComputed, TArgs, TPhase, TPlayers, TQueuedEvent, TProfile>, "args">
      & { args?: TArgs },
  ) => definition as GamekitMoveDefinition<TState, TComputed, TArgs, TPhase, TPlayers, TQueuedEvent, TProfile>) satisfies BoundMoveDefinitionFactory<
    TState,
    TComputed,
    TPhase,
    TPlayers,
    TQueuedEvent,
    TProfile
  >;
}

function createQueueFactory<
  TMoves extends Record<string, GamekitMoveDefinition<any, any, any, any, any, any, any>>,
>(): QueueFactory<TMoves> {
  return ((kind: string, payload?: unknown) =>
    payload === undefined
      ? { kind }
      : { kind, payload }) as QueueFactory<TMoves>;
}

// ---- maxPlayers form (default IDs "0".."N-1"; preferred for unnamed seats) ----
export function defineGame<
  TState extends object,
  TMoves extends Record<string, GamekitMoveDefinition<TState, any, any, any, TPlayers, AnyQueuedEvent, any>>,
  const TMaxPlayers extends number,
  TPhase extends string = "play",
  TPlayers extends PlayerList = DefaultPlayerIDsBoundLocal<TMaxPlayers>,
  TComputed extends ComputedMap<TState, TPhase, TPlayers> | undefined = ComputedMap<TState, TPhase, TPlayers> | undefined,
  TPublic = TState,
  TPlayer = TPublic,
  TCoreNode extends string = never,
  TProfile extends ReplayValue = ReplayValue,
>(
  definition: Omit<GamekitDefinition<TState, TMoves, TPhase, TPlayers, TComputed, TPublic, TPlayer, TCoreNode, TProfile>, "playerIDs" | "maxPlayers">
    & { maxPlayers: TMaxPlayers }
    & JsonCompatibilityChecks<TState, TPublic, TPlayer>,
): CoreGameDefinitionFor<TState, TMoves, TPlayers, TPhase, TPublic, TPlayer, TCoreNode>;
// ---- playerIDs form (named seats; opt-in) ----
export function defineGame<
  TState extends object,
  TMoves extends Record<string, GamekitMoveDefinition<TState, any, any, any, TPlayers, AnyQueuedEvent, any>>,
  const TPlayers extends PlayerList,
  TPhase extends string = "play",
  TComputed extends ComputedMap<TState, TPhase, TPlayers> | undefined = ComputedMap<TState, TPhase, TPlayers> | undefined,
  TPublic = TState,
  TPlayer = TPublic,
  TCoreNode extends string = never,
  TProfile extends ReplayValue = ReplayValue,
>(
  definition: Omit<GamekitDefinition<TState, TMoves, TPhase, TPlayers, TComputed, TPublic, TPlayer, TCoreNode, TProfile>, "playerIDs" | "maxPlayers">
    & { playerIDs: TPlayers }
    & JsonCompatibilityChecks<TState, TPublic, TPlayer>,
): CoreGameDefinitionFor<TState, TMoves, TPlayers, TPhase, TPublic, TPlayer, TCoreNode>;
// ---- pre-typed form (consumed by `withPlugins(...)` and similar wrappers) ----
//
// Accepts a fully-typed `GamekitDefinition` whose `maxPlayers` / `playerIDs`
// remain optional at the type level. Hand-authored game files should prefer
// the literal forms above; this overload exists so composition primitives can
// hand `defineGame` a definition without having to thread the literal capacity
// type back up through their own generics.
export function defineGame<
  TState extends object,
  TMoves extends Record<string, GamekitMoveDefinition<TState, any, any, any, TPlayers, AnyQueuedEvent, any>>,
  TPhase extends string = "play",
  TPlayers extends PlayerList = PlayerList,
  TComputed extends ComputedMap<TState, TPhase, TPlayers> | undefined = ComputedMap<TState, TPhase, TPlayers> | undefined,
  TPublic = TState,
  TPlayer = TPublic,
  TCoreNode extends string = never,
  TProfile extends ReplayValue = ReplayValue,
>(
  definition: GamekitDefinition<TState, TMoves, TPhase, TPlayers, TComputed, TPublic, TPlayer, TCoreNode, TProfile>
    & JsonCompatibilityChecks<TState, TPublic, TPlayer>,
): CoreGameDefinitionFor<TState, TMoves, TPlayers, TPhase, TPublic, TPlayer, TCoreNode>;
export function defineGame<
  TState extends object,
  TMoves extends Record<string, GamekitMoveDefinition<TState, any, any, any, TPlayers, AnyQueuedEvent, any>>,
  TPhase extends string = "play",
  TPlayers extends PlayerList = PlayerList,
  TComputed extends ComputedMap<TState, TPhase, TPlayers> | undefined = ComputedMap<TState, TPhase, TPlayers> | undefined,
  TPublic = TState,
  TPlayer = TPublic,
  TCoreNode extends string = never,
  TProfile extends ReplayValue = ReplayValue,
>(
  definition: GamekitDefinition<TState, TMoves, TPhase, TPlayers, TComputed, TPublic, TPlayer, TCoreNode, TProfile>
    & JsonCompatibilityChecks<TState, TPublic, TPlayer>,
): CoreGameDefinitionFor<TState, TMoves, TPlayers, TPhase, TPublic, TPlayer, TCoreNode> {
  const capacityInput = definition as unknown as {
    playerIDs?: TPlayers;
    maxPlayers?: number;
    minPlayers?: number;
  };
  const explicitPlayerIDs = capacityInput.playerIDs;
  const playerIDs = (explicitPlayerIDs ?? generateDefaultPlayerIDsLocal(capacityInput.maxPlayers)) as TPlayers;
  const minPlayers = capacityInput.minPlayers ?? playerIDs.length;
  const moves = typeof definition.moves === "function"
    ? definition.moves({
      move: createBoundMoveFactory<TState, ComputedValues<TComputed>, TPhase, TPlayers, AnyQueuedEvent, TProfile>(),
      queue: createQueueFactory<TMoves>(),
    })
    : definition.moves;
  const turnPolicy = definition.turn ?? turn.roundRobin();
  const phaseNames = resolvePhaseNames({
    ...(definition.initialPhase === undefined ? {} : { initialPhase: definition.initialPhase }),
    ...(definition.phases === undefined ? {} : { phases: definition.phases }),
    moves,
  }) as TPhase[];
  const initialPhase = definition.initialPhase ?? phaseNames[0] ?? ("play" as TPhase);
  const states: Partial<Record<GamekitNode<TPhase, TCoreNode>, GameStateConfig<
    GamekitState<TState>,
    GamekitNode<TPhase, TCoreNode>,
    TPlayers,
    ReplayValue
  >>> = {};
  states.__gamekit_finished = {
    activePlayers: () => [],
    label: "Finished",
  };

  for (const phase of phaseNames) {
    const phaseConfig = definition.phases?.[phase];
    states[phase] = {
      activePlayers: (context) => {
        if (phaseConfig?.activePlayers !== undefined) {
          return phaseConfig.activePlayers(createPhaseContext(definition, turnPolicy, context, phase));
        }

        return [resolveTurn(turnPolicy, context.match.players, context.position.turn).currentPlayer];
      },
      label: (context) => {
        if (typeof phaseConfig?.label === "function") {
          return phaseConfig.label(createPhaseContext(definition, turnPolicy, context, phase));
        }

        return phaseConfig?.label ?? phase;
      },
    };
  }

  const transitions: Array<GameTransitionConfig<
    GamekitState<TState>,
    GamekitEventMap<TMoves>,
    GamekitResultState,
    GamekitNode<TPhase, TCoreNode>,
    TPlayers,
    ReplayValue
  >> = [];
  const eventShapes: Record<string, ReplayValue> = {};

  for (const [moveName, moveDefinition] of Object.entries(moves)) {
    const allowedPhases = (moveDefinition.phases as readonly TPhase[] | undefined) ?? phaseNames;
    const runMove = (
      context: GameEventContext<
        GamekitState<TState>,
        Record<string, ReplayValue>,
        GamekitNode<TPhase, TCoreNode>,
        TPlayers,
        ReplayValue
      >,
    ) => {
      const phase = context.position.name as TPhase;
      const turnContext = resolveTurn(turnPolicy, context.match.players, context.position.turn);
      const currentState = stripInternalState(context.G);
      const computed = computeComputedValues(definition.computed, currentState, phase, turnContext) as ComputedValues<
        TComputed
      >;
      const permissionContext: MovePermissionContext<TState, ComputedValues<TComputed>, TPhase, TPlayers, TProfile> = {
        C: computed,
        G: currentState,
        phase,
        player: { id: context.playerID as TPlayers[number] },
        profiles: (context.match.profiles ?? {}) as Readonly<Record<TPlayers[number], TProfile>>,
        rng: context.rng,
        turn: turnContext,
      };

      if (moveDefinition.canPlayer !== undefined && !moveDefinition.canPlayer(permissionContext as never)) {
        return null;
      }

      const args = (context.event.payload === null ? undefined : context.event.payload) as MoveArgs<typeof moveDefinition>;
      const outcome = moveDefinition.run({
        ...permissionContext,
        args,
        move: createMoveHelpers<TState, TPhase, TPlayers[number], GamekitQueuedEvent<TMoves>>(),
        profile: profile.bind(
          (context.match.profiles ?? {}) as PlayerRecord<TPlayers, TProfile>,
        ),
      } as never);

      if (outcome.kind === "invalid") {
        return rejectTransition(outcome.reason, outcome.details);
      }

      return outcome;
    };

    eventShapes[moveName] = (moveDefinition.args ?? null) as ReplayValue;

    for (const phase of allowedPhases) {
      transitions.push(
        {
          event: moveName,
          from: phase,
          label: `${moveName}:${phase}:stay`,
          resolve: (
            context: GameEventContext<
              GamekitState<TState>,
              GamekitEventMap<TMoves>,
              GamekitNode<TPhase, TCoreNode>,
              TPlayers,
              ReplayValue
            >,
          ) => {
            const outcome = runMove(context);

            if (outcome === null) {
              return null;
            }

            if (isRejectedOutcome(outcome)) {
              return outcome;
            }

            return outcome.kind === "stay" || (outcome.kind === "goto" && outcome.phase === phase && outcome.endTurn !== true)
              ? createTransitionResult(
                context.G,
                outcome as MoveOutcome<TState, TPhase, TPlayers[number], GamekitQueuedEvent<TMoves>>,
              )
              : null;
          },
          to: phase,
          turn: "preserve",
        },
        {
          event: moveName,
          from: phase,
          label: `${moveName}:${phase}:end_turn`,
          resolve: (
            context: GameEventContext<
              GamekitState<TState>,
              GamekitEventMap<TMoves>,
              GamekitNode<TPhase, TCoreNode>,
              TPlayers,
              ReplayValue
            >,
          ) => {
            const outcome = runMove(context);

            if (outcome === null) {
              return null;
            }

            if (isRejectedOutcome(outcome)) {
              return outcome;
            }

            return outcome.kind === "endTurn" || (outcome.kind === "goto" && outcome.phase === phase && outcome.endTurn === true)
              ? createTransitionResult(
                context.G,
                outcome as MoveOutcome<TState, TPhase, TPlayers[number], GamekitQueuedEvent<TMoves>>,
                "increment",
              )
              : null;
          },
          to: phase,
          turn: "increment",
        },
      );

      for (const targetPhase of phaseNames) {
        if (targetPhase === phase) {
          continue;
        }

        transitions.push(
          {
            event: moveName,
            from: phase,
            label: `${moveName}:${phase}:goto:${targetPhase}`,
            resolve: (
              context: GameEventContext<
                GamekitState<TState>,
                GamekitEventMap<TMoves>,
                GamekitNode<TPhase, TCoreNode>,
                TPlayers,
                ReplayValue
              >,
            ) => {
              const outcome = runMove(context);

              if (outcome === null) {
                return null;
              }

              if (isRejectedOutcome(outcome)) {
                return outcome;
              }

              return outcome.kind === "goto" && outcome.phase === targetPhase && outcome.endTurn !== true
                ? createTransitionResult(
                  context.G,
                  outcome as MoveOutcome<TState, TPhase, TPlayers[number], GamekitQueuedEvent<TMoves>>,
                )
                : null;
            },
            to: targetPhase,
            turn: "preserve",
          },
          {
            event: moveName,
            from: phase,
            label: `${moveName}:${phase}:goto:${targetPhase}:end_turn`,
            resolve: (
              context: GameEventContext<
                GamekitState<TState>,
                GamekitEventMap<TMoves>,
                GamekitNode<TPhase, TCoreNode>,
                TPlayers,
                ReplayValue
              >,
            ) => {
              const outcome = runMove(context);

              if (outcome === null) {
                return null;
              }

              if (isRejectedOutcome(outcome)) {
                return outcome;
              }

              return outcome.kind === "goto" && outcome.phase === targetPhase && outcome.endTurn === true
                ? createTransitionResult(
                  context.G,
                  outcome as MoveOutcome<TState, TPhase, TPlayers[number], GamekitQueuedEvent<TMoves>>,
                  "increment",
                )
                : null;
            },
            to: targetPhase,
            turn: "increment",
          },
        );
      }

      transitions.push(
        {
          event: moveName,
          from: phase,
          label: `${moveName}:${phase}:finish`,
          resolve: (
            context: GameEventContext<
              GamekitState<TState>,
              GamekitEventMap<TMoves>,
              GamekitNode<TPhase, TCoreNode>,
              TPlayers,
              ReplayValue
            >,
          ) => {
            const outcome = runMove(context);

            if (outcome === null) {
              return null;
            }

            if (isRejectedOutcome(outcome)) {
              return outcome;
            }

            return outcome.kind === "finish"
              ? createTransitionResult(
                context.G,
                outcome as MoveOutcome<TState, TPhase, TPlayers[number], GamekitQueuedEvent<TMoves>>,
                "increment",
              )
              : null;
          },
          to: "__gamekit_finished",
          turn: "increment",
        },
      );
    }
  }

  const selectors = {
    ...(definition.core?.selectors === undefined
      ? {}
      : wrapCoreSelectors<TState, TPlayers, GamekitNode<TPhase, TCoreNode>>(definition.core.selectors)),
    ...(definition.computed === undefined ? {} : buildSelectorMap(definition.computed, turnPolicy)),
    currentPlayer: ({ position, match }: GameRuleContext<
      GamekitState<TState>,
      GamekitNode<TPhase, TCoreNode>,
      TPlayers,
      ReplayValue
    >) =>
      resolveTurn(turnPolicy, match.players, position.turn).currentPlayer,
  };

  const setup: CoreGameDefinitionFor<TState, TMoves, TPlayers, TPhase, TPublic, TPlayer, TCoreNode>["setup"] = (context) => ({
    ...definition.setup({
      ...context,
      profiles: (context.match.profiles ?? {}) as Readonly<PlayerRecord<TPlayers, TProfile>>,
    }),
    __gamekit: {
      result: null,
    },
  });

  const coreViews = definition.core?.views === undefined
    ? undefined
    : wrapCoreViews<TState, TPlayers, GamekitNode<TPhase, TCoreNode>>(definition.core.views);
  const views: NonNullable<CoreGameDefinitionFor<TState, TMoves, TPlayers, TPhase, TPublic, TPlayer, TCoreNode>["views"]> = {
    player: (context, playerID) => {
      if (coreViews?.player !== undefined) {
        return coreViews.player(context, playerID) as TPlayer;
      }

      const viewContext = createViewContext(definition, turnPolicy, context);

      if (definition.views?.player === undefined) {
        return stripInternalState(context.G) as TPlayer;
      }

      return definition.views.player(viewContext, { id: playerID });
    },
    public: (context) => {
      if (coreViews?.public !== undefined) {
        return coreViews.public(context) as TPublic;
      }

      const viewContext = createViewContext(definition, turnPolicy, context);

      if (definition.views?.public === undefined) {
        return stripInternalState(context.G) as TPublic;
      }

      return definition.views.public(viewContext);
    },
  };

  const authoredLegalActions = definition.legalActions;
  const wrappedLegalActions = authoredLegalActions === undefined
    ? undefined
    : (context: GameRuleContext<GamekitState<TState>, GamekitNode<TPhase, TCoreNode>, TPlayers, ReplayValue>, playerID: TPlayers[number]) =>
      authoredLegalActions(stripRuleContext(context), playerID);

  return defineCoreGame({
    events: {
      ...eventShapes,
    } as GamekitEventMap<TMoves>,
    initial: definition.core?.initial ?? initialPhase,
    playerIDs,
    minPlayers,
    ...(wrappedLegalActions === undefined ? {} : { legalActions: wrappedLegalActions }),
    ...(definition.profile === undefined ? {} : { profile: definition.profile }),
    selectors,
    setup,
    states: {
      ...states,
      ...(definition.core?.states === undefined
        ? {}
        : wrapCoreStates<TState, TPlayers, GamekitNode<TPhase, TCoreNode>>(definition.core.states)),
    },
    transitions: [
      ...transitions,
      ...(definition.core?.transitions ?? []),
    ],
    views,
  } as never) as CoreGameDefinitionFor<TState, TMoves, TPlayers, TPhase, TPublic, TPlayer, TCoreNode>;
}

function wrapCoreSelectors<TState extends object, TPlayers extends PlayerList, TNode extends string>(
  selectors: Record<string, (context: GamekitCoreRuleContext<TState, TNode, TPlayers>) => ReplayValue>,
): Record<string, (context: GameRuleContext<GamekitState<TState>, TNode, TPlayers, ReplayValue>) => ReplayValue> {
  return Object.fromEntries(
    Object.entries(selectors).map(([name, selector]) => [
      name,
      (context: GameRuleContext<GamekitState<TState>, TNode, TPlayers, ReplayValue>) => selector(stripRuleContext(context)),
    ]),
  );
}

function wrapCoreStates<TState extends object, TPlayers extends PlayerList, TNode extends string>(
  states: Record<string, GamekitCoreStateConfig<TState, TNode, TPlayers>>,
): Record<string, GameStateConfig<GamekitState<TState>, TNode, TPlayers, ReplayValue>> {
  return Object.fromEntries(
    Object.entries(states).map(([name, state]) => {
      const wrappedState: GameStateConfig<GamekitState<TState>, TNode, TPlayers, ReplayValue> = {};

      if (state.parent !== undefined) {
        wrappedState.parent = state.parent;
      }

      if (state.activePlayers !== undefined) {
        wrappedState.activePlayers = (context) => state.activePlayers!(stripStateContext(context));
      }

      if (state.control !== undefined) {
        wrappedState.control = (context) => state.control!(stripStateContext(context));
      }

      const deadline = state.deadline;
      if (deadline !== undefined) {
        wrappedState.deadline = typeof deadline === "function"
          ? (context) => deadline(stripStateContext(context))
          : deadline;
      }

      const label = state.label;
      if (label !== undefined) {
        wrappedState.label = typeof label === "function"
          ? (context) => label(stripStateContext(context))
          : label;
      }

      const metadata = state.metadata;
      if (metadata !== undefined) {
        wrappedState.metadata = typeof metadata === "function"
          ? (context) => metadata(stripStateContext(context))
          : metadata;
      }

      return [name, wrappedState];
    }),
  );
}

function wrapCoreViews<TState extends object, TPlayers extends PlayerList, TNode extends string>(
  views: {
    player?: (
      context: GamekitCoreRuleContext<TState, TNode, TPlayers>,
      playerID: TPlayers[number],
    ) => unknown;
    public?: (
      context: GamekitCoreRuleContext<TState, TNode, TPlayers>,
    ) => unknown;
  },
): GameViews<GamekitState<TState>, JsonValue, JsonValue, TNode, TPlayers, ReplayValue> {
  return {
    ...(views.player === undefined ? {} : {
      player: (
        context: GameRuleContext<GamekitState<TState>, TNode, TPlayers, ReplayValue>,
        playerID: TPlayers[number],
      ) => views.player?.(stripRuleContext(context), playerID) as JsonValue,
    }),
    ...(views.public === undefined ? {} : {
      public: (
        context: GameRuleContext<GamekitState<TState>, TNode, TPlayers, ReplayValue>,
      ) => views.public?.(stripRuleContext(context)) as JsonValue,
    }),
  };
}

function applyOutcomeToState<TState extends object>(
  currentState: GamekitState<TState> | DeepReadonly<GamekitState<TState>>,
  outcome: MoveOutcome<TState, string, string, { kind: string }>,
): GamekitState<TState> {
  const nextState = {
    ...stripInternalState(currentState),
    ...(("patch" in outcome ? outcome.patch : undefined) ?? {}),
  } as TState;

  return {
    ...nextState,
    __gamekit: {
      result: outcome.kind === "finish" ? outcome.result : null,
    },
  } as GamekitState<TState>;
}

function buildSelectorMap<TState extends object, TPhase extends string, TPlayers extends PlayerList>(
  computed: ComputedMap<TState, TPhase, TPlayers>,
  turnPolicy: TurnPolicy,
) {
  return Object.fromEntries(
    Object.entries(computed).map(([name, selector]) => [
      name,
      ({ G, position, match }: GameRuleContext<GamekitState<TState>, string, TPlayers, ReplayValue>) =>
        selector({
          G: stripInternalState(G),
          phase: position.name as TPhase,
          turn: resolveTurn(turnPolicy, match.players, position.turn),
        }),
    ]),
  );
}

function computeComputedValues<TState extends object, TPhase extends string, TPlayers extends readonly PlayerID[]>(
  computed: ComputedMap<TState, TPhase, TPlayers> | undefined,
  state: DeepReadonly<GamekitAuthorState<TState>>,
  phase: TPhase,
  turnContext: TurnContext<TPlayers[number]>,
): ComputedValues<ComputedMap<TState, TPhase, TPlayers> | undefined> {
  if (computed === undefined) {
    return {} as ComputedValues<ComputedMap<TState, TPhase, TPlayers> | undefined>;
  }

  return Object.fromEntries(
    Object.entries(computed).map(([name, selector]) => [
      name,
      selector({
        G: state,
        phase,
        turn: turnContext,
      }),
    ]),
  ) as ComputedValues<ComputedMap<TState, TPhase, TPlayers> | undefined>;
}

function createMoveHelpers<
  TState extends object,
  TPhase extends string,
  TPlayerID extends string,
  TQueuedEvent extends { kind: string },
>(): MoveHelpers<TState, TPhase, TPlayerID, TQueuedEvent> {
  return {
    endTurn(patch, options) {
      return {
        ...(options?.enqueue === undefined ? {} : { enqueue: options.enqueue }),
        kind: "endTurn",
        ...(patch === undefined ? {} : { patch }),
        ...(options?.profile === undefined ? {} : { profile: options.profile }),
      };
    },
    finish(result, patch, options) {
      return {
        ...(options?.enqueue === undefined ? {} : { enqueue: options.enqueue }),
        kind: "finish",
        ...(patch === undefined ? {} : { patch }),
        ...(options?.profile === undefined ? {} : { profile: options.profile }),
        result,
      };
    },
    goto(phase, patch, options) {
      return {
        ...(options?.enqueue === undefined ? {} : { enqueue: options.enqueue }),
        ...(options?.endTurn === undefined ? {} : { endTurn: options.endTurn }),
        kind: "goto",
        ...(patch === undefined ? {} : { patch }),
        phase,
        ...(options?.profile === undefined ? {} : { profile: options.profile }),
      };
    },
    invalid(reason, details) {
      return {
        kind: "invalid",
        ...(details === undefined ? {} : { details }),
        ...(reason === undefined ? {} : { reason }),
      };
    },
    stay(patch, options) {
      return {
        ...(options?.enqueue === undefined ? {} : { enqueue: options.enqueue }),
        kind: "stay",
        ...(patch === undefined ? {} : { patch }),
        ...(options?.profile === undefined ? {} : { profile: options.profile }),
      };
    },
  };
}

function createViewContext<
  TState extends object,
  TMoves extends Record<string, GamekitMoveDefinition<TState, any, any, any, any, any, any>>,
  TPhase extends string,
  TPlayers extends PlayerList,
  TComputed extends ComputedMap<TState, TPhase, TPlayers> | undefined,
  TPublic,
  TPlayer,
  TCoreNode extends string = never,
  TProfile extends ReplayValue = ReplayValue,
>(
  definition: GamekitDefinition<TState, TMoves, TPhase, TPlayers, TComputed, TPublic, TPlayer, TCoreNode, TProfile>,
  turnPolicy: TurnPolicy,
  context: GameRuleContext<GamekitState<TState>, GamekitNode<TPhase, TCoreNode>, TPlayers, ReplayValue>,
): ViewContext<TState, ComputedValues<TComputed>, TPhase, TPlayers> {
  return createPhaseContext(definition, turnPolicy, context, context.position.name as TPhase);
}

function createPhaseContext<
  TState extends object,
  TMoves extends Record<string, GamekitMoveDefinition<TState, any, any, any, any, any, any>>,
  TPhase extends string,
  TPlayers extends PlayerList,
  TComputed extends ComputedMap<TState, TPhase, TPlayers> | undefined,
  TPublic,
  TPlayer,
  TCoreNode extends string = never,
  TProfile extends ReplayValue = ReplayValue,
>(
  definition: GamekitDefinition<TState, TMoves, TPhase, TPlayers, TComputed, TPublic, TPlayer, TCoreNode, TProfile>,
  turnPolicy: TurnPolicy,
  context: Pick<
    GameRuleContext<GamekitState<TState>, GamekitNode<TPhase, TCoreNode>, TPlayers, ReplayValue>,
    "G" | "match" | "position"
  >,
  phase: TPhase,
): ViewContext<TState, ComputedValues<TComputed>, TPhase, TPlayers> {
  const turnContext = resolveTurn(turnPolicy, context.match.players, context.position.turn);
  const state = stripInternalState(context.G);

  return {
    C: computeComputedValues(
      definition.computed,
      state,
      phase,
      turnContext,
    ) as ComputedValues<TComputed>,
    G: state,
    phase,
    turn: turnContext,
  };
}

function stripRuleContext<TState extends object, TNode extends string, TPlayers extends PlayerList>(
  context: GameRuleContext<GamekitState<TState>, TNode, TPlayers, ReplayValue>,
): GamekitCoreRuleContext<TState, TNode, TPlayers> {
  return {
    ...context,
    G: stripInternalState(context.G),
  };
}

function stripStateContext<TState extends object, TNode extends string, TPlayers extends PlayerList>(
  context: GameStateContext<GamekitState<TState>, TNode, TPlayers, ReplayValue>,
): GamekitCoreStateContext<TState, TNode, TPlayers> {
  return {
    ...context,
    G: stripInternalState(context.G),
  };
}

function resolvePhaseNames(definition: {
  initialPhase?: string;
  moves: Record<string, GamekitMoveDefinition<any, any, any, any, any, any, any>>;
  phases?: Record<string, GamekitPhaseConfig<any, any, any, any>>;
}): readonly string[] {
  const explicitPhases = definition.phases === undefined ? [] : Object.keys(definition.phases);
  const movePhases = Object.values(definition.moves).flatMap((move) =>
    typeof move === "object" && move !== null && "phases" in move ? (((move as { phases?: readonly string[] }).phases) ?? []) : []);
  const candidates = new Set<string>([
    ...(definition.initialPhase === undefined ? [] : [definition.initialPhase]),
    ...explicitPhases,
    ...movePhases,
  ]);

  if (candidates.size === 0) {
    candidates.add("play");
  }

  return [...candidates];
}

function resolveTurn<TPlayers extends readonly PlayerID[]>(
  policy: TurnPolicy,
  players: TPlayers,
  turnNumber: number,
): TurnContext<TPlayers[number]> {
  switch (policy.kind) {
    case "round_robin": {
      return resolveRoundRobinTurn(players as unknown as readonly [PlayerID, ...PlayerID[]], turnNumber) as TurnContext<TPlayers[number]>;
    }
  }
}

function stripInternalState<TState extends object>(
  state: GamekitState<TState> | DeepReadonly<GamekitState<TState>>,
): DeepReadonly<GamekitAuthorState<TState>> {
  const { __gamekit: _internal, ...publicState } = state as GamekitState<TState>;
  return publicState as DeepReadonly<GamekitAuthorState<TState>>;
}

function isRejectedOutcome(
  outcome: { kind: string },
): outcome is ReturnType<typeof rejectTransition> {
  return outcome.kind === "reject";
}

function createTransitionResult<
  TState extends object,
  TPhase extends string,
  TPlayerID extends string,
  TQueuedEvent extends { kind: string; payload?: unknown } = never,
>(
  currentState: GamekitState<TState> | DeepReadonly<GamekitState<TState>>,
  outcome: MoveOutcome<TState, TPhase, TPlayerID, TQueuedEvent>,
  turn?: "increment" | "preserve",
) {
  const nextState = applyOutcomeToState(currentState, outcome);
  const outcomeProfile = "profile" in outcome ? outcome.profile : undefined;

  return {
    ...(outcome.enqueue === undefined ? {} : {
      enqueue: structuredClone(outcome.enqueue) as readonly TQueuedEvent[],
    }),
    G: nextState,
    ...(outcomeProfile === undefined ? {} : { profile: outcomeProfile }),
    ...(outcome.kind === "finish" ? { result: structuredClone(nextState.__gamekit.result) } : {}),
    ...(turn === undefined ? {} : { turn }),
  };
}
