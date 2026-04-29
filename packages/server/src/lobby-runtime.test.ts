import { describe, expect, test } from "bun:test";

import { LobbyRuntime, type LobbyAvailableBotInfo, type LobbyEnv } from "./lobby-runtime";

const HOST = "user_host";
const ALICE = "user_alice";
const BOB = "user_bob";

function env(overrides: Partial<LobbyEnv> = {}): LobbyEnv {
  return {
    hostUserID: HOST,
    minPlayers: 2,
    maxPlayers: 2,
    playerIDs: ["0", "1"],
    ...overrides,
  };
}

function knownBots(): ReadonlyMap<string, LobbyAvailableBotInfo> {
  return new Map([
    ["random", { label: "Random", difficulty: "easy" }],
    ["minimax-hard", { label: "Minimax · hard", difficulty: "hard" }],
  ]);
}

describe("LobbyRuntime — humans only (regression)", () => {
  test("seats a user and emits a human seat", () => {
    const runtime = new LobbyRuntime(env());
    const result = runtime.takeSeat(ALICE, "Alice", 0);
    expect(result).toEqual({ ok: true, changed: true });

    const state = runtime.buildStateMessage("room_x", new Set([ALICE]));
    expect(state.seats[0]).toEqual({
      kind: "human",
      seatIndex: 0,
      userID: ALICE,
      userName: "Alice",
      ready: false,
      connected: true,
    });
    expect(state.seats[1]).toEqual({ kind: "open", seatIndex: 1 });
  });

  test("setReady toggles only for seated humans", () => {
    const runtime = new LobbyRuntime(env());
    runtime.takeSeat(ALICE, "Alice", 0);
    expect(runtime.setReady(ALICE, true)).toEqual({ ok: true, changed: true });
    expect(runtime.setReady(BOB, true)).toEqual({ ok: false, reason: "not_seated" });
  });

  test("start() requires both players seated and ready", () => {
    const runtime = new LobbyRuntime(env());
    runtime.takeSeat(ALICE, "Alice", 0);
    runtime.setReady(ALICE, true);
    expect(runtime.start(HOST)).toEqual({
      ok: false,
      reason: "below_min_players",
    });

    runtime.takeSeat(BOB, "Bob", 1);
    expect(runtime.start(HOST)).toEqual({ ok: false, reason: "not_ready" });

    runtime.setReady(BOB, true);
    const result = runtime.start(HOST);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.assignments).toEqual([
      { seatIndex: 0, playerID: "0", kind: "human", userID: ALICE, botID: null },
      { seatIndex: 1, playerID: "1", kind: "human", userID: BOB, botID: null },
    ]);
    expect(runtime.mode).toBe("active");
  });

  test("non-host start is rejected", () => {
    const runtime = new LobbyRuntime(env());
    runtime.takeSeat(ALICE, "Alice", 0);
    runtime.takeSeat(BOB, "Bob", 1);
    runtime.setReady(ALICE, true);
    runtime.setReady(BOB, true);
    expect(runtime.start(ALICE)).toEqual({ ok: false, reason: "not_host" });
  });
});

describe("LobbyRuntime.assignBot()", () => {
  test("host assigns a known bot to an open seat", () => {
    const runtime = new LobbyRuntime(env({ knownBots: knownBots() }));
    expect(runtime.assignBot(HOST, 1, "random")).toEqual({ ok: true, changed: true });

    const state = runtime.buildStateMessage("room_x", new Set());
    expect(state.seats[1]).toEqual({
      kind: "bot",
      seatIndex: 1,
      botID: "random",
      label: "Random",
    });
    expect(state.availableBots).toEqual([
      { botID: "random", label: "Random", difficulty: "easy" },
      { botID: "minimax-hard", label: "Minimax · hard", difficulty: "hard" },
    ]);
  });

  test("replacing a bot with the same descriptor is a no-op", () => {
    const runtime = new LobbyRuntime(env({ knownBots: knownBots() }));
    runtime.assignBot(HOST, 0, "random");
    expect(runtime.assignBot(HOST, 0, "random")).toEqual({ ok: true, changed: false });
  });

  test("non-host cannot assign", () => {
    const runtime = new LobbyRuntime(env({ knownBots: knownBots() }));
    expect(runtime.assignBot(ALICE, 0, "random")).toEqual({
      ok: false,
      reason: "not_host",
    });
  });

  test("rejects unknown botID", () => {
    const runtime = new LobbyRuntime(env({ knownBots: knownBots() }));
    expect(runtime.assignBot(HOST, 0, "nope")).toEqual({
      ok: false,
      reason: "unknown_bot",
    });
  });

  test("rejects out-of-range seat", () => {
    const runtime = new LobbyRuntime(env({ knownBots: knownBots() }));
    expect(runtime.assignBot(HOST, 99, "random")).toEqual({
      ok: false,
      reason: "seat_out_of_range",
    });
  });

  test("rejects when the seat already holds a human", () => {
    const runtime = new LobbyRuntime(env({ knownBots: knownBots() }));
    runtime.takeSeat(ALICE, "Alice", 0);
    expect(runtime.assignBot(HOST, 0, "random")).toEqual({
      ok: false,
      reason: "seat_has_human",
    });
  });

  test("rejects assignment outside the lobby phase", () => {
    const runtime = new LobbyRuntime(env({ knownBots: knownBots() }));
    runtime.takeSeat(ALICE, "Alice", 0);
    runtime.takeSeat(BOB, "Bob", 1);
    runtime.setReady(ALICE, true);
    runtime.setReady(BOB, true);
    runtime.start(HOST);
    expect(
      runtime.apply(HOST, "Host", { type: "lobby:assign_bot", seatIndex: 0, botID: "random" }),
    ).toEqual({ ok: false, reason: "bad_phase" });
  });

  test("disabled when knownBots is empty", () => {
    const runtime = new LobbyRuntime(env());
    expect(runtime.assignBot(HOST, 0, "random")).toEqual({
      ok: false,
      reason: "unknown_bot",
    });
  });
});

describe("LobbyRuntime.clearSeat()", () => {
  test("host clears a bot seat", () => {
    const runtime = new LobbyRuntime(env({ knownBots: knownBots() }));
    runtime.assignBot(HOST, 0, "random");
    expect(runtime.clearSeat(HOST, 0)).toEqual({ ok: true, changed: true });
    const state = runtime.buildStateMessage("room", new Set());
    expect(state.seats[0]).toEqual({ kind: "open", seatIndex: 0 });
  });

  test("host clears a human seat (kick)", () => {
    const runtime = new LobbyRuntime(env({ knownBots: knownBots() }));
    runtime.takeSeat(ALICE, "Alice", 0);
    expect(runtime.clearSeat(HOST, 0)).toEqual({ ok: true, changed: true });
  });

  test("clearing an empty seat is a no-op", () => {
    const runtime = new LobbyRuntime(env({ knownBots: knownBots() }));
    expect(runtime.clearSeat(HOST, 0)).toEqual({ ok: true, changed: false });
  });

  test("non-host cannot clear", () => {
    const runtime = new LobbyRuntime(env({ knownBots: knownBots() }));
    runtime.assignBot(HOST, 0, "random");
    expect(runtime.clearSeat(ALICE, 0)).toEqual({ ok: false, reason: "not_host" });
  });

  test("after clearing a bot seat, a human can take it", () => {
    const runtime = new LobbyRuntime(env({ knownBots: knownBots() }));
    runtime.assignBot(HOST, 0, "random");
    runtime.clearSeat(HOST, 0);
    expect(runtime.takeSeat(ALICE, "Alice", 0)).toEqual({ ok: true, changed: true });
  });
});

describe("LobbyRuntime — bot + human start", () => {
  test("takeSeat on a bot seat is rejected with seat_has_bot", () => {
    const runtime = new LobbyRuntime(env({ knownBots: knownBots() }));
    runtime.assignBot(HOST, 1, "random");
    expect(runtime.takeSeat(ALICE, "Alice", 1)).toEqual({
      ok: false,
      reason: "seat_has_bot",
    });
  });

  test("bot seats count toward minPlayers and skip the ready check", () => {
    const runtime = new LobbyRuntime(env({ knownBots: knownBots() }));
    runtime.assignBot(HOST, 1, "minimax-hard");
    runtime.takeSeat(ALICE, "Alice", 0);
    runtime.setReady(ALICE, true);

    const state = runtime.buildStateMessage("room", new Set([ALICE]));
    expect(state.canStart).toBe(true);

    const result = runtime.start(HOST);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.assignments).toEqual([
      { seatIndex: 0, playerID: "0", kind: "human", userID: ALICE, botID: null },
      { seatIndex: 1, playerID: "1", kind: "bot", userID: null, botID: "minimax-hard" },
    ]);
  });

  test("bots-only start works (capacity 2, both bots, minPlayers 2)", () => {
    const runtime = new LobbyRuntime(env({ knownBots: knownBots() }));
    runtime.assignBot(HOST, 0, "random");
    runtime.assignBot(HOST, 1, "minimax-hard");
    const result = runtime.start(HOST);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.assignments.map((a) => a.kind)).toEqual(["bot", "bot"]);
  });

  test("dropUser does not touch bot seats", () => {
    const runtime = new LobbyRuntime(env({ knownBots: knownBots() }));
    runtime.assignBot(HOST, 0, "random");
    runtime.takeSeat(ALICE, "Alice", 1);
    runtime.dropUser(ALICE);
    const state = runtime.buildStateMessage("room", new Set());
    expect(state.seats[0]?.kind).toBe("bot");
    expect(state.seats[1]?.kind).toBe("open");
  });

  test("pruneToConnected does not touch bot seats", () => {
    const runtime = new LobbyRuntime(env({ knownBots: knownBots() }));
    runtime.assignBot(HOST, 0, "random");
    runtime.takeSeat(ALICE, "Alice", 1);
    const changed = runtime.pruneToConnected(new Set([HOST])); // alice not connected
    expect(changed).toBe(true);
    expect(runtime.seats.some((s) => s.kind === "bot" && s.seatIndex === 0)).toBe(true);
    expect(runtime.seats.some((s) => s.kind === "human")).toBe(false);
  });
});

describe("LobbyRuntime.setTargetCapacity()", () => {
  function variableEnv(overrides: Partial<LobbyEnv> = {}): LobbyEnv {
    return env({
      minPlayers: 2,
      maxPlayers: 4,
      playerIDs: ["0", "1", "2", "3"],
      ...overrides,
    });
  }

  test("defaults targetCapacity to maxPlayers", () => {
    const runtime = new LobbyRuntime(variableEnv());
    expect(runtime.targetCapacity).toBe(4);
    const state = runtime.buildStateMessage("room", new Set());
    expect(state.targetCapacity).toBe(4);
    expect(state.maxPlayers).toBe(4);
    expect(state.minPlayers).toBe(2);
    expect(state.seats).toHaveLength(4);
  });

  test("host shrinks capacity and evicts out-of-range seats", () => {
    const runtime = new LobbyRuntime(variableEnv());
    runtime.takeSeat(ALICE, "Alice", 0);
    runtime.takeSeat(BOB, "Bob", 3);
    expect(runtime.setTargetCapacity(HOST, 2)).toEqual({ ok: true, changed: true });
    expect(runtime.targetCapacity).toBe(2);
    const seats = runtime.seats;
    expect(seats.some((s) => s.kind === "human" && s.seatIndex === 0)).toBe(true);
    expect(seats.some((s) => s.seatIndex === 3)).toBe(false);
  });

  test("host raises capacity (no eviction)", () => {
    const runtime = new LobbyRuntime(variableEnv({ targetCapacity: 2 }));
    expect(runtime.targetCapacity).toBe(2);
    runtime.takeSeat(ALICE, "Alice", 0);
    expect(runtime.setTargetCapacity(HOST, 4)).toEqual({ ok: true, changed: true });
    expect(runtime.targetCapacity).toBe(4);
    expect(runtime.buildStateMessage("room", new Set()).seats).toHaveLength(4);
  });

  test("rejects target_below_min", () => {
    const runtime = new LobbyRuntime(variableEnv());
    expect(runtime.setTargetCapacity(HOST, 1)).toEqual({
      ok: false,
      reason: "target_below_min",
    });
  });

  test("rejects target_above_max", () => {
    const runtime = new LobbyRuntime(variableEnv());
    expect(runtime.setTargetCapacity(HOST, 5)).toEqual({
      ok: false,
      reason: "target_above_max",
    });
  });

  test("rejects non-host", () => {
    const runtime = new LobbyRuntime(variableEnv());
    expect(runtime.setTargetCapacity(ALICE, 3)).toEqual({
      ok: false,
      reason: "not_host",
    });
  });

  test("takeSeat rejects seatIndex >= targetCapacity", () => {
    const runtime = new LobbyRuntime(variableEnv({ targetCapacity: 2 }));
    expect(runtime.takeSeat(ALICE, "Alice", 2)).toEqual({
      ok: false,
      reason: "seat_out_of_range",
    });
  });

  test("start succeeds with seated count between minPlayers and targetCapacity", () => {
    const runtime = new LobbyRuntime(variableEnv({ targetCapacity: 3 }));
    runtime.takeSeat(ALICE, "Alice", 0);
    runtime.takeSeat(BOB, "Bob", 1);
    runtime.setReady(ALICE, true);
    runtime.setReady(BOB, true);
    const result = runtime.start(HOST);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.assignments).toHaveLength(2);
  });

  test("targetCapacity persists across rehydrate", () => {
    const runtime = new LobbyRuntime(variableEnv());
    runtime.setTargetCapacity(HOST, 3);
    const persisted = runtime.toPersisted();
    const rehydrated = new LobbyRuntime(variableEnv(), persisted);
    expect(rehydrated.targetCapacity).toBe(3);
  });
});

describe("LobbyRuntime — buildStateMessage availableBots", () => {
  test("emits empty array when no knownBots", () => {
    const runtime = new LobbyRuntime(env());
    expect(runtime.buildStateMessage("room", new Set()).availableBots).toEqual([]);
  });

  test("preserves description and difficulty on catalog entries", () => {
    const runtime = new LobbyRuntime(
      env({
        knownBots: new Map([
          ["x", { label: "X", description: "great", difficulty: "expert" }],
        ]),
      }),
    );
    expect(runtime.buildStateMessage("room", new Set()).availableBots).toEqual([
      { botID: "x", label: "X", description: "great", difficulty: "expert" },
    ]);
  });
});
