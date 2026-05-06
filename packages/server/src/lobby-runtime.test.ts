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

  test("requireHumanSeat rejects bots-only start with no_humans_seated", () => {
    const runtime = new LobbyRuntime(
      env({ knownBots: knownBots(), requireHumanSeat: true }),
    );
    runtime.assignBot(HOST, 0, "random");
    runtime.assignBot(HOST, 1, "minimax-hard");
    expect(runtime.start(HOST)).toEqual({ ok: false, reason: "no_humans_seated" });
  });

  test("requireHumanSeat allows mixed human + bot start", () => {
    const runtime = new LobbyRuntime(
      env({ knownBots: knownBots(), requireHumanSeat: true }),
    );
    runtime.assignBot(HOST, 1, "random");
    runtime.takeSeat(ALICE, "Alice", 0);
    runtime.setReady(ALICE, true);
    const result = runtime.start(HOST);
    expect(result.ok).toBe(true);
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

describe("LobbyRuntime.start() — hostPlayerID resolution", () => {
  test("multiplayer with seated host returns host's playerID", () => {
    const runtime = new LobbyRuntime(env());
    runtime.takeSeat(HOST, "Host", 0);
    runtime.takeSeat(BOB, "Bob", 1);
    runtime.setReady(HOST, true);
    runtime.setReady(BOB, true);
    const result = runtime.start(HOST);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.hostPlayerID).toBe("0");
  });

  test("multiplayer with spectating host returns null", () => {
    const runtime = new LobbyRuntime(env());
    // Host does not take a seat — only ALICE and BOB.
    runtime.takeSeat(ALICE, "Alice", 0);
    runtime.takeSeat(BOB, "Bob", 1);
    runtime.setReady(ALICE, true);
    runtime.setReady(BOB, true);
    const result = runtime.start(HOST);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.hostPlayerID).toBe(null);
  });

  test("single-player session returns null even when host is seated", () => {
    const runtime = new LobbyRuntime(env({ minPlayers: 1, maxPlayers: 1, playerIDs: ["0"] }));
    runtime.takeSeat(HOST, "Host", 0);
    runtime.setReady(HOST, true);
    const result = runtime.start(HOST);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.hostPlayerID).toBe(null);
  });

  test("host had a seat but freed it before start returns null", () => {
    const runtime = new LobbyRuntime(env());
    runtime.takeSeat(HOST, "Host", 0);
    runtime.takeSeat(BOB, "Bob", 1);
    runtime.leaveSeat(HOST);
    runtime.takeSeat(ALICE, "Alice", 0);
    runtime.setReady(ALICE, true);
    runtime.setReady(BOB, true);
    const result = runtime.start(HOST);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.hostPlayerID).toBe(null);
  });
});

describe("LobbyRuntime.setConfig()", () => {
  function envWithConfig(overrides: Partial<LobbyEnv> = {}): LobbyEnv {
    return {
      hostUserID: HOST,
      minPlayers: 2,
      maxPlayers: 2,
      playerIDs: ["0", "1"],
      configSchema: {
        turnTimeoutMs: { type: "number", default: 30_000, min: 5_000, max: 300_000, label: "Turn time" },
        variant: { type: "enum", options: ["a", "b"] as const, default: "a", label: "Variant" },
        flag: { type: "boolean", default: false, label: "Flag" },
      },
      ...overrides,
    };
  }

  test("non-host setConfig is rejected", () => {
    const runtime = new LobbyRuntime(envWithConfig());
    expect(runtime.setConfig(ALICE, "turnTimeoutMs", 60_000)).toEqual({
      ok: false,
      reason: "not_host",
    });
  });

  test("setConfig in active phase is rejected", () => {
    const runtime = new LobbyRuntime(envWithConfig());
    runtime.takeSeat(HOST, "Host", 0);
    runtime.takeSeat(BOB, "Bob", 1);
    runtime.setReady(HOST, true);
    runtime.setReady(BOB, true);
    runtime.start(HOST);
    expect(runtime.setConfig(HOST, "turnTimeoutMs", 60_000)).toEqual({
      ok: false,
      reason: "bad_phase",
    });
  });

  test("setConfig with unknown key rejects with invalid_config_value", () => {
    const runtime = new LobbyRuntime(envWithConfig());
    const result = runtime.setConfig(HOST, "mystery", 1);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("invalid_config_value");
    expect(result.configKey).toBe("mystery");
    expect(result.configDetail).toBe("unknown_key");
  });

  test("setConfig with wrong type rejects with invalid_config_value", () => {
    const runtime = new LobbyRuntime(envWithConfig());
    const result = runtime.setConfig(HOST, "turnTimeoutMs", "ten" as unknown as number);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("invalid_config_value");
    expect(result.configKey).toBe("turnTimeoutMs");
    expect(result.configDetail).toBe("expected_number");
  });

  test("setConfig with out-of-bounds number rejects", () => {
    const runtime = new LobbyRuntime(envWithConfig());
    const tooLow = runtime.setConfig(HOST, "turnTimeoutMs", 100);
    expect(tooLow.ok).toBe(false);
    if (tooLow.ok) return;
    expect(tooLow.configDetail).toMatch(/^below_min: /);

    const tooHigh = runtime.setConfig(HOST, "turnTimeoutMs", 999_999);
    expect(tooHigh.ok).toBe(false);
    if (tooHigh.ok) return;
    expect(tooHigh.configDetail).toMatch(/^above_max: /);
  });

  test("setConfig with unknown enum option rejects", () => {
    const runtime = new LobbyRuntime(envWithConfig());
    const result = runtime.setConfig(HOST, "variant", "c");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.configDetail).toMatch(/^not_in_options: /);
  });

  test("setConfig success un-readies all human seats but not bot seats", () => {
    const runtime = new LobbyRuntime(
      envWithConfig({ knownBots: new Map([["random", { label: "Random" }]]) }),
    );
    runtime.takeSeat(HOST, "Host", 0);
    runtime.assignBot(HOST, 1, "random");
    runtime.setReady(HOST, true);

    const before = runtime.buildStateMessage("room", new Set([HOST]));
    const hostSeatBefore = before.seats.find((s) => s.kind === "human");
    expect(hostSeatBefore?.kind === "human" && hostSeatBefore.ready).toBe(true);

    const result = runtime.setConfig(HOST, "turnTimeoutMs", 60_000);
    expect(result).toEqual({ ok: true, changed: true });

    const after = runtime.buildStateMessage("room", new Set([HOST]));
    const hostSeatAfter = after.seats.find((s) => s.kind === "human");
    expect(hostSeatAfter?.kind === "human" && hostSeatAfter.ready).toBe(false);
    const botSeat = after.seats.find((s) => s.kind === "bot");
    expect(botSeat).toBeDefined();  // bot seats unaffected
  });

  test("setConfig with no schema rejects every key", () => {
    const runtime = new LobbyRuntime(env());  // existing env() helper, no schema
    const result = runtime.setConfig(HOST, "anything", 1);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("invalid_config_value");
    expect(result.configDetail).toBe("no_schema");
  });

  test("buildStateMessage includes config.values when schema present", () => {
    const runtime = new LobbyRuntime(envWithConfig());
    const state = runtime.buildStateMessage("room", new Set([HOST]));
    expect(state.config).toEqual({
      values: { turnTimeoutMs: 30_000, variant: "a", flag: false },
    });
  });

  test("buildStateMessage omits config when schema absent", () => {
    const runtime = new LobbyRuntime(env());
    const state = runtime.buildStateMessage("room", new Set([HOST]));
    expect(state.config).toBeUndefined();
  });

  test("setConfig success reflects in subsequent buildStateMessage", () => {
    const runtime = new LobbyRuntime(envWithConfig());
    runtime.setConfig(HOST, "turnTimeoutMs", 60_000);
    const state = runtime.buildStateMessage("room", new Set([HOST]));
    expect(state.config?.values.turnTimeoutMs).toBe(60_000);
  });
});

describe("LobbyRuntime.start() — config in result", () => {
  test("start() returns config.values snapshot", () => {
    const runtime = new LobbyRuntime({
      hostUserID: HOST,
      minPlayers: 2,
      maxPlayers: 2,
      playerIDs: ["0", "1"],
      configSchema: {
        n: { type: "number", default: 5, label: "N" },
      },
    });
    runtime.takeSeat(HOST, "Host", 0);
    runtime.takeSeat(BOB, "Bob", 1);
    runtime.setConfig(HOST, "n", 10);
    // setConfig un-readies all humans (by design); ready them here so start
    // succeeds and we can assert on the config snapshot in the result.
    runtime.setReady(HOST, true);
    runtime.setReady(BOB, true);
    const result = runtime.start(HOST);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config).toEqual({ values: { n: 10 } });
  });

  test("start() returns null config when no schema", () => {
    const runtime = new LobbyRuntime(env());
    runtime.takeSeat(ALICE, "Alice", 0);
    runtime.takeSeat(BOB, "Bob", 1);
    runtime.setReady(ALICE, true);
    runtime.setReady(BOB, true);
    const result = runtime.start(HOST);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config).toBeNull();
  });
});

describe("LobbyRuntime persistence with config", () => {
  test("config values round-trip through serialize / re-construct", () => {
    const sharedEnv: LobbyEnv = {
      hostUserID: HOST,
      minPlayers: 2,
      maxPlayers: 2,
      playerIDs: ["0", "1"],
      configSchema: {
        n: { type: "number", default: 5, label: "N" },
      },
    };
    const runtime = new LobbyRuntime(sharedEnv);
    runtime.setConfig(HOST, "n", 42);
    const persisted = runtime.toPersisted();
    const rehydrated = new LobbyRuntime(sharedEnv, persisted);
    const state = rehydrated.buildStateMessage("room", new Set([HOST]));
    expect(state.config?.values.n).toBe(42);
  });
});
