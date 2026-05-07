import { describe, expect, test } from "bun:test";

import {
  applyProfileDelta,
  defineGame,
  defineProfile,
  rejectTransition,
  type DeadlineKey,
  type DeadlineScheduler,
  type ProfileDelta,
} from "@openturn/core";

import { createRoomRuntime, defineGameDeployment, signRoomToken, verifyRoomToken } from "./index";

const MATCH = {
  players: ["0", "1"] as const,
};

const roomGame = defineGame({
  playerIDs: MATCH.players,
  events: {
    place: {
      index: 0,
    },
  },
  initial: "play",
  setup: () => ({
    board: [null, null, null] as Array<"X" | "O" | null>,
  }),
  states: {
    play: {
      activePlayers: ({ match, position }) => [match.players[(position.turn - 1) % match.players.length]!],
      label: "Play",
    },
  },
  transitions: [
    {
      event: "place",
      from: "play",
      resolve: ({ G, event, playerID }) => {
        if (G.board[event.payload.index] !== null) {
          return rejectTransition("occupied", {
            index: event.payload.index,
          });
        }

        return {
          G: {
            board: G.board.map((cell, index) => index === event.payload.index ? (playerID === "0" ? "X" : "O") : cell),
          },
          turn: "increment",
        };
      },
      to: "play",
    },
  ],
  views: {
    player: ({ G }) => G,
  },
});

const queueGame = defineGame({
  playerIDs: MATCH.players,
  events: {
    queue: {
      amount: 0,
    },
    settle: {
      amount: 0,
    },
  },
  initial: "play",
  setup: () => ({
    history: [] as string[],
    total: 0,
  }),
  states: {
    play: {
      activePlayers: ({ match, position }) => [match.players[(position.turn - 1) % match.players.length]!],
      label: "Play",
    },
  },
  transitions: [
    {
      event: "queue",
      from: "play",
      resolve: ({ G, event }) => ({
        G: {
          history: [...G.history, "queued"],
          total: G.total + event.payload.amount,
        },
        enqueue: [
          {
            kind: "settle",
            payload: {
              amount: event.payload.amount,
            },
          },
        ],
        turn: "increment",
      }),
      to: "play",
    },
    {
      event: "settle",
      from: "play",
      resolve: ({ G, event }) => ({
        G: {
          history: [...G.history, "settled"],
          total: G.total + event.payload.amount,
        },
      }),
      to: "play",
    },
  ],
  views: {
    player: ({ G }) => G,
  },
});

const invalidTransitionResultGame = defineGame({
  playerIDs: MATCH.players,
  events: {
    breakIt: undefined,
  },
  initial: "play",
  setup: () => ({
    ok: true,
  }),
  states: {
    play: {
      activePlayers: ({ match }) => [match.players[0]!],
      label: "Play",
    },
  },
  transitions: [
    {
      event: "breakIt",
      from: "play",
      resolve: () => ({
        G: {
          bad: new Date(),
        } as never,
      }),
      to: "play",
    },
  ],
});

describe("@openturn/server", () => {
  test("signs and verifies room tokens", async () => {
    const signed = await signRoomToken(
      {
        deploymentVersion: "dev",
        exp: Math.floor(Date.now() / 1_000) + 60,
        iat: Math.floor(Date.now() / 1_000),
        playerID: "0",
        roomID: "room_123",
        scope: "game",
        userID: "user_123",
      },
      "secret",
    );

    expect(await verifyRoomToken(signed.token, "secret")).toEqual(signed.claims);
    expect(await verifyRoomToken(signed.token, "other")).toBeNull();
  });

  test("treats malformed signed room tokens as invalid", async () => {
    const payload = Buffer.from(JSON.stringify({
      deploymentVersion: "dev",
      exp: Math.floor(Date.now() / 1_000) + 60,
      iat: Math.floor(Date.now() / 1_000),
      playerID: "0",
      roomID: 123,
    })).toString("base64url");
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode("secret"),
      {
        hash: "SHA-256",
        name: "HMAC",
      },
      false,
      ["sign"],
    );
    const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
    const token = `${payload}.${Buffer.from(signature).toString("base64url")}`;

    expect(await verifyRoomToken(token, "secret")).toBeNull();
  });

  test("creates a runtime that accepts event actions and returns player-scoped batches", async () => {
    const runtime = await createRoomRuntime({
      deployment: defineGameDeployment({
        deploymentVersion: "dev",
        game: roomGame,
        gameKey: "tic-tac-toe",
        match: MATCH,
        schemaVersion: "1",
      }),
      roomID: "room_123",
    });
    const initialState = runtime.getState();
    const initialBoard: Array<"X" | "O" | null> = initialState.snapshot.G.board;

    expect(initialBoard).toEqual([null, null, null]);
    const joinEnvelope = await runtime.connect("0");
    expect(joinEnvelope[0]?.playerID).toBe("0");
    expect(joinEnvelope[0]?.message.G).toEqual({
      board: [null, null, null],
    });
    if (joinEnvelope[0]?.message.type !== "action_rejected" && "playerID" in joinEnvelope[0].message) {
      const playerBoard: Array<"X" | "O" | null> = joinEnvelope[0].message.G.board;
      expect(playerBoard).toEqual([null, null, null]);
    }

    const deliveries = await runtime.handleClientMessage({
      type: "action",
      clientActionID: "client_1",
      event: "place",
      matchID: "room_123",
      payload: {
        index: 0,
      },
      playerID: "0",
    });

    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]?.message.type).toBe("batch_applied");
    if (deliveries[0]?.message.type === "batch_applied") {
      expect(deliveries[0].message.snapshot.revision).toBe(1);
      expect(deliveries[0].message.snapshot.G).toEqual({
        board: ["X", null, null],
      });
      expect(deliveries[0].message.steps[0]).toMatchObject({
        event: {
          actionID: "m_1",
          event: "place",
        },
        kind: "action",
      });
    }
  });

  test("preserves action and queued internal step ordering in delivered batches", async () => {
    const runtime = await createRoomRuntime({
      deployment: defineGameDeployment({
        deploymentVersion: "dev",
        game: queueGame,
        gameKey: "queue-game",
        match: MATCH,
        schemaVersion: "1",
      }),
      roomID: "room_456",
    });

    const deliveries = await runtime.handleClientMessage({
      type: "action",
      clientActionID: "client_1",
      event: "queue",
      matchID: "room_456",
      payload: {
        amount: 3,
      },
      playerID: "0",
    });

    expect(deliveries[0]?.message.type).toBe("batch_applied");
    if (deliveries[0]?.message.type === "batch_applied") {
      expect(deliveries[0].message.revision).toBe(2);
      expect(deliveries[0].message.steps.map((step) => step.kind)).toEqual(["action", "internal"]);
      expect(deliveries[0].message.snapshot.G).toEqual({
        history: ["queued", "settled"],
        total: 6,
      });
    }
  });

  test("seeds connected players when recreating a hibernated room runtime", async () => {
    const runtime = await createRoomRuntime({
      connectedPlayers: ["0", "1"],
      deployment: defineGameDeployment({
        deploymentVersion: "dev",
        game: roomGame,
        gameKey: "tic-tac-toe",
        match: MATCH,
        schemaVersion: "1",
      }),
      roomID: "room_123",
    });

    const deliveries = await runtime.handleClientMessage({
      type: "action",
      clientActionID: "client_1",
      event: "place",
      matchID: "room_123",
      payload: {
        index: 0,
      },
      playerID: "0",
    });

    expect(deliveries.map((delivery) => delivery.playerID).sort()).toEqual(["0", "1"]);
  });

  test("rejects stale revisions", async () => {
    const runtime = await createRoomRuntime({
      deployment: defineGameDeployment({
        deploymentVersion: "dev",
        game: roomGame,
        gameKey: "tic-tac-toe",
        match: MATCH,
        schemaVersion: "1",
      }),
      roomID: "room_123",
    });

    await runtime.handleClientMessage({
      type: "action",
      clientActionID: "client_1",
      event: "place",
      matchID: "room_123",
      payload: {
        index: 0,
      },
      playerID: "0",
    });

    const deliveries = await runtime.handleClientMessage({
      type: "action",
      baseRevision: 0,
      clientActionID: "client_2",
      event: "place",
      matchID: "room_123",
      payload: {
        index: 1,
      },
      playerID: "1",
    });

    expect(deliveries[0]?.message).toMatchObject({
      error: "stale_revision",
      type: "action_rejected",
    });
  });

  test("preserves game-authored rejection reasons and details", async () => {
    const runtime = await createRoomRuntime({
      deployment: defineGameDeployment({
        deploymentVersion: "dev",
        game: roomGame,
        gameKey: "tic-tac-toe",
        match: MATCH,
        schemaVersion: "1",
      }),
      roomID: "room_occupied",
    });

    await runtime.handleClientMessage({
      type: "action",
      clientActionID: "client_1",
      event: "place",
      matchID: "room_occupied",
      payload: {
        index: 0,
      },
      playerID: "0",
    });

    const deliveries = await runtime.handleClientMessage({
      type: "action",
      clientActionID: "client_2",
      event: "place",
      matchID: "room_occupied",
      payload: {
        index: 0,
      },
      playerID: "1",
    });

    expect(deliveries[0]?.message).toMatchObject({
      clientActionID: "client_2",
      details: {
        index: 0,
      },
      error: "invalid_event",
      event: "place",
      reason: "occupied",
      type: "action_rejected",
    });
  });

  test("invokes onSettle exactly once with the commit delta when the match terminates", async () => {
    const finishGame = defineGame({
      playerIDs: MATCH.players,
      events: { finish: undefined },
      initial: "play",
      profile: defineProfile<{ wins: number }, readonly ["0", "1"]>({
        schemaVersion: "1",
        default: { wins: 0 },
        commit: ({ result }) => ({
          [result as "0" | "1"]: [{ op: "inc", path: ["wins"], value: 1 }],
        }),
      }),
      setup: () => ({ over: false }),
      states: {
        done: { activePlayers: () => [] },
        play: {
          activePlayers: ({ match }) => [match.players[0]],
          label: "Play",
        },
      },
      transitions: [
        {
          event: "finish",
          from: "play",
          resolve: () => ({ G: { over: true }, result: "0" }),
          to: "done",
        },
      ],
    });

    const settleCalls: Array<{
      delta: unknown;
      gameKey: string;
      profilesAtSetup: unknown;
      result: unknown;
      roomID: string;
    }> = [];

    const runtime = await createRoomRuntime({
      deployment: defineGameDeployment({
        deploymentVersion: "dev",
        game: finishGame,
        gameKey: "finish-game",
        match: { players: ["0", "1"] as const },
        schemaVersion: "1",
      }),
      onSettle: async (input) => {
        settleCalls.push({
          delta: input.delta,
          gameKey: input.gameKey,
          profilesAtSetup: input.profilesAtSetup,
          result: input.result,
          roomID: input.roomID,
        });
      },
      roomID: "room_settle",
    });

    await runtime.handleClientMessage({
      type: "action",
      clientActionID: "client_1",
      event: "finish",
      matchID: "room_settle",
      payload: null,
      playerID: "0",
    });

    // Re-apply after terminal — should not re-fire (game is already over, action will be rejected anyway).
    await runtime.handleClientMessage({
      type: "action",
      clientActionID: "client_2",
      event: "finish",
      matchID: "room_settle",
      payload: null,
      playerID: "0",
    });

    expect(settleCalls).toHaveLength(1);
    expect(settleCalls[0]).toMatchObject({
      delta: { "0": [{ op: "inc", path: ["wins"], value: 1 }] },
      gameKey: "finish-game",
      profilesAtSetup: { "0": { wins: 0 }, "1": { wins: 0 } },
      result: "0",
      roomID: "room_settle",
    });

    // Simulate the cloud applying the delta to the winner's stored profile.
    const storedProfile = settleCalls[0]!.profilesAtSetup as { [k: string]: { wins: number } };
    const winnerDelta = (settleCalls[0]!.delta as { "0": ProfileDelta })["0"]!;
    const applied = applyProfileDelta(storedProfile["0"]!, winnerDelta);
    expect(applied).toEqual({ ok: true, data: { wins: 1 } });
  });

  test("surfaces invalid transition results to hosted clients", async () => {
    const runtime = await createRoomRuntime({
      deployment: defineGameDeployment({
        deploymentVersion: "dev",
        game: invalidTransitionResultGame,
        gameKey: "invalid-transition-result",
        match: MATCH,
        schemaVersion: "1",
      }),
      roomID: "room_invalid_transition",
    });

    const deliveries = await runtime.handleClientMessage({
      type: "action",
      clientActionID: "client_1",
      event: "breakIt",
      matchID: "room_invalid_transition",
      payload: null,
      playerID: "0",
    });

    expect(deliveries).toEqual([
      {
        message: {
          clientActionID: "client_1",
          error: "invalid_transition_result",
          event: "breakIt",
          matchID: "room_invalid_transition",
          revision: 0,
          type: "action_rejected",
        },
        playerID: "0",
      },
    ]);
  });
});

class FakeScheduler implements DeadlineScheduler {
  public calls: Array<{ key: DeadlineKey; at: number | null }> = [];
  public setDeadline(key: DeadlineKey, at: number | null): void {
    this.calls.push({ key, at });
  }
}

const deadlineGameWithTimeout = defineGame({
  playerIDs: MATCH.players,
  events: { noop: undefined },
  initial: "play",
  setup: () => ({}),
  states: {
    play: {
      activePlayers: () => ["0"],
      deadline: 1_000,
    },
    done: { activePlayers: () => [] },
  },
  transitions: [
    { kind: "timeout" as const, from: "play", to: "done", resolve: () => null },
  ],
});

const deadlineGameNoDeadline = defineGame({
  playerIDs: MATCH.players,
  events: { noop: undefined },
  initial: "play",
  setup: () => ({}),
  states: {
    play: { activePlayers: () => ["0"] },
  },
  transitions: [],
});

describe("RoomRuntime — DeadlineScheduler integration", () => {
  test("setDeadline('turn-timeout', X) is called after constructing the runtime", async () => {
    const scheduler = new FakeScheduler();
    await createRoomRuntime({
      deployment: defineGameDeployment({
        deploymentVersion: "dev",
        game: deadlineGameWithTimeout,
        gameKey: "deadline-game",
        match: MATCH,
        schemaVersion: "1",
      }),
      roomID: "room_deadline_construct",
      scheduler,
    });
    expect(scheduler.calls.some((c) => c.key === "turn-timeout" && c.at === 1_000)).toBe(true);
  });

  test("setDeadline('turn-timeout', null) is called when no deadline is set", async () => {
    const scheduler = new FakeScheduler();
    await createRoomRuntime({
      deployment: defineGameDeployment({
        deploymentVersion: "dev",
        game: deadlineGameNoDeadline,
        gameKey: "deadline-game-no-deadline",
        match: MATCH,
        schemaVersion: "1",
      }),
      roomID: "room_deadline_null",
      scheduler,
    });
    expect(scheduler.calls.some((c) => c.key === "turn-timeout" && c.at === null)).toBe(true);
  });

  test("RoomRuntime.fireTimeout() applies the timeout transition", async () => {
    const scheduler = new FakeScheduler();
    const runtime = await createRoomRuntime({
      deployment: defineGameDeployment({
        deploymentVersion: "dev",
        game: deadlineGameWithTimeout,
        gameKey: "deadline-game",
        match: MATCH,
        schemaVersion: "1",
      }),
      roomID: "room_deadline_fire",
      scheduler,
    });
    await runtime.fireTimeout(2_000);
    // The wire-shaped `runtime.getState().snapshot` re-protocolizes the
    // action log; with the timeout sentinel emitted as a `type: "internal"`
    // record (matching `ProtocolInternalEventRecordSchema`'s `playerID: null`
    // shape) the wire shape now round-trips cleanly, so we can assert via
    // the public state.
    expect(runtime.getState().snapshot.position.node).toBe("done");
  });

  test("RoomRuntime.fireTimeout() no-ops when deadline not yet elapsed (idempotency)", async () => {
    const scheduler = new FakeScheduler();
    const runtime = await createRoomRuntime({
      deployment: defineGameDeployment({
        deploymentVersion: "dev",
        game: deadlineGameWithTimeout,
        gameKey: "deadline-game",
        match: MATCH,
        schemaVersion: "1",
      }),
      roomID: "room_deadline_idem",
      scheduler,
    });
    await runtime.fireTimeout(500); // before deadline
    expect(runtime.getState().snapshot.position.node).not.toBe("done");
  });

  test("RoomRuntime.fireTimeout() re-arms scheduler after firing", async () => {
    const scheduler = new FakeScheduler();
    const runtime = await createRoomRuntime({
      deployment: defineGameDeployment({
        deploymentVersion: "dev",
        game: deadlineGameWithTimeout,
        gameKey: "deadline-game",
        match: MATCH,
        schemaVersion: "1",
      }),
      roomID: "room_deadline_rearm",
      scheduler,
    });
    scheduler.calls = [];
    await runtime.fireTimeout(2_000);
    // After firing into "done" (no deadline), scheduler should be cleared with null.
    expect(scheduler.calls.some((c) => c.key === "turn-timeout" && c.at === null)).toBe(true);
  });
});

describe("RoomRuntime — restore-from-persistence preserves recorded action timestamps", () => {
  test("replayIntoSession uses applyEventAt so recorded `at` flows back into the rebuilt session", async () => {
    // Capture the recorded log from a first runtime, then re-create a runtime
    // with the same persistence record. The rebuilt session's meta.log should
    // carry the original `at` values (NOT Date.now() at restore time), and
    // its meta.now should reflect the last recorded event — proving
    // replayIntoSession went through applyEventAt.
    const persistence = createInMemoryPersistence();
    const deployment = defineGameDeployment({
      deploymentVersion: "v1",
      schemaVersion: "1",
      gameKey: "test:restore",
      game: roomGame,
    });
    const first = await createRoomRuntime({
      deployment,
      roomID: "room_restore",
      initialNow: 1_000,
      persistence,
      connectedPlayers: ["0", "1"],
    });
    const result = await first.handleClientMessage({
      type: "action",
      matchID: "room_restore",
      clientActionID: "ca_1",
      playerID: "0",
      event: "place",
      payload: { index: 0 },
    });
    const recordedAt = (result[0]?.message as { steps?: ReadonlyArray<{ event?: { at?: number } }> })
      .steps?.[0]?.event?.at;
    expect(typeof recordedAt).toBe("number");
    expect(recordedAt).not.toBe(1_000);  // applyEvent stamped Date.now()

    // Re-create — the second runtime replays the persisted log via
    // replayIntoSession, which after the C1 fix uses applyEventAt and
    // therefore preserves recordedAt rather than restamping with Date.now().
    const second = await createRoomRuntime({
      deployment,
      roomID: "room_restore",
      initialNow: 9_999_999,  // deliberately divergent — should be ignored when persistence has data
      persistence,
      connectedPlayers: [],
    });
    const restoredLog = second.getState().snapshot.log;
    expect(restoredLog.length).toBeGreaterThan(0);
    expect(restoredLog[0]?.at).toBe(recordedAt);
  });
});

function createInMemoryPersistence() {
  let stored: import("./index").RoomPersistenceRecord | null = null;
  return {
    async load() {
      return stored;
    },
    async save(record: import("./index").RoomPersistenceRecord) {
      stored = record;
    },
  };
}
