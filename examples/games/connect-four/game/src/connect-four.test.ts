import { describe, expect, test } from "bun:test";

import { lowestEmptyRow } from "./board";
import type { Board } from "./index";

function emptyBoard(): Board {
  return Array.from({ length: 6 }, () => Array(7).fill(null));
}

describe("lowestEmptyRow", () => {
  test("returns 5 (bottom) for an empty column", () => {
    const board = emptyBoard();
    expect(lowestEmptyRow(board, 3)).toBe(5);
  });

  test("returns 4 when bottom row has a disc in that column", () => {
    const board = emptyBoard();
    board[5]![3] = "0";
    expect(lowestEmptyRow(board, 3)).toBe(4);
  });

  test("returns 0 (top) when only the top row in that column is empty", () => {
    const board = emptyBoard();
    for (let r = 5; r >= 1; r -= 1) board[r]![2] = r % 2 === 0 ? "0" : "1";
    expect(lowestEmptyRow(board, 2)).toBe(0);
  });

  test("returns -1 when the column is full", () => {
    const board = emptyBoard();
    for (let r = 5; r >= 0; r -= 1) board[r]![1] = "0";
    expect(lowestEmptyRow(board, 1)).toBe(-1);
  });
});

import { withDisc } from "./board";

describe("withDisc", () => {
  test("places a disc at (r, c) and returns a new array (immutable)", () => {
    const before = emptyBoard();
    const after = withDisc(before, 5, 3, "0");
    expect(after[5]![3]).toBe("0");
    expect(before[5]![3]).toBeNull();
    expect(after).not.toBe(before);
  });

  test("preserves other cells exactly", () => {
    const before = emptyBoard();
    before[5]![0] = "1";
    const after = withDisc(before, 4, 0, "0");
    expect(after[5]![0]).toBe("1");
    expect(after[4]![0]).toBe("0");
    expect(after[3]![0]).toBeNull();
  });
});

import { findWinningLine } from "./board";

describe("findWinningLine", () => {
  test("vertical 4-in-a-row through (2, 3) for player 0", () => {
    const board = emptyBoard();
    board[2]![3] = "0";
    board[3]![3] = "0";
    board[4]![3] = "0";
    board[5]![3] = "0";
    const line = findWinningLine(board, 2, 3);
    expect(line).toEqual([
      { row: 2, col: 3 },
      { row: 3, col: 3 },
      { row: 4, col: 3 },
      { row: 5, col: 3 },
    ]);
  });

  test("horizontal 4-in-a-row through (5, 3) for player 1", () => {
    const board = emptyBoard();
    board[5]![1] = "1";
    board[5]![2] = "1";
    board[5]![3] = "1";
    board[5]![4] = "1";
    const line = findWinningLine(board, 5, 3);
    expect(line).toEqual([
      { row: 5, col: 1 },
      { row: 5, col: 2 },
      { row: 5, col: 3 },
      { row: 5, col: 4 },
    ]);
  });

  test("\\ diagonal win through (3, 3)", () => {
    const board = emptyBoard();
    board[2]![2] = "0";
    board[3]![3] = "0";
    board[4]![4] = "0";
    board[5]![5] = "0";
    const line = findWinningLine(board, 3, 3);
    expect(line).toEqual([
      { row: 2, col: 2 },
      { row: 3, col: 3 },
      { row: 4, col: 4 },
      { row: 5, col: 5 },
    ]);
  });

  test("/ diagonal win through (3, 3)", () => {
    const board = emptyBoard();
    board[5]![1] = "1";
    board[4]![2] = "1";
    board[3]![3] = "1";
    board[2]![4] = "1";
    const line = findWinningLine(board, 3, 3);
    expect(line).toEqual([
      { row: 2, col: 4 },
      { row: 3, col: 3 },
      { row: 4, col: 2 },
      { row: 5, col: 1 },
    ]);
  });

  test("3-in-a-row is NOT a win", () => {
    const board = emptyBoard();
    board[5]![1] = "0";
    board[5]![2] = "0";
    board[5]![3] = "0";
    expect(findWinningLine(board, 5, 2)).toBeNull();
  });

  test("returns null when (r, c) is empty", () => {
    const board = emptyBoard();
    expect(findWinningLine(board, 5, 0)).toBeNull();
  });

  test("does not span across mismatched marks", () => {
    const board = emptyBoard();
    board[5]![0] = "0";
    board[5]![1] = "0";
    board[5]![2] = "1";
    board[5]![3] = "0";
    board[5]![4] = "0";
    board[5]![5] = "0";
    expect(findWinningLine(board, 5, 0)).toBeNull();
  });
});

import { createLocalSession } from "@openturn/core";
import { connectFour } from "./index";

const connectFourMatch = { players: connectFour.playerIDs };

describe("connectFour setup", () => {
  test("starts with an empty 6x7 board, no last move, player 0 active", () => {
    const session = createLocalSession(connectFour, { match: connectFourMatch });
    const state = session.getState();
    expect(state.G.board).toEqual(
      Array.from({ length: 6 }, () => Array(7).fill(null)),
    );
    expect(state.G.lastMove).toBeNull();
    expect(state.derived.activePlayers).toEqual(["0"]);
  });
});

describe("dropDisc — happy path", () => {
  test("drops on an empty column, lands at row 5, ends the turn", () => {
    const session = createLocalSession(connectFour, { match: connectFourMatch });
    const result = session.applyEvent("0", "dropDisc", { col: 3 });
    expect(result.ok).toBe(true);

    const state = session.getState();
    expect(state.G.board[5]![3]).toBe("0");
    expect(state.G.board[4]![3]).toBeNull();
    expect(state.G.lastMove).toEqual({ col: 3, row: 5, player: "0" });
    expect(state.derived.activePlayers).toEqual(["1"]);
  });

  test("two consecutive drops in the same column stack 0 then 1", () => {
    const session = createLocalSession(connectFour, { match: connectFourMatch });
    session.applyEvent("0", "dropDisc", { col: 3 });
    session.applyEvent("1", "dropDisc", { col: 3 });
    const state = session.getState();
    expect(state.G.board[5]![3]).toBe("0");
    expect(state.G.board[4]![3]).toBe("1");
    expect(state.G.lastMove).toEqual({ col: 3, row: 4, player: "1" });
    expect(state.derived.activePlayers).toEqual(["0"]);
  });
});
