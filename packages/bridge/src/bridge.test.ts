import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createGameBridge } from "./game";
import { createBridgeHost } from "./host";
import {
  encodeBridgeFragment,
  type BridgeInit,
  type BridgeMessage,
} from "./schema";

// jsdom does not populate MessageEvent.source on window.postMessage, so we
// route the game<->host channel ourselves using dispatchEvent with a synthetic
// source. This mirrors what a real browser does when `<iframe>.contentWindow`
// posts to `window.parent`.

const sample: BridgeInit = {
  roomID: "r_1",
  userID: "u_1",
  userName: "alice",
  scope: "game",
  token: "tok",
  tokenExpiresAt: 1_700_000_000,
  websocketURL: "wss://rooms.example/room/r_1",
  targetCapacity: 2,
  minPlayers: 2,
  maxPlayers: 2,
  isHost: true,
  hostUserID: "u_1",
  playerID: "p_0",
};

function dispatchToWindow(message: BridgeMessage, source: Window) {
  window.dispatchEvent(
    new MessageEvent("message", {
      data: message,
      origin: "https://game.example",
      source,
    }),
  );
}

describe("bridge host <-> game", () => {
  let gameToHostBus: ((m: BridgeMessage) => void) | null = null;
  let hostToGameBus: ((m: BridgeMessage) => void) | null = null;

  beforeEach(() => {
    gameToHostBus = null;
    hostToGameBus = null;
  });

  afterEach(() => {
    window.location.hash = "";
  });

  function setup(refreshToken: Parameters<typeof createBridgeHost>[0]["refreshToken"]) {
    window.location.hash = `#${encodeBridgeFragment(sample)}`;

    // Synthetic "iframe" source: a plain object pretending to be a Window for
    // the host's postMessage-back reply path. Host calls (source as Window).postMessage.
    const fakeIframe = {
      postMessage: (m: unknown) => hostToGameBus?.(m as BridgeMessage),
    } as unknown as Window;

    const host = createBridgeHost({
      bundleURL: "https://game.example/bundle/index.html",
      init: sample,
      refreshToken,
      expectOrigin: "https://game.example",
    });

    // Host listens on window.message; bus pushes into it with the fake source.
    gameToHostBus = (m) => dispatchToWindow(m, fakeIframe);

    const gameParent = {
      postMessage: (m: unknown) => gameToHostBus?.(m as BridgeMessage),
    };

    const game = createGameBridge({ parent: gameParent });

    // Host → game route: host posts to event.source (fakeIframe.postMessage),
    // which we wire to dispatch a message event on the same window (the game
    // listens on window.message).
    hostToGameBus = (m) => window.dispatchEvent(new MessageEvent("message", { data: m, origin: "https://shell.example" }));

    return { host, game };
  }

  it("host.emitShellControl delivers before/after events to the game", async () => {
    const { host, game } = setup(async () => null);

    const events: Array<{ control: string; phase: string }> = [];
    game.shellControl.on((e) => {
      events.push({ control: e.control, phase: e.phase });
    });

    // Wait for ready so activeSource is set on the host before broadcasting.
    await new Promise((r) => setTimeout(r, 10));

    host.emitShellControl("reset", "before");
    host.emitShellControl("reset", "after");
    await new Promise((r) => setTimeout(r, 10));

    expect(events).toEqual([
      { control: "reset", phase: "before" },
      { control: "reset", phase: "after" },
    ]);

    host.dispose();
    game.dispose();
  });

  it("host.refreshToken() round-trips the new token via postMessage", async () => {
    const refresh = vi.fn(async () => ({ token: "rotated", tokenExpiresAt: 1_700_002_000 }));
    const { host, game } = setup(refresh);

    const next = await game.refreshToken();
    expect(refresh).toHaveBeenCalled();
    expect(next).toBe("rotated");

    host.dispose();
    game.dispose();
  });

  it("batch stream: happy path streams initial snapshot + batches", async () => {
    const { host, game } = setup(async () => null);

    let emit: ((batch: unknown) => void) | null = null;
    game.registerBatchSource({
      getInitialSnapshot: () => ({ revision: 0, G: { board: [] } }),
      subscribe: (listener) => {
        emit = listener;
        return () => {
          emit = null;
        };
      },
    });

    const received: Array<{ initialSnapshot: unknown; lastBatch: unknown }> = [];
    host.onBatch((payload) => {
      received.push(payload);
    });

    const status = await host.requestBatchStream(1_000);
    expect(status).toBe("allowed");

    // Snapshot delivered after allowed status.
    await new Promise((r) => setTimeout(r, 10));
    expect(received.at(-1)?.initialSnapshot).toEqual({ revision: 0, G: { board: [] } });

    emit!({ revision: 1, steps: [] });
    await new Promise((r) => setTimeout(r, 10));
    expect(received.at(-1)?.lastBatch).toEqual({ revision: 1, steps: [] });

    host.dispose();
    game.dispose();
  });

  it("batch stream: game-denied when allowBatchStreaming(false)", async () => {
    const { host, game } = setup(async () => null);

    game.registerBatchSource({
      getInitialSnapshot: () => ({}),
      subscribe: () => () => {},
    });
    game.allowBatchStreaming(false);

    const status = await host.requestBatchStream(1_000);
    expect(status).toBe("denied-by-game");

    host.dispose();
    game.dispose();
  });

  it("batch stream: mid-stream stop unsubscribes from source", async () => {
    const { host, game } = setup(async () => null);

    const unsubscribe = vi.fn();
    let emit: ((batch: unknown) => void) | null = null;
    game.registerBatchSource({
      getInitialSnapshot: () => ({ revision: 0 }),
      subscribe: (listener) => {
        emit = listener;
        return () => {
          unsubscribe();
          emit = null;
        };
      },
    });

    await host.requestBatchStream(1_000);
    expect(emit).not.toBeNull();

    host.stopBatchStream();
    await new Promise((r) => setTimeout(r, 10));
    expect(unsubscribe).toHaveBeenCalledTimes(1);

    host.dispose();
    game.dispose();
  });

  it("match-state: game.setMatchActive(false) flips host.matchActive and fires event", async () => {
    const { host, game } = setup(async () => null);

    expect(host.matchActive).toBe(true); // scope: "game" ⇒ initial true

    const transitions: boolean[] = [];
    host.on("match-state-changed", (e) => {
      transitions.push(e.matchActive);
    });

    game.setMatchActive(false);
    await new Promise((r) => setTimeout(r, 10));
    expect(host.matchActive).toBe(false);
    expect(transitions).toEqual([false]);

    // No-op call should not re-fire.
    game.setMatchActive(false);
    await new Promise((r) => setTimeout(r, 10));
    expect(transitions).toEqual([false]);

    game.setMatchActive(true);
    await new Promise((r) => setTimeout(r, 10));
    expect(host.matchActive).toBe(true);
    expect(transitions).toEqual([false, true]);

    host.dispose();
    game.dispose();
  });

  it("batch stream: no-source when game has not registered a source", async () => {
    const { host, game } = setup(async () => null);
    // No registerBatchSource call.

    // Wait for ready so activeSource is set.
    await new Promise((r) => setTimeout(r, 10));
    const status = await host.requestBatchStream(1_000);
    expect(status).toBe("no-source");

    host.dispose();
    game.dispose();
  });
});
