import { describe, expect, test } from "bun:test";
import { createRng } from "@openturn/core";
import { connectFour, type DropDiscArgs } from "@openturn/example-connect-four-game";
import type { LegalAction } from "@openturn/bot";

import { randomBot } from "./random";

const playerView = {
  board: Array.from({ length: 6 }, () => Array(7).fill(null)),
  lastMove: null,
  currentPlayer: "0" as const,
  winningLine: null,
};

const fiveLegalCols: LegalAction[] = [0, 2, 3, 4, 6].map((col) => ({
  event: "dropDisc",
  payload: { col },
  label: `Col ${col + 1}`,
}));

describe("randomBot", () => {
  test("picks a legal action only", async () => {
    const rng = createRng("seed-1");
    const action = await randomBot.decide({
      playerID: "0" as never,
      view: playerView as never,
      snapshot: { G: { board: playerView.board, lastMove: null }, derived: { activePlayers: ["0"] } } as never,
      legalActions: fiveLegalCols,
      rng,
      deadline: { remainingMs: () => 1000, expired: () => false },
      signal: new AbortController().signal,
      simulate: () => { throw new Error("randomBot must not call simulate"); },
    });
    expect(fiveLegalCols).toContainEqual(action);
  });

  test("two calls with the same seed return the same action", async () => {
    const args = (rng: ReturnType<typeof createRng>) => ({
      playerID: "0" as never,
      view: playerView as never,
      snapshot: { G: { board: playerView.board, lastMove: null }, derived: { activePlayers: ["0"] } } as never,
      legalActions: fiveLegalCols,
      rng,
      deadline: { remainingMs: () => 1000, expired: () => false },
      signal: new AbortController().signal,
      simulate: () => { throw new Error("must not be called"); },
    });
    const a = await randomBot.decide(args(createRng("same-seed")));
    const b = await randomBot.decide(args(createRng("same-seed")));
    expect(a).toEqual(b);
  });
});
