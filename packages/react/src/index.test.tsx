// @vitest-environment jsdom

import { useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { defineGame, rejectTransition } from "@openturn/core";

import { stubGlobal, unstubAllGlobals } from "../../../test/stub-global";

import { createOpenturnBindings } from "./index";

const MATCH = {
  players: ["0", "1"] as const,
};

const scoreGame = defineGame({
  playerIDs: MATCH.players,
  events: {
    claim: {
      index: 0,
    },
  },
  initial: "play",
  setup: () => ({
    cells: [null, null] as Array<"A" | "B" | null>,
    hands: {
      "0": ["sun", "moon"],
      "1": ["storm", "mist"],
    },
  }),
  states: {
    play: {
      activePlayers: ({ match, position }) => [match.players[(position.turn - 1) % match.players.length]!],
      label: "Play",
    },
  },
  transitions: [
    {
      event: "claim",
      from: "play",
      resolve: ({ G, event, playerID }) => {
        if (G.cells[event.payload.index] !== null) {
          return rejectTransition("occupied", {
            index: event.payload.index,
          });
        }

        return {
          G: {
            ...G,
            cells: G.cells.map((cell, index) => index === event.payload.index ? (playerID === "0" ? "A" : "B") : cell),
          },
          turn: "increment",
        };
      },
      to: "play",
    },
  ],
  views: {
    player: ({ G }, playerID) => ({
      myHand: G.hands[playerID as "0" | "1"],
    }),
  },
});

const scoreBindings = createOpenturnBindings(scoreGame, {
  runtime: "local",
  match: MATCH,
});

describe("@openturn/react", () => {
  beforeEach(() => {
    MockWebSocket.instances.length = 0;
    stubGlobal("WebSocket", MockWebSocket as unknown as typeof WebSocket);
  });

  test("provider exposes the initial snapshot and rerenders after dispatch", () => {
    const localMatch = scoreBindings.createLocalMatch({ match: MATCH });

    render(
      <scoreBindings.OpenturnProvider match={localMatch}>
        <SnapshotHarness />
      </scoreBindings.OpenturnProvider>,
    );

    expect(screen.getByTestId("status").textContent).toBe("ready");
    expect(screen.getByTestId("turn").textContent).toBe("0");
    expect(screen.getByTestId("cells").textContent).toBe("--");

    fireEvent.click(screen.getByText("Claim 0"));

    expect(screen.getByTestId("cells").textContent).toBe("A-");
    expect(screen.getByTestId("turn").textContent).toBe("1");
    expect(screen.getByTestId("last-batch-id").textContent).toBe("m_1");
  });

  test("useMatch exposes a local MatchView from OpenturnProvider", () => {
    const localMatch = scoreBindings.createLocalMatch({ match: MATCH });

    function MatchViewHarness() {
      const view = scoreBindings.useMatch();
      return (
        <div>
          <div data-testid="match-view-mode">{view.mode}</div>
          <div data-testid="match-view-status">{view.status}</div>
          <div data-testid="match-view-turn">{String(view.snapshot.position.turn)}</div>
          <button
            onClick={() => view.dispatch.claim("0", { index: 1 })}
            type="button"
          >
            Dispatch via view
          </button>
        </div>
      );
    }

    render(
      <scoreBindings.OpenturnProvider match={localMatch}>
        <MatchViewHarness />
      </scoreBindings.OpenturnProvider>,
    );

    expect(screen.getByTestId("match-view-mode").textContent).toBe("local");
    expect(screen.getByTestId("match-view-status").textContent).toBe("ready");
    const initialTurn = screen.getByTestId("match-view-turn").textContent;

    fireEvent.click(screen.getByText("Dispatch via view"));

    // Turn advances after dispatch; exact counter is not material, just that it moves.
    expect(screen.getByTestId("match-view-turn").textContent).not.toBe(initialTurn);
  });

  test("reads player views, surfaces invalid events, and resets local state", () => {
    const localMatch = scoreBindings.createLocalMatch({ match: MATCH });

    render(
      <scoreBindings.OpenturnProvider match={localMatch}>
        <SnapshotHarness />
        <PlayerViewHarness playerID="1" />
      </scoreBindings.OpenturnProvider>,
    );

    expect(screen.getByTestId("hand").textContent).toBe("storm,mist");

    fireEvent.click(screen.getByText("Claim 0"));
    fireEvent.click(screen.getByText("Claim 0"));

    expect(screen.getByTestId("last-error").textContent).toBe("invalid_event");
    expect(screen.getByTestId("last-reason").textContent).toBe("occupied");
    expect(screen.getByTestId("cells").textContent).toBe("A-");

    fireEvent.click(screen.getByText("Reset"));
    expect(screen.getByTestId("cells").textContent).toBe("--");
    expect(screen.getByTestId("turn").textContent).toBe("0");
  });

  test("OpenturnProvider cloud reports missing backend when bridge init is absent", () => {
    const cloudGame = makeCloudGame();
    const cloudBindings = createOpenturnBindings(cloudGame, {
      runtime: "multiplayer",
      hosted: { parent: null, readInit: () => null },
    });
    const Harness = makeRoomHarness(cloudBindings);

    render(
      <cloudBindings.OpenturnProvider>
        <Harness />
      </cloudBindings.OpenturnProvider>,
    );

    expect(screen.getByTestId("room-phase").textContent).toBe("missing_backend");
    expect(screen.getByTestId("room-game").textContent).toBe("null");
  });

  test("OpenturnProvider cloud connects a hosted game from bridge init", async () => {
    const cloudGame = makeCloudGame();
    const cloudBindings = createOpenturnBindings(cloudGame, {
      runtime: "multiplayer",
      hosted: {
        parent: null,
        readInit: () => ({
          scope: "game",
          userID: "user_cloud",
          userName: "Cloud",
          playerID: "1",
          roomID: "room_cloud",
          token: "token_cloud",
          // Far-future expiry so the bridge skips token refresh (which would
          // otherwise post a token-refresh-request to our fake parent and
          // hang the connect() promise waiting 5s for a non-existent reply).
          tokenExpiresAt: 9_999_999_999,
          websocketURL: "wss://cloud.example/rooms/room_cloud/connect",
        }),
      },
    });
    const Harness = makeRoomHarness(cloudBindings);

    render(
      <cloudBindings.OpenturnProvider>
        <Harness />
      </cloudBindings.OpenturnProvider>,
    );

    await waitFor(() => {
      expect(MockWebSocket.instances).toHaveLength(1);
    });

    expect(MockWebSocket.instances[0]?.url).toBe(
      "wss://cloud.example/rooms/room_cloud/connect?token=token_cloud",
    );

    act(() => {
      MockWebSocket.instances[0]?.emit("open", {});
    });

    await waitFor(() => {
      expect(screen.getByTestId("room-game").textContent).toBe("connected");
    });

    expect(screen.getByTestId("room-id").textContent).toBe("room_cloud");
  });

  test("OpenturnProvider derives lobby capacity fallback when bridge init is zeroed", () => {
    const cloudGame = makeCloudGame();
    const cloudBindings = createOpenturnBindings(cloudGame, {
      runtime: "multiplayer",
      hosted: {
        parent: null,
        readInit: () => ({
          scope: "lobby",
          userID: "user_cloud",
          userName: "Cloud",
          roomID: "room_cloud",
          token: "token_cloud",
          websocketURL: "wss://cloud.example/rooms/room_cloud/connect",
          targetCapacity: 0,
          minPlayers: 0,
          maxPlayers: 0,
        }),
      },
    });
    const Harness = makeLobbyHarness(cloudBindings);

    render(
      <cloudBindings.OpenturnProvider>
        <Harness />
      </cloudBindings.OpenturnProvider>,
    );

    expect(screen.getByTestId("lobby-target").textContent).toBe("2");
    expect(screen.getByTestId("lobby-min").textContent).toBe("2");
    expect(screen.getByTestId("lobby-max").textContent).toBe("2");
    expect(screen.getByTestId("lobby-seats").textContent).toBe("2");
  });
});

describe("useTurnDeadline", () => {
  // Uses a stable wall-clock so the hook's `Date.now()` reads align with the
  // game's `deadline: ({ now }) => now + N` resolutions made at session
  // bootstrap. `vi.setSystemTime` runs BEFORE the test body so the bindings'
  // initial snapshot embeds a deadline tied to the same instant.
  const FIXED_NOW = 1_700_000_000_000;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("returns null deadline when match has none", () => {
    const noDeadlineGame = defineGame({
      playerIDs: MATCH.players,
      events: { noop: undefined },
      initial: "play",
      setup: () => ({}),
      states: { play: { activePlayers: () => ["0"] } },
      transitions: [],
    });
    const bindings = createOpenturnBindings(noDeadlineGame, {
      runtime: "local",
      match: MATCH,
    });

    const ref = {
      current: { deadline: null as number | null, remainingMs: -1, isExpired: true },
    };
    function Probe() {
      ref.current = bindings.useTurnDeadline();
      return null;
    }
    const localMatch = bindings.createLocalMatch({ match: MATCH });
    render(
      <bindings.OpenturnProvider match={localMatch}>
        <Probe />
      </bindings.OpenturnProvider>,
    );

    expect(ref.current.deadline).toBeNull();
    expect(ref.current.remainingMs).toBe(0);
    expect(ref.current.isExpired).toBe(false);
  });

  test("returns the snapshot's controlMeta.deadline", () => {
    const deadlineGame = defineGame({
      playerIDs: MATCH.players,
      events: { noop: undefined },
      initial: "play",
      setup: () => ({}),
      states: {
        play: {
          activePlayers: () => ["0"],
          deadline: ({ now }) => now + 30_000,
        },
      },
      transitions: [],
    });
    const bindings = createOpenturnBindings(deadlineGame, {
      runtime: "local",
      match: MATCH,
    });

    const ref = {
      current: { deadline: null as number | null, remainingMs: -1, isExpired: true },
    };
    function Probe() {
      ref.current = bindings.useTurnDeadline();
      return null;
    }
    const localMatch = bindings.createLocalMatch({ match: MATCH, now: FIXED_NOW });
    render(
      <bindings.OpenturnProvider match={localMatch}>
        <Probe />
      </bindings.OpenturnProvider>,
    );

    expect(ref.current.deadline).toBe(FIXED_NOW + 30_000);
    expect(ref.current.remainingMs).toBe(30_000);
    expect(ref.current.isExpired).toBe(false);
  });

  test("ticks at 1Hz when remainingMs >= 5000", () => {
    const deadlineGame = defineGame({
      playerIDs: MATCH.players,
      events: { noop: undefined },
      initial: "play",
      setup: () => ({}),
      states: {
        play: {
          activePlayers: () => ["0"],
          deadline: ({ now }) => now + 30_000,
        },
      },
      transitions: [],
    });
    const bindings = createOpenturnBindings(deadlineGame, {
      runtime: "local",
      match: MATCH,
    });

    const ref = {
      current: { deadline: null as number | null, remainingMs: -1, isExpired: true },
    };
    function Probe() {
      ref.current = bindings.useTurnDeadline();
      return null;
    }
    const localMatch = bindings.createLocalMatch({ match: MATCH, now: FIXED_NOW });
    render(
      <bindings.OpenturnProvider match={localMatch}>
        <Probe />
      </bindings.OpenturnProvider>,
    );

    expect(ref.current.remainingMs).toBe(30_000);

    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(ref.current.remainingMs).toBe(29_000);

    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(ref.current.remainingMs).toBe(28_000);
  });

  test("ramps to 10Hz when remainingMs < 5000", () => {
    const deadlineGame = defineGame({
      playerIDs: MATCH.players,
      events: { noop: undefined },
      initial: "play",
      setup: () => ({}),
      states: {
        play: {
          activePlayers: () => ["0"],
          deadline: ({ now }) => now + 4_500,
        },
      },
      transitions: [],
    });
    const bindings = createOpenturnBindings(deadlineGame, {
      runtime: "local",
      match: MATCH,
    });

    const ref = {
      current: { deadline: null as number | null, remainingMs: -1, isExpired: true },
    };
    function Probe() {
      ref.current = bindings.useTurnDeadline();
      return null;
    }
    const localMatch = bindings.createLocalMatch({ match: MATCH, now: FIXED_NOW });
    render(
      <bindings.OpenturnProvider match={localMatch}>
        <Probe />
      </bindings.OpenturnProvider>,
    );

    expect(ref.current.remainingMs).toBe(4_500);

    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(ref.current.remainingMs).toBe(4_400);

    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(ref.current.remainingMs).toBe(4_300);
  });
});

function SnapshotHarness() {
  const match = scoreBindings.useMatch();
  if (match.mode !== "local") throw new Error("SnapshotHarness requires local mode");
  const { dispatch, lastBatch, replayData, reset, snapshot, status } = match.state;
  const [lastError, setLastError] = useState("");
  const [lastReason, setLastReason] = useState("");

  return (
    <div>
      <div data-testid="status">{status}</div>
      <div data-testid="turn">{snapshot.derived.activePlayers[0] ?? ""}</div>
      <div data-testid="cells">{snapshot.G.cells.map((cell) => cell ?? "-").join("")}</div>
      <div data-testid="last-batch-id">{lastBatch?.steps.at(-1)?.event.actionID ?? ""}</div>
      <div data-testid="last-error">{lastError}</div>
      <div data-testid="last-reason">{lastReason}</div>
      <div data-testid="replay-seed">{replayData.seed}</div>
      <button
        onClick={() => {
          const result = dispatch.claim(snapshot.derived.activePlayers[0]!, { index: 0 });
          if (!result.ok) {
            setLastError(result.error);
            setLastReason(result.reason ?? "");
          }
        }}
        type="button"
      >
        Claim 0
      </button>
      <button onClick={() => reset()} type="button">Reset</button>
    </div>
  );
}

function PlayerViewHarness({ playerID }: { playerID: string }) {
  const match = scoreBindings.useMatch();
  if (match.mode !== "local") throw new Error("PlayerViewHarness requires local mode");
  const view = match.state.getPlayerView(playerID);

  return <div data-testid="hand">{view.myHand.join(",")}</div>;
}

function makeRoomHarness(bindings: ReturnType<typeof createOpenturnBindings<typeof scoreGame>>) {
  return function RoomHarness() {
    const room = bindings.useRoom();

    return (
      <div>
        <div data-testid="room-phase">{room.phase}</div>
        <div data-testid="room-id">{room.roomID ?? ""}</div>
        <div data-testid="room-error">{room.error ?? ""}</div>
        <div data-testid="room-game">{room.game === null ? "null" : room.game.status}</div>
      </div>
    );
  };
}

function makeLobbyHarness(bindings: ReturnType<typeof createOpenturnBindings<typeof scoreGame>>) {
  return function LobbyHarness() {
    const room = bindings.useRoom();

    return (
      <div>
        <div data-testid="room-phase">{room.phase}</div>
        <div data-testid="lobby-target">{room.lobby?.targetCapacity ?? ""}</div>
        <div data-testid="lobby-min">{room.lobby?.minPlayers ?? ""}</div>
        <div data-testid="lobby-max">{room.lobby?.maxPlayers ?? ""}</div>
        <div data-testid="lobby-seats">{room.lobby?.seats.length ?? ""}</div>
      </div>
    );
  };
}

// Per-test cloud games: bindings are cached per game definition, so each
// multiplayer test mints a fresh game so its `hosted` options take effect.
function makeCloudGame() {
  return defineGame({
    playerIDs: MATCH.players,
    events: { claim: { index: 0 } },
    initial: "play",
    setup: () => ({
      cells: [null, null] as Array<"A" | "B" | null>,
      hands: { "0": ["sun", "moon"], "1": ["storm", "mist"] },
    }),
    states: {
      play: {
        activePlayers: ({ match, position }) => [match.players[(position.turn - 1) % match.players.length]!],
        label: "Play",
      },
    },
    transitions: [
      {
        event: "claim",
        from: "play",
        resolve: ({ G, event, playerID }) => {
          if (G.cells[event.payload.index] !== null) {
            return rejectTransition("occupied", { index: event.payload.index });
          }
          return {
            G: {
              ...G,
              cells: G.cells.map((cell, index) => index === event.payload.index ? (playerID === "0" ? "A" : "B") : cell),
            },
            turn: "increment",
          };
        },
        to: "play",
      },
    ],
    views: {
      player: ({ G }, playerID) => ({
        myHand: G.hands[playerID as "0" | "1"],
      }),
    },
  });
}

class MockWebSocket {
  static instances: MockWebSocket[] = [];

  readonly sent: Array<Record<string, unknown>> = [];
  readonly url: string;
  readyState = 1;

  private readonly listeners = new Map<string, Set<(event: any) => void>>();

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  addEventListener(type: string, listener: (event: any) => void) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  close() {
    this.readyState = 3;
  }

  emit(type: string, event: any) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }

  removeEventListener(type: string, listener: (event: any) => void) {
    this.listeners.get(type)?.delete(listener);
  }

  send(payload: string) {
    this.sent.push(JSON.parse(payload) as Record<string, unknown>);
  }
}

describe("OpenturnProvider deadline emission via bridge", () => {
  beforeEach(() => {
    MockWebSocket.instances.length = 0;
    stubGlobal("WebSocket", MockWebSocket as unknown as typeof WebSocket);
  });

  function createDeadlineCapturingParent() {
    const messages: Array<Record<string, unknown>> = [];
    const parent: Pick<Window, "postMessage"> = {
      postMessage: (message: unknown) => {
        if (
          typeof message === "object"
          && message !== null
          && (message as Record<string, unknown>).kind === "openturn:bridge:deadline"
        ) {
          messages.push(message as Record<string, unknown>);
        }
      },
    };
    return { parent, messages };
  }

  function makeSnapshotMessage(
    deadline: number | null,
    revision: number,
  ): Record<string, unknown> {
    return {
      derived: {
        activePlayers: ["1"],
        control: null,
        controlMeta: {
          deadline,
          label: "Play",
          metadata: [],
          pendingTargets: ["play"],
        },
        selectors: {},
      },
      G: {
        cells: [null, null],
        hands: { "0": ["sun", "moon"], "1": ["storm", "mist"] },
      },
      log: [],
      position: {
        node: "play",
        path: ["play"],
        turn: 1,
      },
      matchID: "room_cloud",
      result: null,
      revision,
    };
  }

  test("OpenturnProvider calls backend.setDeadline when snapshot's controlMeta.deadline changes", async () => {
    const { parent, messages } = createDeadlineCapturingParent();
    const cloudGame = makeCloudGame();
    const cloudBindings = createOpenturnBindings(cloudGame, {
      runtime: "multiplayer",
      hosted: {
        parent,
        readInit: () => ({
          scope: "game",
          userID: "user_cloud",
          userName: "Cloud",
          playerID: "1",
          roomID: "room_cloud",
          token: "token_cloud",
          // Far-future expiry so the bridge skips token refresh (which would
          // otherwise post a token-refresh-request to our fake parent and
          // hang the connect() promise waiting 5s for a non-existent reply).
          tokenExpiresAt: 9_999_999_999,
          websocketURL: "wss://cloud.example/rooms/room_cloud/connect",
        }),
      },
    });
    const Harness = makeRoomHarness(cloudBindings);

    render(
      <cloudBindings.OpenturnProvider>
        <Harness />
      </cloudBindings.OpenturnProvider>,
    );

    // Wait for the websocket to be opened (cloud "game" scope auto-connects).
    await waitFor(() => {
      expect(MockWebSocket.instances).toHaveLength(1);
    });

    // Initial mount: no snapshot yet — emit `null`.
    expect(messages.map((m) => m.deadline)).toEqual([null]);

    // Open + push a snapshot with deadline T1.
    const T1 = 1_700_000_000_000;
    act(() => {
      MockWebSocket.instances[0]?.emit("open", {});
      MockWebSocket.instances[0]?.emit("message", {
        data: JSON.stringify(makeSnapshotMessage(T1, 1)),
      });
    });

    await waitFor(() => {
      expect(messages.map((m) => m.deadline)).toEqual([null, T1]);
    });

    // Push a snapshot with a different deadline T2.
    const T2 = T1 + 30_000;
    act(() => {
      MockWebSocket.instances[0]?.emit("message", {
        data: JSON.stringify(makeSnapshotMessage(T2, 2)),
      });
    });

    await waitFor(() => {
      expect(messages.map((m) => m.deadline)).toEqual([null, T1, T2]);
    });
  });

  test("OpenturnProvider does not re-call setDeadline when the deadline doesn't change", async () => {
    const { parent, messages } = createDeadlineCapturingParent();
    const cloudGame = makeCloudGame();
    const cloudBindings = createOpenturnBindings(cloudGame, {
      runtime: "multiplayer",
      hosted: {
        parent,
        readInit: () => ({
          scope: "game",
          userID: "user_cloud",
          userName: "Cloud",
          playerID: "1",
          roomID: "room_cloud",
          token: "token_cloud",
          // Far-future expiry so the bridge skips token refresh (which would
          // otherwise post a token-refresh-request to our fake parent and
          // hang the connect() promise waiting 5s for a non-existent reply).
          tokenExpiresAt: 9_999_999_999,
          websocketURL: "wss://cloud.example/rooms/room_cloud/connect",
        }),
      },
    });
    const Harness = makeRoomHarness(cloudBindings);

    render(
      <cloudBindings.OpenturnProvider>
        <Harness />
      </cloudBindings.OpenturnProvider>,
    );

    await waitFor(() => {
      expect(MockWebSocket.instances).toHaveLength(1);
    });

    const T1 = 1_700_000_000_000;
    act(() => {
      MockWebSocket.instances[0]?.emit("open", {});
      MockWebSocket.instances[0]?.emit("message", {
        data: JSON.stringify(makeSnapshotMessage(T1, 1)),
      });
    });

    await waitFor(() => {
      expect(messages.map((m) => m.deadline)).toEqual([null, T1]);
    });

    // Push another snapshot with the SAME deadline (different revision).
    act(() => {
      MockWebSocket.instances[0]?.emit("message", {
        data: JSON.stringify(makeSnapshotMessage(T1, 2)),
      });
    });

    // Bridge-side dedupe (game.setDeadline) suppresses the duplicate emission,
    // so the messages list is unchanged: still just [null, T1].
    expect(messages.map((m) => m.deadline)).toEqual([null, T1]);
  });

  test("OpenturnProvider calls backend.setDeadline(null) on unmount", async () => {
    const { parent, messages } = createDeadlineCapturingParent();
    const cloudGame = makeCloudGame();
    const cloudBindings = createOpenturnBindings(cloudGame, {
      runtime: "multiplayer",
      hosted: {
        parent,
        readInit: () => ({
          scope: "game",
          userID: "user_cloud",
          userName: "Cloud",
          playerID: "1",
          roomID: "room_cloud",
          token: "token_cloud",
          // Far-future expiry so the bridge skips token refresh (which would
          // otherwise post a token-refresh-request to our fake parent and
          // hang the connect() promise waiting 5s for a non-existent reply).
          tokenExpiresAt: 9_999_999_999,
          websocketURL: "wss://cloud.example/rooms/room_cloud/connect",
        }),
      },
    });
    const Harness = makeRoomHarness(cloudBindings);

    const { unmount } = render(
      <cloudBindings.OpenturnProvider>
        <Harness />
      </cloudBindings.OpenturnProvider>,
    );

    await waitFor(() => {
      expect(MockWebSocket.instances).toHaveLength(1);
    });

    const T1 = 1_700_000_000_000;
    act(() => {
      MockWebSocket.instances[0]?.emit("open", {});
      MockWebSocket.instances[0]?.emit("message", {
        data: JSON.stringify(makeSnapshotMessage(T1, 1)),
      });
    });

    await waitFor(() => {
      expect(messages.map((m) => m.deadline)).toEqual([null, T1]);
    });

    // Unmount: cleanup effect should clear the deadline.
    unmount();
    expect(messages.at(-1)?.deadline).toBe(null);
    expect(messages.map((m) => m.deadline)).toEqual([null, T1, null]);
  });
});

afterEach(() => {
  cleanup();
  unstubAllGlobals();
});
