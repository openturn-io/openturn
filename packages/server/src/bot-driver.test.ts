import { describe, expect, test } from "bun:test";
import { defineBot } from "@openturn/bot";
import { createLocalSession, type PlayerID } from "@openturn/core";
import { defineGame, turn } from "@openturn/gamekit";

import { BotDriver, resolveBotMap, resolveBotMapFromSeats } from "./bot-driver";

interface CounterState {
  value: number;
  log: string[];
}

interface IncArgs {
  amount: number;
}

const counterMatch = { players: ["0", "1"] as const };

const counterGame = defineGame({
  playerIDs: counterMatch.players,
  setup: (): CounterState => ({ value: 0, log: [] }),
  turn: turn.roundRobin(),
  legalActions: ({ G, derived }, playerID) => {
    if (!derived.activePlayers.includes(playerID)) return [];
    return [
      { event: "inc", payload: { amount: 1 } },
      { event: "inc", payload: { amount: 2 } },
      { event: "inc", payload: { amount: 3 } },
    ];
  },
  moves: ({ move }) => ({
    inc: move<IncArgs>({
      run({ G, args, move, player }) {
        const value = G.value + args.amount;
        const log = [...G.log, `${player.id}+${args.amount}`];
        if (value >= 10) return move.finish({ winner: player.id }, { value, log });
        return move.endTurn({ value, log });
      },
    }),
  }),
});

const alwaysOneBot = defineBot<typeof counterGame>({
  name: "always-one",
  decide: ({ legalActions }) =>
    legalActions.find((a) => (a.payload as IncArgs).amount === 1) ?? legalActions[0]!,
});

const alwaysThreeBot = defineBot<typeof counterGame>({
  name: "always-three",
  decide: ({ legalActions }) =>
    legalActions.find((a) => (a.payload as IncArgs).amount === 3) ?? legalActions[0]!,
});

const registry = {
  entries: [
    { botID: "one", bot: alwaysOneBot },
    { botID: "three", bot: alwaysThreeBot },
  ],
};

describe("resolveBotMap()", () => {
  test("builds a playerID → Bot map from bot assignments", () => {
    const map = resolveBotMap(registry as never, [
      { kind: "human", playerID: "0", botID: null },
      { kind: "bot", playerID: "1", botID: "three" },
    ]);
    expect(map).not.toBeNull();
    expect(map!.size).toBe(1);
    expect(map!.get("1")).toBe(alwaysThreeBot as never);
  });

  test("returns null when no bot assignments", () => {
    const map = resolveBotMap(registry as never, [
      { kind: "human", playerID: "0", botID: null },
      { kind: "human", playerID: "1", botID: null },
    ]);
    expect(map).toBeNull();
  });

  test("returns null when no registry", () => {
    expect(
      resolveBotMap(undefined, [{ kind: "bot", playerID: "0", botID: "x" }]),
    ).toBeNull();
  });

  test("skips assignments whose botID is unknown to the registry", () => {
    const map = resolveBotMap(registry as never, [
      { kind: "bot", playerID: "0", botID: "nope" },
      { kind: "bot", playerID: "1", botID: "three" },
    ]);
    expect(map!.size).toBe(1);
    expect(map!.has("0")).toBe(false);
    expect(map!.has("1")).toBe(true);
  });
});

describe("resolveBotMapFromSeats()", () => {
  test("rebuilds bot assignments from persisted lobby seats", () => {
    const map = resolveBotMapFromSeats(registry as never, [
      { kind: "human", seatIndex: 0 },
      { kind: "bot", seatIndex: 2, botID: "three" },
    ], ["0", "1", "3"]);

    expect(map).not.toBeNull();
    expect(map!.size).toBe(1);
    expect(map!.get("3")).toBe(alwaysThreeBot as never);
  });

  test("returns null when persisted seats contain no known bots", () => {
    const map = resolveBotMapFromSeats(registry as never, [
      { kind: "human", seatIndex: 0 },
      { kind: "bot", seatIndex: 1, botID: "missing" },
    ], ["0", "1"]);

    expect(map).toBeNull();
  });
});

describe("BotDriver.tick()", () => {
  test("dispatches a bot move when its seat is active", async () => {
    const session = createLocalSession(counterGame, { match: counterMatch, seed: "tick-1" });
    const driver = new BotDriver({
      game: counterGame,
      bots: new Map([["1", alwaysThreeBot as never]]),
    });

    // Human plays seat 0 first.
    session.applyEvent("0" as PlayerID, "inc", { amount: 1 });
    expect(session.getState().G.log).toEqual(["0+1"]);

    // Now seat 1 is active. Tick the driver — bot should dispatch.
    const dispatched: unknown[] = [];
    await driver.tick({
      session,
      matchID: "test-room",
      dispatch: async (message) => {
        dispatched.push(message);
        const action = message as { type: string; playerID: string; event: string; payload: unknown };
        if (action.type === "action") {
          session.applyEvent(action.playerID as PlayerID, action.event as never, action.payload as never);
        }
      },
    });

    expect(dispatched).toHaveLength(1);
    expect(session.getState().G.log).toEqual(["0+1", "1+3"]);
  });

  test("chains bot-vs-bot moves to termination", async () => {
    const session = createLocalSession(counterGame, { match: counterMatch, seed: "tick-2" });
    const driver = new BotDriver({
      game: counterGame,
      bots: new Map<string, never>([
        ["0", alwaysThreeBot as never],
        ["1", alwaysThreeBot as never],
      ]),
    });

    await driver.tick({
      session,
      matchID: "test-room",
      dispatch: async (message) => {
        const action = message as { type: string; playerID: string; event: string; payload: unknown };
        if (action.type === "action") {
          session.applyEvent(action.playerID as PlayerID, action.event as never, action.payload as never);
        }
      },
    });

    const final = session.getState();
    expect(final.meta.result).not.toBeNull();
    expect(final.G.log.length).toBeGreaterThanOrEqual(2);
  });

  test("does not dispatch when no bot's seat is active", async () => {
    const session = createLocalSession(counterGame, { match: counterMatch, seed: "tick-3" });
    const driver = new BotDriver({
      game: counterGame,
      bots: new Map<string, never>([["1", alwaysThreeBot as never]]),
    });

    // Seat 0 is active and seat 0 is human — no bot should fire.
    let calls = 0;
    await driver.tick({
      session,
      matchID: "test-room",
      dispatch: async () => {
        calls += 1;
      },
    });
    expect(calls).toBe(0);
  });

  test("isBot reflects the registered seats", () => {
    const driver = new BotDriver({
      game: counterGame,
      bots: new Map<string, never>([["1", alwaysOneBot as never]]),
    });
    expect(driver.isBot("0")).toBe(false);
    expect(driver.isBot("1")).toBe(true);
  });

  test("honors bot actionDelayMs before dispatch", async () => {
    const session = createLocalSession(counterGame, { match: counterMatch, seed: "tick-delay" });
    const delayedBot = defineBot<typeof counterGame>({
      name: "delayed",
      actionDelayMs: 25,
      decide: ({ legalActions }) =>
        legalActions.find((a) => (a.payload as IncArgs).amount === 1) ?? legalActions[0]!,
    });
    const delays: number[] = [];
    const driver = new BotDriver({
      game: counterGame,
      bots: new Map<string, never>([["0", delayedBot as never]]),
      sleep: async (ms) => {
        delays.push(ms);
      },
    });

    await driver.tick({
      session,
      matchID: "test-room",
      dispatch: async (message) => {
        const action = message as { type: string; playerID: string; event: string; payload: unknown };
        if (action.type === "action") {
          session.applyEvent(action.playerID as PlayerID, action.event as never, action.payload as never);
        }
      },
    });

    expect(delays).toEqual([25]);
    expect(session.getState().G.log).toEqual(["0+1"]);
  });

  test("stop() clears in-flight tracking", async () => {
    const driver = new BotDriver({
      game: counterGame,
      bots: new Map<string, never>([["1", alwaysOneBot as never]]),
    });
    driver.stop();
    expect(driver.isBot("1")).toBe(true);
  });
});
