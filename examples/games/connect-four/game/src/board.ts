import type { Board, Cell, Mark } from "./index";

/**
 * Returns the row index (0-5) where a disc dropped into `col` would land.
 * Returns -1 when the column is full. board[0] is the top row.
 */
export function lowestEmptyRow(board: Board, col: number): number {
  for (let r = board.length - 1; r >= 0; r -= 1) {
    if (board[r]![col] === null) return r;
  }
  return -1;
}
