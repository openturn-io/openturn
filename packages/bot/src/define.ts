import type {
  AnyGame,
  GamePlayerView,
  GameSnapshotOf,
  GamePlayers,
  LegalAction,
  PlayerID,
  ReplayValue,
} from "@openturn/core";

import type { BotRng } from "./rng";
import type { DeadlineToken } from "./budget";

export interface SimulationSuccess<TGame extends AnyGame> {
  ok: true;
  outcome: "endTurn" | "stay" | "finish";
  next: GameSnapshotOf<TGame>;
}

export interface SimulationFailure {
  ok: false;
  reason: string;
}

export type SimulateResult<TGame extends AnyGame> =
  | SimulationSuccess<TGame>
  | SimulationFailure;

export type SimulateFn<TGame extends AnyGame> = (
  action: LegalAction,
) => SimulateResult<TGame>;

export interface DecideContext<TGame extends AnyGame> {
  readonly playerID: GamePlayers<TGame>[number];
  readonly view: GamePlayerView<TGame>;
  /**
   * Full snapshot for hosts that have it (local sessions). Hosted clients
   * over the network expose only the player view; `snapshot` is `null` there.
   */
  readonly snapshot: GameSnapshotOf<TGame> | null;
  readonly legalActions: ReadonlyArray<LegalAction>;
  /** Forked from `snapshot.meta.rng`, so bot decisions are reproducible. */
  readonly rng: BotRng;
  readonly deadline: DeadlineToken;
  /** Aborts when a new snapshot makes this decision stale. */
  readonly signal: AbortSignal;
  /** Dry-run a candidate action; returns the resulting snapshot. Local hosts only. */
  readonly simulate: SimulateFn<TGame>;
}

export interface BotLifecycleContext {
  readonly playerID: PlayerID;
}

export type EnumerateActions<TGame extends AnyGame> = (context: {
  readonly view: GamePlayerView<TGame>;
  readonly snapshot: GameSnapshotOf<TGame> | null;
  readonly playerID: GamePlayers<TGame>[number];
}) => ReadonlyArray<LegalAction>;

export interface Bot<TGame extends AnyGame = AnyGame> {
  readonly name: string;
  /** Soft budget passed to `decide` via `deadline.remainingMs()`. Default 5_000ms. */
  readonly thinkingBudgetMs?: number;
  /**
   * Minimum delay between choosing an action and dispatching it. This is for
   * presentation pacing so human clients can see bot turns unfold.
   */
  readonly actionDelayMs?: number;
  /**
   * Optional per-bot enumerator used when the game definition does not
   * provide its own `legalActions` hook. Strictly a fallback; when both
   * exist, the game's hook wins.
   */
  readonly enumerate?: EnumerateActions<TGame>;
  decide(context: DecideContext<TGame>): LegalAction | Promise<LegalAction>;
  init?(context: BotLifecycleContext): void | Promise<void>;
  dispose?(): void;
}

export function defineBot<TGame extends AnyGame>(bot: Bot<TGame>): Bot<TGame> {
  return bot;
}

export type { LegalAction };
export type { ReplayValue };
