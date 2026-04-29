import type { JsonCompatible } from "@openturn/json";
import type { DeterministicRng, RngSnapshot, TurnContext } from "./runtime";

import type { GameProfileConfig } from "./profile";
import type { DeepReadonly } from "./readonly";

export type PlayerID = string;
export type PlayerList = readonly [PlayerID, ...PlayerID[]];
export type PlayerRecord<TPlayers extends PlayerList, TValue> = {
  [TPlayerID in TPlayers[number]]: TValue;
};

/**
 * Compile-time tuple of `["0","1",..,"N-1"]` for a literal `N`. Used by the
 * `defineGame({ maxPlayers: N })` overload to compute the player ID union
 * `"0" | "1" | .. | "${N-1}"` when the author hasn't declared explicit
 * `playerIDs` for named seats.
 */
type DefaultPlayerIDsRange<
  N extends number,
  Acc extends readonly string[] = [],
> = Acc["length"] extends N ? Acc : DefaultPlayerIDsRange<N, [...Acc, `${Acc["length"]}`]>;

export type DefaultPlayerIDs<N extends number> =
  DefaultPlayerIDsRange<N> extends readonly [PlayerID, ...PlayerID[]]
    ? DefaultPlayerIDsRange<N>
    : never;

/** Internal: same as `DefaultPlayerIDs<N>` but provably extends `PlayerList`. */
type DefaultPlayerIDsBound<N extends number> =
  DefaultPlayerIDs<N> extends PlayerList ? DefaultPlayerIDs<N> : PlayerList;

export type ReplayValue =
  | null
  | boolean
  | number
  | string
  | readonly ReplayValue[]
  | { [key: string]: ReplayValue };

export type ProfilePathSegment = string | number;
export type ProfilePath = readonly ProfilePathSegment[];
export type ProfilePathInput = ProfilePath | ProfilePathSegment;

export type ProfileOp =
  | { op: "set"; path: ProfilePath; value: ReplayValue }
  | { op: "inc"; path: ProfilePath; value: number }
  | { op: "push"; path: ProfilePath; value: ReplayValue }
  | { op: "remove"; path: ProfilePath };

export type ProfileDelta = readonly ProfileOp[];

/** Per-player delta map returned by `profile.commit` or attached to a transition. Keys must be seated players. */
export type ProfileCommitDeltaMap<TPlayers extends PlayerList = PlayerList> =
  Partial<PlayerRecord<TPlayers, ProfileDelta>>;

export type GameEventPayload = unknown;
export type GameEventMap = Record<string, GameEventPayload>;
export type Serializable<T> = JsonCompatible<T>;

type NormalizePayload<TPayload extends GameEventPayload> =
  [Exclude<TPayload, undefined>] extends [never] ? null : Exclude<TPayload, undefined>;

type EventInputForKind<TKind extends string, TPayload extends GameEventPayload> =
  [Exclude<TPayload, undefined>] extends [never]
    ? { kind: TKind; payload?: Exclude<TPayload, undefined> }
    : { kind: TKind; payload: TPayload };

type TransitionNames<TTransitions> =
  TTransitions extends readonly (infer TTransition)[]
    ? TTransition extends { to: infer TNode extends string }
      ? TNode
      : never
    : never;

export type GameEventInput<TEvents extends GameEventMap = GameEventMap> = {
  [TKind in keyof TEvents & string]: EventInputForKind<TKind, TEvents[TKind]>
}[keyof TEvents & string];

export type GameEventArgsTuple<TEvents extends GameEventMap, TKind extends keyof TEvents & string> =
  [Exclude<TEvents[TKind], undefined>] extends [never]
    ? [payload?: Exclude<TEvents[TKind], undefined>]
    : [payload: NormalizePayload<TEvents[TKind]>];

/**
 * Per-session runtime input — the actually seated subset of a game's player
 * pool, plus optional profile/data carried for this match. Game-level capacity
 * (`minPlayers`, full pool) lives on `GameDefinition`, not here. `players` is
 * a non-empty subset of the game's declared pool, validated at session start.
 */
export interface MatchInput<TPlayers extends PlayerList = PlayerList, TMatchData = ReplayValue> {
  data?: TMatchData;
  /** Seated players for this match, a non-empty subset of the game's `playerIDs`. */
  players: readonly [TPlayers[number], ...TPlayers[number][]];
  /**
   * Per-player persistent profile state hydrated by the host before setup.
   * Scoped by (userID, gameKey). Populated server-side in cloud mode; supplied
   * by the embedding app in local mode. Undefined if the game declares no profile.
   * Keys are the seated subset; absent entries use the game's profile default.
   */
  profiles?: Partial<Readonly<PlayerRecord<TPlayers, ReplayValue>>>;
}

/**
 * Type-level event declaration. Use in `events: { place: defineEvent<PlaceArgs>() }`
 * to pin an event's payload type without writing it as `place: undefined as PlaceArgs`.
 */
export function defineEvent<TPayload = undefined>(): TPayload {
  return undefined as TPayload;
}

export interface GameTransitionRejection<TDetails extends ReplayValue | undefined = ReplayValue | undefined> {
  details?: TDetails;
  kind: "reject";
  reason?: string;
}

export function rejectTransition<TDetails extends ReplayValue | undefined = ReplayValue | undefined>(
  reason?: string,
  details?: TDetails,
): GameTransitionRejection<TDetails> {
  return {
    ...(details === undefined ? {} : { details }),
    kind: "reject",
    ...(reason === undefined ? {} : { reason }),
  };
}

export interface SetupContext<TPlayers extends PlayerList = PlayerList> {
  match: MatchInput<TPlayers>;
  /** Recorded replay time for bootstrap. This is not a live clock. */
  now: number;
  seed: string;
}

export type GameTurnContext<TPlayers extends PlayerList = PlayerList> = TurnContext<TPlayers[number]>;

export interface GameNodeState<TNode extends string = string> {
  name: TNode;
  path: readonly TNode[];
  turn: number;
}

export interface GameDerivedState<
  TPlayers extends PlayerList = PlayerList,
  TControl extends ReplayValue = ReplayValue,
  TNode extends string = string,
> {
  activePlayers: readonly TPlayers[number][];
  control: TControl | null;
  controlMeta: GameControlMeta<TNode>;
  selectors: Readonly<Record<string, ReplayValue>>;
}

export interface GameControlMetadataEntry {
  key: string;
  value: ReplayValue;
}

export interface GameControlMeta<TNode extends string = string> {
  deadline: number | null;
  label: string | null;
  metadata: readonly GameControlMetadataEntry[];
  pendingTargets: readonly TNode[];
}

export interface GamePendingTargetSummary<TNode extends string = string> {
  deadline: number | null;
  label: string | null;
  metadata: readonly GameControlMetadataEntry[];
  node: TNode;
  path: readonly TNode[];
}

export interface GameControlSummary<
  TPlayers extends PlayerList = PlayerList,
  TControl extends ReplayValue = ReplayValue,
  TNode extends string = string,
> {
  activePlayers: readonly TPlayers[number][];
  control: TControl | null;
  current: {
    meta: GameControlMeta<TNode>;
    node: TNode;
    path: readonly TNode[];
  };
  pendingTargetDetails: readonly GamePendingTargetSummary<TNode>[];
}

export interface GameMeta<TResult, TMatch extends MatchInput = MatchInput> {
  log: readonly GameActionRecord[];
  match: TMatch;
  /** Recorded replay time for this snapshot. This is not a live clock. */
  now: number;
  result: TResult;
  rng: RngSnapshot;
  seed: string;
}

export interface GameSnapshot<
  TState,
  TResult,
  TNode extends string = string,
  TMatch extends MatchInput = MatchInput,
  TControl extends ReplayValue = ReplayValue,
> {
  G: TState;
  position: GameNodeState<TNode>;
  derived: GameDerivedState<TMatch["players"], TControl, TNode>;
  meta: GameMeta<TResult, TMatch>;
}

export interface GameRuleContext<
  TState,
  TNode extends string = string,
  TPlayers extends PlayerList = PlayerList,
  TControl extends ReplayValue = ReplayValue,
> {
  G: DeepReadonly<TState>;
  position: Readonly<GameNodeState<TNode>>;
  derived: Readonly<GameDerivedState<TPlayers, TControl, TNode>>;
  match: MatchInput<TPlayers>;
  /** Recorded replay time for this snapshot. Use @openturn/runtime helpers for deterministic time math. */
  now: number;
}

export interface GameStateContext<
  TState,
  TNode extends string = string,
  TPlayers extends PlayerList = PlayerList,
  TControl extends ReplayValue = ReplayValue,
> extends GameRuleContext<TState, TNode, TPlayers, TControl> {}

export interface GameEventContext<
  TState,
  TEvents extends GameEventMap = GameEventMap,
  TNode extends string = string,
  TPlayers extends PlayerList = PlayerList,
  TControl extends ReplayValue = ReplayValue,
  TKind extends keyof TEvents & string = keyof TEvents & string,
> extends GameStateContext<TState, TNode, TPlayers, TControl> {
  actionID: string;
  event: {
    [TEventKind in TKind]: {
      kind: TEventKind;
      payload: NormalizePayload<TEvents[TEventKind]>;
    };
  }[TKind];
  playerID: TPlayers[number] | null;
  /** Deterministic RNG whose snapshot is recorded into replay state. */
  rng: DeterministicRng;
  /** Deterministic turn context derived from snapshot.position.turn and the match roster. */
  turn: GameTurnContext<TPlayers>;
}

export type GameSelectorMap<
  TState,
  TNode extends string = string,
  TPlayers extends PlayerList = PlayerList,
  TControl extends ReplayValue = ReplayValue,
> = Record<string, (context: GameStateContext<TState, TNode, TPlayers, TControl>) => ReplayValue>;

export interface GameTransitionResult<
  TState,
  TEvents extends GameEventMap = GameEventMap,
  TResult = ReplayValue | null,
> {
  G?: TState;
  enqueue?: readonly GameEventInput<TEvents>[];
  /**
   * Per-player profile deltas to apply atomically with this transition.
   * Keys not seated in the match are dropped. Apply failures reject the
   * transition with `invalid_transition_result`. The mutated profile state
   * is visible to subsequent resolvers in the same batch and to any
   * `profile.commit` at match end.
   */
  profile?: ProfileCommitDeltaMap;
  result?: TResult | null;
  turn?: "increment" | "preserve";
}

export type GameTransitionResolver<
  TState,
  TEvents extends GameEventMap = GameEventMap,
  TResult = ReplayValue | null,
  TNode extends string = string,
  TPlayers extends PlayerList = PlayerList,
  TControl extends ReplayValue = ReplayValue,
> = (
  context: GameEventContext<TState, TEvents, TNode, TPlayers, TControl>,
) => GameTransitionResult<TState, TEvents, TResult> | GameTransitionRejection | false | null | void;

export interface GameTransitionConfig<
  TState,
  TEvents extends GameEventMap = GameEventMap,
  TResult = ReplayValue | null,
  TNode extends string = string,
  TPlayers extends PlayerList = PlayerList,
  TControl extends ReplayValue = ReplayValue,
> {
  event: keyof TEvents & string;
  from: TNode;
  label?: string;
  resolve?: GameTransitionResolver<TState, TEvents, TResult, TNode, TPlayers, TControl>;
  to: TNode;
  turn?: "increment" | "preserve";
}

export interface GameStateConfig<
  TState,
  TNode extends string = string,
  TPlayers extends PlayerList = PlayerList,
  TControl extends ReplayValue = ReplayValue,
> {
  activePlayers?: (
    context: GameStateContext<TState, TNode, TPlayers, TControl>,
  ) => readonly TPlayers[number][];
  control?: (
    context: GameStateContext<TState, TNode, TPlayers, TControl>,
  ) => TControl;
  deadline?:
    | number
    | null
    | ((context: GameStateContext<TState, TNode, TPlayers, TControl>) => number | null);
  label?:
    | string
    | null
    | ((context: GameStateContext<TState, TNode, TPlayers, TControl>) => string | null);
  metadata?:
    | readonly GameControlMetadataEntry[]
    | ((context: GameStateContext<TState, TNode, TPlayers, TControl>) => readonly GameControlMetadataEntry[]);
  parent?: TNode;
}

export interface GameViews<
  TState,
  TPublic,
  TPlayer,
  TNode extends string = string,
  TPlayers extends PlayerList = PlayerList,
  TControl extends ReplayValue = ReplayValue,
> {
  player?: (context: GameRuleContext<TState, TNode, TPlayers, TControl>, playerID: TPlayers[number]) => TPlayer;
  public?: (context: GameRuleContext<TState, TNode, TPlayers, TControl>) => TPublic;
}

/**
 * Callback form of `profile:` that gives the user TResult as a phantom type
 * so `defineProfile<TProfile, TPlayers, typeof types.result>({...})` can pin
 * `commit`'s result without a cast. The runtime invokes the callback once
 * with `{ result: null, players: [] }` (type-only arguments — the values
 * aren't read) and replaces `profile` with the returned config.
 */
export type GameProfileFactory<TPlayers extends PlayerList, TResult> = (
  types: { players: TPlayers; result: TResult },
) => GameProfileConfig<any, TPlayers, TResult>;

export type GameProfileInput<TPlayers extends PlayerList, TResult> =
  | GameProfileConfig<any, TPlayers, TResult>
  | GameProfileFactory<TPlayers, TResult>;

export interface LegalAction {
  event: string;
  /**
   * Payload forwarded to `dispatch(playerID, event, payload)`. Must be
   * JSON-compatible at runtime, but typed as `unknown` so authors can pass
   * their concrete move-arg types without adding index signatures.
   */
  payload: unknown;
  label?: string;
}

/**
 * Structural shape of a bot-registry entry as seen by `@openturn/core`. The
 * engine treats this as opaque metadata (it never inspects `bot`). The lobby
 * package narrows `bot` to `Bot<TGame>` via its own `BotDescriptor<TGame>`
 * type; assignability is structural, so `defineGame({ bots: registry })`
 * just works without a circular dependency on `@openturn/bot`.
 */
export interface BotDescriptorShape {
  readonly botID: string;
  readonly label: string;
  readonly description?: string;
  readonly difficulty?: string;
  readonly bot: unknown;
}

export interface BotRegistryShape {
  readonly entries: ReadonlyArray<BotDescriptorShape>;
}

export type LegalActionsResolver<
  TState,
  TNode extends string = string,
  TPlayers extends PlayerList = PlayerList,
  TControl extends ReplayValue = ReplayValue,
> = (
  context: GameRuleContext<TState, TNode, TPlayers, TControl>,
  playerID: TPlayers[number],
) => readonly LegalAction[];

export interface GameDefinition<
  TState,
  TEvents extends GameEventMap = GameEventMap,
  TResult = ReplayValue | null,
  TPlayers extends PlayerList = PlayerList,
  TNode extends string = string,
  TPublic = TState,
  TPlayer = TPublic,
  TControl extends ReplayValue = ReplayValue,
  TTransitions extends readonly GameTransitionConfig<TState, TEvents, TResult, TNode, TPlayers, TControl>[] =
    readonly GameTransitionConfig<TState, TEvents, TResult, TNode, TPlayers, TControl>[],
> {
  events: { readonly [TKind in keyof TEvents & string]: TEvents[TKind] };
  initial: TNode;
  /**
   * Full pool of player IDs the game can seat. The actual `match.players` is a
   * subset of this with size in `[minPlayers, playerIDs.length]`. Use
   * `definePlayerIDs(N)` to auto-generate `["0",..,"N-1"]`, or pass a literal
   * tuple for named seats (e.g. `["white","black"]`).
   */
  playerIDs: TPlayers;
  /**
   * Lower bound on seated players for `lobby:start` to succeed. The lobby host
   * picks `targetCapacity` ∈ `[minPlayers, playerIDs.length]`; the running
   * game's `match.players` is filtered to the seated subset at session start.
   * Defaults to `playerIDs.length` (every seat must be filled) when omitted on
   * the input config — `defineGame` fills the default before returning so the
   * compiled definition always has a concrete `minPlayers`.
   */
  minPlayers: number;
  /**
   * Optional enumerator used by `@openturn/bot` to surface legal moves to
   * AI bots. The engine never reads this field — it is metadata that the
   * bot runtime accesses directly off the game definition. Authors who do
   * not ship bots can omit it.
   */
  legalActions?: LegalActionsResolver<TState, TNode, TPlayers, TControl>;
  /**
   * Optional bot registry consumed by `@openturn/lobby` (per-seat bot picker)
   * and `@openturn/bot` (move dispatch). The engine never reads this field —
   * it is metadata stored on the definition so the deployment manifest, the
   * lobby UI, and the bot supervisor have one source of truth. The `bot`
   * entry is typed as `unknown` here to avoid a circular dependency with
   * `@openturn/bot`; lobby's `BotRegistry<TGame>` narrows it structurally.
   */
  bots?: BotRegistryShape;
  /**
   * Optional persistent-profile declaration. When present, hosts hydrate
   * `MatchInput.profiles` before setup and invoke `profile.commit` after the
   * match terminates.
   *
   * Accepts either a `GameProfileConfig` or a factory `({ result, players })
   * => GameProfileConfig` — the factory form gives `TResult` as a phantom
   * type so `defineProfile<T, P, typeof types.result>` can pin the commit
   * context's `result` type without a cast.
   */
  profile?: GameProfileInput<TPlayers, TResult>;
  selectors?: GameSelectorMap<TState, TNode, TPlayers, TControl>;
  setup: (context: SetupContext<TPlayers>) => TState;
  states: Record<TNode, GameStateConfig<TState, TNode, TPlayers, TControl>>;
  transitions: TTransitions;
  views?: GameViews<TState, TPublic, TPlayer, TNode, TPlayers, TControl>;
}

export type AnyGame = GameDefinition<any, any, any, any, any, any, any, any, any>;

export type GameStateOf<TMachine extends AnyGame> = ReturnType<TMachine["setup"]>;

export type GamePlayers<TMachine extends AnyGame> =
  TMachine extends GameDefinition<any, any, any, infer TPlayers, any, any, any, any, any> ? TPlayers : PlayerList;

/** Union of player IDs the game can seat. Equivalent to `GamePlayers<TGame>[number]`. */
export type PlayerIDOf<TMachine extends AnyGame> = GamePlayers<TMachine>[number];

export type GameNodes<TMachine extends AnyGame> =
  TMachine extends GameDefinition<any, any, any, any, infer TNode, any, any, any, any> ? TNode : string;

export type GameControlState<TMachine extends AnyGame> =
  TMachine extends GameDefinition<any, any, any, any, any, any, any, infer TControl, any> ? TControl : unknown;

export type GameResultState<TMachine extends AnyGame> =
  TMachine extends GameDefinition<any, any, infer TResult, any, any, any, any, any, any> ? TResult | null : never;

export type GameSnapshotOf<TMachine extends AnyGame> =
  TMachine extends GameDefinition<any, any, any, infer TPlayers, infer TNode, any, any, infer TControl, any>
    ? GameSnapshot<GameStateOf<TMachine>, GameResultState<TMachine>, TNode, MatchInput<TPlayers>, TControl>
    : never;

export type GameRuleContextOf<TMachine extends AnyGame> =
  TMachine extends GameDefinition<any, any, any, infer TPlayers, infer TNode, any, any, infer TControl, any>
    ? GameRuleContext<GameStateOf<TMachine>, TNode, TPlayers, TControl>
    : never;

export type GamePlayerView<TMachine extends AnyGame> =
  TMachine extends GameDefinition<any, any, any, infer TPlayers, infer TNode, any, infer TPlayer, infer TControl, any>
    ? TPlayer extends never ? GameSnapshot<any, any, TNode, MatchInput<TPlayers>, TControl>["G"] : TPlayer
    : never;

export type GamePublicView<TMachine extends AnyGame> =
  TMachine extends GameDefinition<any, any, any, infer TPlayers, infer TNode, infer TPublic, any, infer TControl, any>
    ? TPublic extends never ? GameSnapshot<any, any, TNode, MatchInput<TPlayers>, TControl>["G"] : TPublic
    : never;

export type GameTransitionTargets<TMachine extends AnyGame> = TransitionNames<TMachine["transitions"]>;

export interface GameActionRecord<
  TEvent extends string = string,
  TPayload = ReplayValue | null,
  TPlayerID extends PlayerID = PlayerID,
> {
  actionID: string;
  at: number;
  event: TEvent;
  payload: TPayload;
  playerID: TPlayerID;
  turn: number;
  type: "event";
}

export interface GameInternalEventRecord<
  TEvent extends string = string,
  TPayload = ReplayValue | null,
> {
  actionID: string;
  at: number;
  event: TEvent;
  payload: TPayload;
  playerID: null;
  turn: number;
  type: "internal";
}

export type GameActionRecordFor<
  TEvents extends GameEventMap = GameEventMap,
  TPlayerID extends PlayerID = PlayerID,
> = {
  [TKind in keyof TEvents & string]: GameActionRecord<TKind, NormalizePayload<TEvents[TKind]>, TPlayerID>;
}[keyof TEvents & string];

export type GameInternalEventRecordFor<TEvents extends GameEventMap = GameEventMap> = {
  [TKind in keyof TEvents & string]: GameInternalEventRecord<TKind, NormalizePayload<TEvents[TKind]>>;
}[keyof TEvents & string];

export type GameEventRecord<
  TEvents extends GameEventMap = GameEventMap,
  TPlayers extends PlayerList = PlayerList,
> = GameActionRecordFor<TEvents, TPlayers[number]> | GameInternalEventRecordFor<TEvents>;

export interface GameQueuedEventRecord<
  TEvent extends string = string,
  TPayload extends ReplayValue | null = ReplayValue | null,
> {
  kind: TEvent;
  payload: TPayload;
}

export interface GameRngTrace {
  after: number;
  before: number;
  draws: number;
}

export interface GameTransitionCandidateEvaluation<TNode extends string = string> {
  details?: ReplayValue;
  from: TNode;
  matched: boolean;
  reason?: string;
  rejectedBy: "reject" | "resolver" | null;
  resolver: string | null;
  to: TNode;
}

export interface GameTransitionFamilyEvaluation<TNode extends string = string> {
  event: string;
  from: TNode;
  matchedTo: TNode | null;
  outcome: "ambiguous" | "no_match" | "selected";
  path: readonly TNode[];
  transitions: readonly GameTransitionCandidateEvaluation<TNode>[];
}

export interface GameQueueSemantics {
  ordering: "fifo";
  priorities: "none";
  recursionLimit: null;
}

export const GAME_QUEUE_SEMANTICS: GameQueueSemantics = {
  ordering: "fifo",
  priorities: "none",
  recursionLimit: null,
};

export interface GameObservedTransition<TNode extends string = string> {
  enqueued: readonly GameQueuedEventRecord[];
  event: string;
  evaluations: readonly GameTransitionFamilyEvaluation<TNode>[];
  from: TNode;
  fromPath: readonly TNode[];
  matchedFrom: TNode;
  matchedFromPath: readonly TNode[];
  /** Per-player profile deltas applied by this transition, filtered to seated players. */
  profile?: ProfileCommitDeltaMap;
  resolver: string | null;
  rng: GameRngTrace | null;
  to: TNode;
  toPath: readonly TNode[];
  turn: "increment" | "preserve";
}

export interface GameReplayData<
  TMachine extends AnyGame,
  TMatch extends MatchInput<GamePlayers<TMachine>> = MatchInput<GamePlayers<TMachine>>,
> {
  actions: readonly GameActionRecordFor<TMachine["events"], TMatch["players"][number]>[];
  /** Recorded replay time used to bootstrap the session before actions are applied. */
  initialNow: number;
  match: TMatch;
  seed: string;
}

export type GameDispatchMap<
  TMachine extends AnyGame,
  TMatch extends MatchInput<GamePlayers<TMachine>> = MatchInput<GamePlayers<TMachine>>,
> = {
  [TKind in keyof TMachine["events"] & string]: (
    playerID: TMatch["players"][number],
    ...payload: GameEventArgsTuple<TMachine["events"], TKind>
  ) => GameErrorResult | GameSuccessResult<TMachine>;
};

export interface GameStepBase<
  TMachine extends AnyGame,
  TKind extends "action" | "internal",
> {
  event: TKind extends "action"
    ? GameActionRecordFor<TMachine["events"], GamePlayers<TMachine>[number]>
    : GameInternalEventRecordFor<TMachine["events"]>;
  kind: TKind;
  snapshot: GameSnapshot<
    ReturnType<TMachine["setup"]>,
    GameResultState<TMachine>,
    GameNodes<TMachine>,
    MatchInput<GamePlayers<TMachine>>,
    GameControlState<TMachine>
  >;
  transition: GameObservedTransition<GameNodes<TMachine>>;
}

export type GameActionStep<TMachine extends AnyGame> = GameStepBase<TMachine, "action">;
export type GameInternalStep<TMachine extends AnyGame> = GameStepBase<TMachine, "internal">;
export type GameStep<TMachine extends AnyGame> = GameActionStep<TMachine> | GameInternalStep<TMachine>;

export interface GameBatch<TMachine extends AnyGame> {
  snapshot: GameStep<TMachine>["snapshot"];
  steps: readonly GameStep<TMachine>[];
}

export type GameErrorCode =
  | "ambiguous_transition"
  | "game_over"
  | "inactive_player"
  | "invalid_event"
  | "invalid_transition_result"
  | "non_serializable_args"
  | "unknown_event"
  | "unknown_player";

export interface GameErrorResult {
  details?: ReplayValue;
  error: GameErrorCode;
  ok: false;
  reason?: string;
}

export interface GameSuccessResult<TMachine extends AnyGame> {
  batch: GameBatch<TMachine>;
  ok: true;
}

export interface LocalGameSessionOptions<TPlayers extends PlayerList = PlayerList> {
  match: MatchInput<TPlayers>;
  /** Recorded replay bootstrap time for the initial snapshot. Defaults to 0. */
  now?: number;
  seed?: string;
}

export interface LocalGameSession<
  TMachine extends AnyGame,
  TMatch extends MatchInput<GamePlayers<TMachine>> = MatchInput<GamePlayers<TMachine>>,
> {
  readonly dispatch: GameDispatchMap<TMachine, TMatch>;
  applyEvent<TKind extends keyof TMachine["events"] & string>(
    playerID: TMatch["players"][number],
    event: TKind,
    ...payload: GameEventArgsTuple<TMachine["events"], TKind>
  ): GameErrorResult | GameSuccessResult<TMachine>;
  getGraph(): GameGraph;
  getPlayerView(playerID: TMatch["players"][number]): GamePlayerView<TMachine>;
  getPublicView(): GamePublicView<TMachine>;
  getReplayData(): GameReplayData<TMachine, TMatch>;
  getResult(): GameSnapshot<
    ReturnType<TMachine["setup"]>,
    GameResultState<TMachine>,
    GameNodes<TMachine>,
    TMatch,
    GameControlState<TMachine>
  >["meta"]["result"];
  getState(): GameSnapshot<
    ReturnType<TMachine["setup"]>,
    GameResultState<TMachine>,
    GameNodes<TMachine>,
    TMatch,
    GameControlState<TMachine>
  >;
}

export interface GameGraphNode {
  id: string;
  kind: "compound" | "leaf";
  parent: string | null;
  path: readonly string[];
}

export interface GameGraphEdge {
  event: string;
  from: string;
  resolver: string | null;
  to: string;
  turn: "increment" | "preserve";
}

export interface GameGraph {
  edges: readonly GameGraphEdge[];
  initial: string;
  nodes: readonly GameGraphNode[];
}

/**
 * Compile-time guard that intersects with `defineGame`'s parameter type. Each
 * arm checks one slot for JSON-serializability and, on failure, contributes a
 * `{ openturnError: "<readable message>" }` requirement that the input cannot
 * satisfy. The `openturnError` string surfaces verbatim in TS's diagnostic
 * ("Property 'openturnError' is missing in type '<your input>' but required
 * in type '{ openturnError: \"…\" }'"), giving the author a directly-actionable
 * message instead of the older `__state_must_be_json_compatible__: never`
 * marker keys, which TS rendered as opaque branding properties.
 */
type JsonCompatibilityChecks<TState, TPublic, TPlayer, TResult> =
  JsonCompatibilityError<TState, "state">
  & JsonCompatibilityError<TPublic, "public view">
  & JsonCompatibilityError<TPlayer, "player view">
  & JsonCompatibilityError<TResult, "result">;

type JsonCompatibilityError<T, TLabel extends string> =
  [Serializable<T>] extends [never]
    ? { openturnError: `'${TLabel}' is not JSON-compatible — remove functions, classes, Maps/Sets, symbols, or undefined property values from the type` }
    : {};

type PublicViewFrom<TViews, TState> =
  TViews extends { public: (context: any) => infer TPublic } ? TPublic : TState;

type PlayerViewFrom<TViews, TState> =
  TViews extends { player: (context: any, playerID: any) => infer TPlayer } ? TPlayer : PublicViewFrom<TViews, TState>;

type TransitionResultFrom<TTransitions> =
  TTransitions extends readonly GameTransitionConfig<any, any, infer TResult, any, any, any>[] ? TResult : ReplayValue | null;

type TransitionArrayFrom<TTransitionInput> =
  TTransitionInput extends (...args: any[]) => infer TTransitions ? TTransitions : TTransitionInput;

type TransitionResultFromReturn<TReturn> =
  TReturn extends GameTransitionRejection | false | null | undefined | void ? never
    : TReturn extends { result: infer TResult } ? TResult
    : never;

type AuthoredTransitionResult<TTransition> =
  TTransition extends { resolve?: (...args: any[]) => infer TReturn } ? TransitionResultFromReturn<TReturn> : never;

type AuthoredTransitionsResult<TTransitions> =
  [AuthoredTransitionResult<TTransitions extends readonly (infer TTransition)[] ? TTransition : never>] extends [never]
    ? ReplayValue
    : AuthoredTransitionResult<TTransitions extends readonly (infer TTransition)[] ? TTransition : never>;

type AuthoredTransitionConfig<
  TState,
  TEvents extends GameEventMap,
  TNode extends string,
  TPlayers extends PlayerList,
  TControl extends ReplayValue,
  TKind extends keyof TEvents & string,
  TResolve,
> = Omit<GameTransitionConfig<TState, TEvents, any, TNode, TPlayers, TControl>, "event" | "resolve"> & {
  event: TKind;
  resolve?: TResolve;
};

export type GameAuthorContext<
  TState,
  TNode extends string = string,
  TPlayers extends PlayerList = PlayerList,
  TControl extends ReplayValue = ReplayValue,
> = GameStateContext<TState, TNode, TPlayers, TControl>;

export type GameEventAuthorContext<
  TState,
  TEvents extends GameEventMap = GameEventMap,
  TNode extends string = string,
  TPlayers extends PlayerList = PlayerList,
  TControl extends ReplayValue = ReplayValue,
  TKind extends keyof TEvents & string = keyof TEvents & string,
> = GameEventContext<TState, TEvents, TNode, TPlayers, TControl, TKind>;

export type GameEventPayloads<TMachine extends AnyGame> = TMachine["events"];

export type GamePlayerID<TMachine extends AnyGame> = GamePlayers<TMachine>[number];

export type GameMatchPlayers<TMatch extends MatchInput> = TMatch["players"];

export interface TransitionDefinitionFactory<
  TState,
  TEvents extends GameEventMap,
  TResult,
  TNode extends string,
  TPlayers extends PlayerList,
  TControl extends ReplayValue,
> {
  <const TKind extends keyof TEvents & string>(
    event: TKind,
    transition: Omit<
      GameTransitionConfig<TState, TEvents, TResult, TNode, TPlayers, TControl>,
      "event" | "resolve"
    > & {
      resolve?: (
        context: GameEventContext<TState, TEvents, TNode, TPlayers, TControl, TKind>,
      ) => GameTransitionResult<TState, TEvents, TResult> | GameTransitionRejection | false | null | void;
    },
  ): GameTransitionConfig<TState, TEvents, TResult, TNode, TPlayers, TControl>;
}

export type TransitionDefinitionCallback<
  TState,
  TEvents extends GameEventMap,
  TResult,
  TNode extends string,
  TPlayers extends PlayerList,
  TControl extends ReplayValue,
> = (helpers: {
  transition: TransitionDefinitionFactory<TState, TEvents, TResult, TNode, TPlayers, TControl>;
}) => readonly GameTransitionConfig<TState, TEvents, TResult, TNode, TPlayers, TControl>[];

interface AuthoredTransitionDefinitionFactory<
  TState,
  TEvents extends GameEventMap,
  TNode extends string,
  TPlayers extends PlayerList,
  TControl extends ReplayValue,
> {
  <
    const TKind extends keyof TEvents & string,
    TResolve extends (
      context: GameEventContext<TState, TEvents, TNode, TPlayers, TControl, TKind>,
    ) => unknown,
  >(
    event: TKind,
    transition: Omit<
      GameTransitionConfig<TState, TEvents, any, TNode, TPlayers, TControl>,
      "event" | "resolve"
    > & {
      resolve: TResolve;
    },
  ): AuthoredTransitionConfig<TState, TEvents, TNode, TPlayers, TControl, TKind, TResolve>;
  <const TKind extends keyof TEvents & string>(
    event: TKind,
    transition: Omit<
      GameTransitionConfig<TState, TEvents, any, TNode, TPlayers, TControl>,
      "event" | "resolve"
    >,
  ): AuthoredTransitionConfig<TState, TEvents, TNode, TPlayers, TControl, TKind, undefined>;
}

type AuthoredTransitionDefinitionCallback<
  TState,
  TEvents extends GameEventMap,
  TNode extends string,
  TPlayers extends PlayerList,
  TControl extends ReplayValue,
> = (helpers: {
  transition: AuthoredTransitionDefinitionFactory<TState, TEvents, TNode, TPlayers, TControl>;
}) => readonly unknown[];

export function defineTransition<
  TState,
  TEvents extends GameEventMap,
  TResult = ReplayValue | null,
  TNode extends string = string,
  TPlayers extends PlayerList = PlayerList,
  TControl extends ReplayValue = any,
  const TKind extends keyof TEvents & string = keyof TEvents & string,
>(
  event: TKind,
  transition: Omit<
    GameTransitionConfig<TState, TEvents, TResult, TNode, TPlayers, TControl>,
    "event" | "resolve"
  > & {
    resolve?: (
      context: GameEventContext<TState, TEvents, TNode, TPlayers, TControl, TKind>,
    ) => GameTransitionResult<TState, TEvents, TResult> | GameTransitionRejection | false | null | void;
  },
): GameTransitionConfig<TState, TEvents, TResult, TNode, TPlayers, TControl> {
  return {
    ...transition,
    event,
  } as unknown as GameTransitionConfig<TState, TEvents, TResult, TNode, TPlayers, TControl>;
}

export function defineTransitions<
  TState,
  TEvents extends GameEventMap,
  TResult = ReplayValue | null,
  TNode extends string = string,
  TPlayers extends PlayerList = PlayerList,
  TControl extends ReplayValue = any,
>(
  transitions:
    | readonly GameTransitionConfig<TState, TEvents, TResult, TNode, TPlayers, TControl>[]
    | TransitionDefinitionCallback<TState, TEvents, TResult, TNode, TPlayers, TControl>,
): readonly GameTransitionConfig<TState, TEvents, TResult, TNode, TPlayers, TControl>[] {
  if (typeof transitions !== "function") {
    return transitions;
  }

  return transitions({
    transition: defineTransition as TransitionDefinitionFactory<TState, TEvents, TResult, TNode, TPlayers, TControl>,
  });
}

// ---- maxPlayers form (default IDs "0".."N-1"; preferred for unnamed seats) ----
export function defineGame<
  const TMaxPlayers extends number,
  TState,
  TEvents extends GameEventMap,
  TControl extends ReplayValue,
  const TStates extends Record<string, unknown>,
  const TTransitions extends readonly unknown[],
  TViews extends GameViews<
    TState,
    any,
    any,
    keyof TStates & string,
    TPlayers,
    TControl
  > | undefined,
  TPlayers extends PlayerList = DefaultPlayerIDsBound<TMaxPlayers>,
>(
  machine: {
    maxPlayers: TMaxPlayers;
    minPlayers?: number;
    events: { readonly [TKind in keyof TEvents & string]: TEvents[TKind] };
    initial: keyof TStates & string;
    profile?: GameProfileInput<TPlayers, AuthoredTransitionsResult<TTransitions>>;
    selectors?: GameSelectorMap<TState, keyof TStates & string, TPlayers, TControl>;
    setup: (context: SetupContext<TPlayers>) => TState;
    states: TStates & {
      [TNode in keyof TStates & string]: GameStateConfig<TState, keyof TStates & string, TPlayers, TControl>;
    };
    transitions: (helpers: {
      transition: AuthoredTransitionDefinitionFactory<TState, TEvents, keyof TStates & string, TPlayers, any>;
    }) => TTransitions;
    views?: TViews;
  } & JsonCompatibilityChecks<TState, PublicViewFrom<TViews, TState>, PlayerViewFrom<TViews, TState>, AuthoredTransitionsResult<TTransitions>>,
): GameDefinition<
  TState,
  TEvents,
  AuthoredTransitionsResult<TTransitions>,
  TPlayers,
  keyof TStates & string,
  PublicViewFrom<TViews, TState>,
  PlayerViewFrom<TViews, TState>,
  TControl,
  readonly GameTransitionConfig<
    TState,
    TEvents,
    AuthoredTransitionsResult<TTransitions>,
    keyof TStates & string,
    TPlayers,
    TControl
  >[]
>;
export function defineGame<
  const TMaxPlayers extends number,
  TState,
  TEvents extends GameEventMap,
  TControl extends ReplayValue,
  const TStates extends Record<string, unknown>,
  TTransitions extends readonly GameTransitionConfig<
    TState,
    TEvents,
    any,
    keyof TStates & string,
    TPlayers,
    any
  >[],
  TViews extends GameViews<
    TState,
    any,
    any,
    keyof TStates & string,
    TPlayers,
    TControl
  > | undefined,
  TPlayers extends PlayerList = DefaultPlayerIDsBound<TMaxPlayers>,
>(
  machine: {
    maxPlayers: TMaxPlayers;
    minPlayers?: number;
    events: { readonly [TKind in keyof TEvents & string]: TEvents[TKind] };
    initial: keyof TStates & string;
    profile?: GameProfileInput<TPlayers, TransitionResultFrom<TTransitions>>;
    selectors?: GameSelectorMap<TState, keyof TStates & string, TPlayers, TControl>;
    setup: (context: SetupContext<TPlayers>) => TState;
    states: TStates & {
      [TNode in keyof TStates & string]: GameStateConfig<TState, keyof TStates & string, TPlayers, TControl>;
    };
    transitions: TTransitions;
    views?: TViews;
  } & JsonCompatibilityChecks<TState, PublicViewFrom<TViews, TState>, PlayerViewFrom<TViews, TState>, TransitionResultFrom<TTransitions>>,
): GameDefinition<
  TState,
  TEvents,
  TransitionResultFrom<TTransitions>,
  TPlayers,
  keyof TStates & string,
  PublicViewFrom<TViews, TState>,
  PlayerViewFrom<TViews, TState>,
  TControl,
  TTransitions
>;
// ---- playerIDs form (named seats; opt-in) ----
export function defineGame<
  const TPlayers extends PlayerList,
  TState,
  TEvents extends GameEventMap,
  TControl extends ReplayValue,
  const TStates extends Record<string, unknown>,
  const TTransitions extends readonly unknown[],
  TViews extends GameViews<
    TState,
    any,
    any,
    keyof TStates & string,
    TPlayers,
    TControl
  > | undefined,
>(
  machine: {
    playerIDs: TPlayers;
    minPlayers?: number;
    maxPlayers?: never;
    events: { readonly [TKind in keyof TEvents & string]: TEvents[TKind] };
    initial: keyof TStates & string;
    profile?: GameProfileInput<TPlayers, AuthoredTransitionsResult<TTransitions>>;
    selectors?: GameSelectorMap<TState, keyof TStates & string, TPlayers, TControl>;
    setup: (context: SetupContext<TPlayers>) => TState;
    states: TStates & {
      [TNode in keyof TStates & string]: GameStateConfig<TState, keyof TStates & string, TPlayers, TControl>;
    };
    transitions: (helpers: {
      transition: AuthoredTransitionDefinitionFactory<TState, TEvents, keyof TStates & string, TPlayers, any>;
    }) => TTransitions;
    views?: TViews;
  } & JsonCompatibilityChecks<TState, PublicViewFrom<TViews, TState>, PlayerViewFrom<TViews, TState>, AuthoredTransitionsResult<TTransitions>>,
): GameDefinition<
  TState,
  TEvents,
  AuthoredTransitionsResult<TTransitions>,
  TPlayers,
  keyof TStates & string,
  PublicViewFrom<TViews, TState>,
  PlayerViewFrom<TViews, TState>,
  TControl,
  readonly GameTransitionConfig<
    TState,
    TEvents,
    AuthoredTransitionsResult<TTransitions>,
    keyof TStates & string,
    TPlayers,
    TControl
  >[]
>;
export function defineGame<
  const TPlayers extends PlayerList,
  TState,
  TEvents extends GameEventMap,
  TControl extends ReplayValue,
  const TStates extends Record<string, unknown>,
  TTransitions extends readonly GameTransitionConfig<
    TState,
    TEvents,
    any,
    keyof TStates & string,
    TPlayers,
    any
  >[],
  TViews extends GameViews<
    TState,
    any,
    any,
    keyof TStates & string,
    TPlayers,
    TControl
  > | undefined,
>(
  machine: {
    playerIDs: TPlayers;
    minPlayers?: number;
    maxPlayers?: never;
    events: { readonly [TKind in keyof TEvents & string]: TEvents[TKind] };
    initial: keyof TStates & string;
    profile?: GameProfileInput<TPlayers, TransitionResultFrom<TTransitions>>;
    selectors?: GameSelectorMap<TState, keyof TStates & string, TPlayers, TControl>;
    setup: (context: SetupContext<TPlayers>) => TState;
    states: TStates & {
      [TNode in keyof TStates & string]: GameStateConfig<TState, keyof TStates & string, TPlayers, TControl>;
    };
    transitions: TTransitions;
    views?: TViews;
  } & JsonCompatibilityChecks<TState, PublicViewFrom<TViews, TState>, PlayerViewFrom<TViews, TState>, TransitionResultFrom<TTransitions>>,
): GameDefinition<
  TState,
  TEvents,
  TransitionResultFrom<TTransitions>,
  TPlayers,
  keyof TStates & string,
  PublicViewFrom<TViews, TState>,
  PlayerViewFrom<TViews, TState>,
  TControl,
  TTransitions
>;
export function defineGame<
  TState,
  TEvents extends GameEventMap,
  TResult = ReplayValue | null,
  TPlayers extends PlayerList = PlayerList,
  TNode extends string = string,
  TPublic = TState,
  TPlayer = TPublic,
  TControl extends ReplayValue = ReplayValue,
  TTransitions extends readonly GameTransitionConfig<
    TState,
    TEvents,
    TResult,
    TNode,
    TPlayers,
    TControl
  >[] = readonly GameTransitionConfig<TState, TEvents, TResult, TNode, TPlayers, TControl>[],
>(
  machine: Omit<GameDefinition<
    TState,
    TEvents,
    TResult,
    TPlayers,
    TNode,
    TPublic,
    TPlayer,
    TControl,
    TTransitions
  >, "minPlayers"> & { minPlayers?: number } & JsonCompatibilityChecks<TState, TPublic, TPlayer, TResult>,
): GameDefinition<
  TState,
  TEvents,
  TResult,
  TPlayers,
  TNode,
  TPublic,
  TPlayer,
  TControl,
  TTransitions
>;
export function defineGame(
  machine: Record<string, any>,
): AnyGame {
  const m = machine as AnyGame & {
    profile?: unknown;
    transitions?: unknown;
    maxPlayers?: number;
  };

  const resolvedProfile = typeof m.profile === "function"
    ? (m.profile as (types: { players: unknown; result: unknown }) => unknown)({
      players: [],
      result: null,
    })
    : m.profile;

  const resolvedTransitions = typeof m.transitions === "function"
    ? (m.transitions as (helpers: { transition: typeof defineTransition }) => unknown[])({
      transition: defineTransition,
    })
    : m.transitions;

  const explicitPlayerIDs = m.playerIDs as PlayerList | undefined;
  const playerIDs = explicitPlayerIDs ?? generateDefaultPlayerIDs(m.maxPlayers);

  return {
    ...m,
    playerIDs,
    minPlayers: m.minPlayers ?? playerIDs.length,
    ...(resolvedProfile === undefined ? {} : { profile: resolvedProfile }),
    transitions: resolvedTransitions,
  } as AnyGame;
}

function generateDefaultPlayerIDs(maxPlayers: number | undefined): PlayerList {
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
  return out as unknown as PlayerList;
}

export const roster = {
  record<const TPlayers extends PlayerList, TValue>(
    match: MatchInput<TPlayers>,
    value: TValue | ((playerID: TPlayers[number], index: number) => TValue),
  ): PlayerRecord<TPlayers, TValue> {
    return Object.fromEntries(
      match.players.map((playerID, index) => [
        playerID,
        typeof value === "function"
          ? (value as (playerID: TPlayers[number], index: number) => TValue)(playerID, index)
          : structuredClone(value),
      ]),
    ) as PlayerRecord<TPlayers, TValue>;
  },
};
