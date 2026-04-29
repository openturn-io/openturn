import { describe, expect, test } from "bun:test";
import { createLocalSession, createRng, type PlayerID } from "@openturn/core";
import { defineGame, turn } from "@openturn/gamekit";

import {
  defineBot,
  simulate,
  enumerateLegalActions,
  forkRng,
  attachLocalBots,
  createDeadline,
  type LegalAction,
} from "./index";

interface CountState {
  value: number;
  log: string[];
}

interface IncArgs {
  amount: number;
}

const countMatch = { players: ["0", "1"] as const };

const countGame = defineGame({
  playerIDs: countMatch.players,
  setup: (): CountState => ({ value: 0, log: [] }),
  turn: turn.roundRobin(),
  legalActions: ({ G, derived }, playerID) => {
    if (!derived.activePlayers.includes(playerID)) return [];
    const out: LegalAction[] = [];
    for (let amount = 1; amount <= 3; amount += 1) {
      out.push({ event: "inc", payload: { amount }, label: `+${amount}` });
    }
    return out;
  },
  moves: ({ move }) => ({
    inc: move<IncArgs>({
      run({ G, args, move, player }) {
        if (args.amount < 1 || args.amount > 3) {
          return move.invalid("out_of_range", { amount: args.amount });
        }
        const value = G.value + args.amount;
        const log = [...G.log, `${player.id}+${args.amount}`];
        if (value >= 10) {
          return move.finish({ winner: player.id }, { value, log });
        }
        return move.endTurn({ value, log });
      },
    }),
  }),
});

const playersOf = (): readonly PlayerID[] => ["0", "1"];

describe("simulate()", () => {
  test("produces the next snapshot for a legal move without mutating the original", () => {
    const session = createLocalSession(countGame, { match: countMatch, seed: "sim" });
    const before = session.getState();

    const result = simulate(countGame, before, "0", { event: "inc", payload: { amount: 2 } });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outcome).toBe("endTurn");
    expect(result.next.G.value).toBe(2);

    const after = session.getState();
    expect(after.G.value).toBe(0);
    expect(after.position.turn).toBe(before.position.turn);
  });

  test("returns ok:false for an illegal move", () => {
    const session = createLocalSession(countGame, { match: countMatch, seed: "sim2" });
    const snapshot = session.getState();

    const result = simulate(countGame, snapshot, "0", { event: "inc", payload: { amount: 99 } });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("invalid_event");
  });

  test("flags 'finish' when the move ends the game", () => {
    const session = createLocalSession(countGame, { match: countMatch, seed: "sim3" });
    // Drive value up to 8.
    session.applyEvent("0", "inc", { amount: 3 });
    session.applyEvent("1", "inc", { amount: 3 });
    session.applyEvent("0", "inc", { amount: 2 });
    expect(session.getState().G.value).toBe(8);

    const snapshot = session.getState();
    const active = snapshot.derived.activePlayers[0]!;
    const result = simulate(countGame, snapshot, active, { event: "inc", payload: { amount: 3 } });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outcome).toBe("finish");
  });
});

describe("enumerateLegalActions()", () => {
  test("uses the game's legalActions hook", () => {
    const session = createLocalSession(countGame, { match: countMatch, seed: "leg" });
    const snapshot = session.getState();
    const view = session.getPlayerView("0");

    const dummy = defineBot<typeof countGame>({ name: "dummy", decide: ({ legalActions }) => legalActions[0]! });
    const actions = enumerateLegalActions(countGame, snapshot, view, "0", dummy);

    expect(actions).toHaveLength(3);
  });

  test("returns empty when it is not the requested seat's turn", () => {
    const session = createLocalSession(countGame, { match: countMatch, seed: "leg2" });
    const snapshot = session.getState();
    const view = session.getPlayerView("1");
    const dummy = defineBot<typeof countGame>({ name: "dummy", decide: ({ legalActions }) => legalActions[0]! });

    const actions = enumerateLegalActions(countGame, snapshot, view, "1", dummy);

    expect(actions).toEqual([]);
  });

  test("falls back to the bot's own enumerator when game has no hook", () => {
    const noHookMatch = { players: ["0", "1"] as const };
    const noHookGame = defineGame({
  playerIDs: noHookMatch.players,
      setup: () => ({ value: 0 }),
      turn: turn.roundRobin(),
      moves: ({ move }) => ({
        inc: move({
          run({ move }) {
            return move.endTurn({ value: 1 });
          },
        }),
      }),
    });
    const session = createLocalSession(noHookGame, { match: noHookMatch, seed: "noh" });
    const snapshot = session.getState();
    const view = session.getPlayerView("0");

    const bot = defineBot<typeof noHookGame>({
      name: "fallback",
      enumerate: () => [{ event: "inc", payload: undefined as never }],
      decide: ({ legalActions }) => legalActions[0]!,
    });

    const actions = enumerateLegalActions(noHookGame, snapshot, view, "0", bot);

    expect(actions).toHaveLength(1);
  });
});

describe("forkRng()", () => {
  test("is deterministic given the same base + salt", () => {
    const base = createRng("base").getSnapshot();
    const r1 = forkRng(base, "bot", "0", 0);
    const r2 = forkRng(base, "bot", "0", 0);

    const a = Array.from({ length: 16 }, () => r1.next());
    const b = Array.from({ length: 16 }, () => r2.next());

    expect(a).toEqual(b);
  });

  test("differs across player IDs", () => {
    const base = createRng("base").getSnapshot();
    const a = Array.from({ length: 8 }, () => forkRng(base, "bot", "0", 0).next());
    const b = Array.from({ length: 8 }, () => forkRng(base, "bot", "1", 0).next());

    expect(a).not.toEqual(b);
  });

  test("BotRng.pick is reproducible across forks of the same snapshot", () => {
    const base = createRng("base").getSnapshot();
    const items = ["a", "b", "c", "d"];
    const seq1 = Array.from({ length: 12 }, () => forkRng(base, "n", "0", 0).pick(items));
    const seq2 = Array.from({ length: 12 }, () => forkRng(base, "n", "0", 0).pick(items));
    expect(seq1).toEqual(seq2);
  });
});

describe("createDeadline()", () => {
  test("counts down from injected clock", () => {
    let now = 1_000;
    const clock = { now: () => now };
    const deadline = createDeadline(500, clock);
    expect(deadline.expired()).toBe(false);
    expect(deadline.remainingMs()).toBe(500);
    now = 1_400;
    expect(deadline.remainingMs()).toBe(100);
    now = 1_500;
    expect(deadline.expired()).toBe(true);
  });
});

describe("attachLocalBots runner", () => {
  test("two bots driven by a shared bus play to termination", async () => {
    const rawSession = createLocalSession(countGame, { match: countMatch, seed: "runner" });
    const bot = defineBot<typeof countGame>({
      name: "always-three",
      decide: ({ legalActions }) => legalActions.find((a) => (a.payload as IncArgs).amount === 3) ?? legalActions[0]!,
    });

    const { session, isBot, whenIdle, detachAll } = attachLocalBots({
      session: rawSession,
      game: countGame,
      bots: { "0": bot, "1": bot },
    });

    for (let step = 0; step < 40; step += 1) {
      const snapshot = session.getState();
      if (snapshot.meta.result !== null && snapshot.meta.result !== undefined) break;
      const active = snapshot.derived.activePlayers[0]!;
      if (isBot(active)) await whenIdle(active);
    }

    const final = session.getState();
    expect(final.meta.result).not.toBeNull();

    detachAll();
  });

  test("waits for actionDelayMs before dispatching a bot action", async () => {
    const rawSession = createLocalSession(countGame, { match: countMatch, seed: "runner-delay" });
    const bot = defineBot<typeof countGame>({
      name: "paced-one",
      actionDelayMs: 20,
      decide: ({ legalActions }) => legalActions.find((a) => (a.payload as IncArgs).amount === 1) ?? legalActions[0]!,
    });

    const { session, whenIdle, detachAll } = attachLocalBots({
      session: rawSession,
      game: countGame,
      bots: { "0": bot },
    });

    await Promise.resolve();
    expect(session.getState().G.log).toEqual([]);

    await whenIdle("0");
    expect(session.getState().G.log).toEqual(["0+1"]);

    detachAll();
  });
});
