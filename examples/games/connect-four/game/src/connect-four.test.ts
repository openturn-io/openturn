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
