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

import { lowestEmptyRow, withDisc, type Board, type Mark } from "@openturn/example-connect-four-game";
import { heuristicBot } from "./heuristic";

function viewFor(board: Board, currentPlayer: Mark = "0") {
  return {
    board,
    lastMove: null,
    currentPlayer,
    winningLine: null,
  };
}

function legalForBoard(board: Board): LegalAction[] {
  const out: LegalAction[] = [];
  for (let col = 0; col < 7; col += 1) {
    if (board[0]![col] === null) {
      out.push({ event: "dropDisc", payload: { col }, label: `Col ${col + 1}` });
    }
  }
  return out;
}

async function decide(bot: typeof heuristicBot, board: Board, me: Mark = "0") {
  const rng = createRng(`heur-${me}-${board.flat().join("")}`);
  return bot.decide({
    playerID: me as never,
    view: viewFor(board, me) as never,
    snapshot: { G: { board, lastMove: null }, derived: { activePlayers: [me] } } as never,
    legalActions: legalForBoard(board),
    rng,
    deadline: { remainingMs: () => 1000, expired: () => false },
    signal: new AbortController().signal,
    simulate: () => { throw new Error("must not be called"); },
  });
}

function emptyBoard(): Board {
  return Array.from({ length: 6 }, () => Array(7).fill(null));
}

describe("heuristicBot — immediate win", () => {
  test("plays a vertical winning move when 3 own discs are stacked", async () => {
    let board = emptyBoard();
    board = withDisc(board, lowestEmptyRow(board, 3), 3, "0");
    board = withDisc(board, lowestEmptyRow(board, 3), 3, "0");
    board = withDisc(board, lowestEmptyRow(board, 3), 3, "0");
    const action = await decide(heuristicBot, board, "0");
    expect((action.payload as DropDiscArgs).col).toBe(3);
  });

  test("plays a horizontal winning move when 3 own discs are aligned", async () => {
    let board = emptyBoard();
    // Build floor support so disc lands at row 5.
    board = withDisc(board, 5, 1, "0");
    board = withDisc(board, 5, 2, "0");
    board = withDisc(board, 5, 3, "0");
    const action = await decide(heuristicBot, board, "0");
    expect([0, 4]).toContain((action.payload as DropDiscArgs).col);
  });
});

describe("heuristicBot — immediate block", () => {
  test("blocks an opponent's vertical 3-in-a-row", async () => {
    let board = emptyBoard();
    board = withDisc(board, lowestEmptyRow(board, 4), 4, "1");
    board = withDisc(board, lowestEmptyRow(board, 4), 4, "1");
    board = withDisc(board, lowestEmptyRow(board, 4), 4, "1");
    const action = await decide(heuristicBot, board, "0");
    expect((action.payload as DropDiscArgs).col).toBe(4);
  });

  test("blocks an opponent's horizontal 3-in-a-row when no own win is available", async () => {
    let board = emptyBoard();
    board = withDisc(board, 5, 2, "1");
    board = withDisc(board, 5, 3, "1");
    board = withDisc(board, 5, 4, "1");
    const action = await decide(heuristicBot, board, "0");
    expect([1, 5]).toContain((action.payload as DropDiscArgs).col);
  });
});

describe("heuristicBot — center bias", () => {
  test("prefers the center on an empty board", async () => {
    const board = emptyBoard();
    const action = await decide(heuristicBot, board, "0");
    expect((action.payload as DropDiscArgs).col).toBe(3);
  });
});
