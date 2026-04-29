import type {
  AnyGame,
  GamePlayerView,
  GamePlayers,
  GameSnapshotOf,
  LegalAction,
  LocalGameSession,
  MatchInput,
} from "@openturn/core";

import type { BotHost, HostDispatchOutcome } from "../host";

/**
 * A shared change bus for a single local session. All hosts and all proxy
 * facades that wrap the same session must share one bus, otherwise a
 * dispatch from one bot doesn't notify another bot's host.
 */
export interface LocalSessionBus<TGame extends AnyGame> {
  readonly rawSession: LocalGameSession<TGame, MatchInput<GamePlayers<TGame>>>;
  readonly facade: LocalGameSession<TGame, MatchInput<GamePlayers<TGame>>>;
  subscribe(listener: () => void): () => void;
}

/**
 * Build a notification bus + a session-shaped facade whose `applyEvent`
 * notifies every subscriber. Subsequent `createLocalSessionHost` calls
 * for the same session should reuse the bus's `facade` and pass the bus.
 */
export function createLocalSessionBus<TGame extends AnyGame>(
  rawSession: LocalGameSession<TGame, MatchInput<GamePlayers<TGame>>>,
): LocalSessionBus<TGame> {
  const listeners = new Set<() => void>();

  const notify = () => {
    for (const listener of listeners) {
      try {
        listener();
      } catch {
        // Swallow — listeners must not break the notification boundary.
      }
    }
  };

  const wrappedApplyEvent: LocalGameSession<TGame, MatchInput<GamePlayers<TGame>>>["applyEvent"] = (
    actor,
    event,
    ...payload
  ) => {
    const outcome = rawSession.applyEvent(actor, event, ...payload);
    if (outcome.ok) notify();
    return outcome;
  };

  const facade = new Proxy(rawSession, {
    get(target, property, receiver) {
      if (property === "applyEvent") return wrappedApplyEvent;
      return Reflect.get(target, property, receiver);
    },
  }) as LocalGameSession<TGame, MatchInput<GamePlayers<TGame>>>;

  return {
    rawSession,
    facade,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export interface LocalSessionHostHandle<TGame extends AnyGame> {
  readonly host: BotHost<TGame>;
  readonly session: LocalGameSession<TGame, MatchInput<GamePlayers<TGame>>>;
  readonly bus: LocalSessionBus<TGame>;
}

/**
 * Adapt a `LocalGameSession` to the `BotHost` interface. When attaching
 * multiple bots to the same session, pass the same `bus` to every call so
 * each host hears every dispatch (including those from other bots and from
 * the human-controlled facade).
 */
export function createLocalSessionHost<TGame extends AnyGame>(
  rawSessionOrBus: LocalGameSession<TGame, MatchInput<GamePlayers<TGame>>> | LocalSessionBus<TGame>,
  playerID: GamePlayers<TGame>[number],
): LocalSessionHostHandle<TGame> {
  const bus: LocalSessionBus<TGame> = isBus(rawSessionOrBus)
    ? rawSessionOrBus
    : createLocalSessionBus(rawSessionOrBus);

  const host: BotHost<TGame> = {
    playerID,
    getView() {
      return bus.rawSession.getPlayerView(playerID) as GamePlayerView<TGame>;
    },
    getSnapshot() {
      return bus.rawSession.getState() as GameSnapshotOf<TGame>;
    },
    isMyTurn() {
      const snapshot = bus.rawSession.getState();
      const finished = snapshot.meta.result !== null && snapshot.meta.result !== undefined;
      if (finished) return false;
      return snapshot.derived.activePlayers.includes(playerID);
    },
    async dispatch(action: LegalAction): Promise<HostDispatchOutcome> {
      const outcome = bus.facade.applyEvent(playerID, action.event as never, action.payload as never);
      if (outcome.ok) return { ok: true };
      return { ok: false, error: outcome.error, ...(outcome.reason === undefined ? {} : { reason: outcome.reason }) };
    },
    onChange(listener) {
      return bus.subscribe(listener);
    },
    close() {
      // Listeners are removed by individual unsubscribe handles; nothing to do here.
    },
  };

  return { host, session: bus.facade, bus };
}

function isBus<TGame extends AnyGame>(
  value: LocalGameSession<TGame, MatchInput<GamePlayers<TGame>>> | LocalSessionBus<TGame>,
): value is LocalSessionBus<TGame> {
  return typeof (value as LocalSessionBus<TGame>).subscribe === "function"
    && typeof (value as LocalSessionBus<TGame>).facade === "object";
}
