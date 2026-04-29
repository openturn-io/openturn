// @vitest-environment jsdom

import { useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

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

afterEach(() => {
  cleanup();
  unstubAllGlobals();
});
