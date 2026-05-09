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

/**
 * Returns a new board with `mark` placed at (r, c). The other rows are
 * reference-shared; only the row at `r` is rebuilt.
 */
export function withDisc(board: Board, r: number, c: number, mark: Mark): Board {
  return board.map((row, rowIndex) =>
    rowIndex === r ? row.map((cell, colIndex) => (colIndex === c ? mark : cell)) : row,
  );
}
