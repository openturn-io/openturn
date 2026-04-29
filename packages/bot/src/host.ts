import type {
  AnyGame,
  GamePlayerView,
  GamePlayers,
  GameSnapshotOf,
  LegalAction,
} from "@openturn/core";

export type HostDispatchOutcome =
  | { ok: true }
  | { ok: false; error: string; reason?: string };

export interface BotHost<TGame extends AnyGame> {
  readonly playerID: GamePlayers<TGame>[number];
  /** Sanitized view for this seat. */
  getView(): GamePlayerView<TGame> | null;
  /** Full snapshot. `null` for hosts that only see their own player view. */
  getSnapshot(): GameSnapshotOf<TGame> | null;
  /** True when the snapshot's `derived.activePlayers` contains this seat. */
  isMyTurn(): boolean;
  dispatch(action: LegalAction): Promise<HostDispatchOutcome>;
  /** Subscribe to snapshot changes. Returns an unsubscribe handle. */
  onChange(listener: () => void): () => void;
  close(): void;
}
