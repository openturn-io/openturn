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
