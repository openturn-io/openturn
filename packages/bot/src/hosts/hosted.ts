import type { HostedClient } from "@openturn/client";
import type {
  AnyGame,
  GamePlayerView,
  GamePlayers,
  GameSnapshotOf,
  LegalAction,
} from "@openturn/core";

import type { BotHost, HostDispatchOutcome } from "../host";

/**
 * Adapts a `HostedClient` (WebSocket transport) to the `BotHost`
 * interface. The hosted client never reveals the full server-side snapshot —
 * it surfaces only the player view + public state — so `getSnapshot()`
 * returns `null` and `simulate` will be unavailable for any bot attached
 * to a hosted host.
 */
export function createHostedClientHost<TGame extends AnyGame>(
  client: HostedClient,
  playerID: GamePlayers<TGame>[number],
): BotHost<TGame> {
  const listeners = new Set<() => void>();
  const unsubscribe = client.subscribe(() => {
    for (const listener of listeners) {
      try {
        listener();
      } catch {
        // Swallow — listeners must not break the notification boundary.
      }
    }
  });

  return {
    playerID,
    getView() {
      const snapshot = client.getState().snapshot;
      if (snapshot === null) return null;
      return snapshot.G as GamePlayerView<TGame>;
    },
    getSnapshot() {
      return null;
    },
    isMyTurn() {
      const snapshot = client.getState().snapshot;
      if (snapshot === null) return false;
      const finished = snapshot.result !== null && snapshot.result !== undefined;
      if (finished) return false;
      return snapshot.derived.activePlayers.includes(playerID);
    },
    async dispatch(action: LegalAction): Promise<HostDispatchOutcome> {
      const outcome = await client.dispatchEvent(action.event, action.payload as never);
      if (outcome.ok) return { ok: true };
      return {
        ok: false,
        error: typeof outcome.error === "string" ? outcome.error : "dispatch_failed",
        ...(outcome.reason === undefined ? {} : { reason: outcome.reason }),
      };
    },
    onChange(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    close() {
      listeners.clear();
      unsubscribe();
    },
  };
}
