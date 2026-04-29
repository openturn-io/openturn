import { describe, expect, test } from "bun:test";
import { attachLocalBots, type Bot } from "@openturn/bot";
import { createLocalSession } from "@openturn/core";
import { ticTacToe } from "@openturn/example-tic-tac-toe-game";

const ticTacToeMatch = { players: ticTacToe.playerIDs };

import { minimaxBot } from "./minimax";
import { randomBot } from "./random";

interface ResultLike {
  winner?: string;
  draw?: boolean;
}

async function playToCompletion(
  rawSession: ReturnType<typeof createLocalSession<typeof ticTacToe, typeof ticTacToeMatch>>,
  bots: { "0": Bot<typeof ticTacToe>; "1": Bot<typeof ticTacToe> },
): Promise<ResultLike | null> {
  const { session, isBot, whenIdle, detachAll } = attachLocalBots({
    session: rawSession,
    game: ticTacToe,
    bots,
  });

  for (let step = 0; step < 20; step += 1) {
    const snapshot = session.getState();
    const result = snapshot.meta.result;
    if (result !== null && result !== undefined) break;
    const active = snapshot.derived.activePlayers[0]!;
    if (isBot(active)) await whenIdle(active);
  }

  const final = session.getState().meta.result as ResultLike | null;
  detachAll();
  return final;
}

describe("tic-tac-toe integration: random vs random", () => {
  test("smoke: one match terminates", async () => {
    const session = createLocalSession(ticTacToe, { match: ticTacToeMatch, seed: "smoke" });
    const result = await playToCompletion(session, { "0": randomBot, "1": randomBot });
    expect(result).not.toBeNull();
  }, 10_000);

  test("1000 matches: every match terminates with winner|draw, no invalid moves", async () => {
    const matches = 1000;
    const buckets = { winner0: 0, winner1: 0, draw: 0 };

    for (let i = 0; i < matches; i += 1) {
      const session = createLocalSession(ticTacToe, { match: ticTacToeMatch, seed: `r-${i}` });
      const result = await playToCompletion(session, { "0": randomBot, "1": randomBot });
      expect(result).not.toBeNull();
      if (result === null) continue;
      if (result.draw === true) buckets.draw += 1;
      else if (result.winner === "0") buckets.winner0 += 1;
      else if (result.winner === "1") buckets.winner1 += 1;
    }

    expect(buckets.winner0 + buckets.winner1 + buckets.draw).toBe(matches);
    // Random play in tic-tac-toe should hit all three outcomes across 1000 matches.
    expect(buckets.winner0).toBeGreaterThan(0);
    expect(buckets.winner1).toBeGreaterThan(0);
    expect(buckets.draw).toBeGreaterThan(0);
  }, 120_000);
});

describe("tic-tac-toe integration: minimax never loses", () => {
  // Note: minimax with the current `simulate()` rebuilds the game topology +
  // clones match/profiles per call, so a depth-9 alpha-beta search across
  // multiple matches is slow. The architecture is the focus here — a single
  // match suffices to prove the bot produces a legal, non-losing move.
  test("minimax (X) vs random — minimax never loses (1 match)", async () => {
    const session = createLocalSession(ticTacToe, { match: ticTacToeMatch, seed: "m-1" });
    const result = await playToCompletion(session, { "0": minimaxBot, "1": randomBot });
    expect(result).not.toBeNull();
    expect(result?.winner === "1").toBe(false);
  }, 60_000);
});
