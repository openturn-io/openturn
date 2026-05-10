import type { Board, Cell, Mark } from "./index";

type ReadonlyBoard = ReadonlyArray<ReadonlyArray<Cell>>;

/**
 * Returns the row index (0..ROWS-1) where a disc dropped into `col` would
 * land, or -1 if the column is full. board[0] is the top row.
 */
export function lowestEmptyRow(board: ReadonlyBoard, col: number): number {
  for (let r = board.length - 1; r >= 0; r -= 1) {
    if (board[r]![col] === null) return r;
  }
  return -1;
}

/**
 * Returns a new board with `mark` placed at (r, c). Other rows are
 * deep-copied; modifying the result does not affect the input.
 */
export function withDisc(board: ReadonlyBoard, r: number, c: number, mark: Mark): Board {
  return board.map((row, rowIndex) =>
    rowIndex === r
      ? row.map((cell, colIndex) => (colIndex === c ? mark : cell))
      : [...row],
  );
}

export type CellRef = { row: number; col: number };

const DIRECTIONS: ReadonlyArray<readonly [dr: number, dc: number]> = [
  [0, 1],   // horizontal
  [1, 0],   // vertical
  [1, 1],   // \ diagonal (down-right)
  [1, -1],  // / diagonal (down-left)
] as const;

/**
 * Given that a disc was just placed at (r, c), check whether it completes
 * a 4-in-a-row in any of the four directions. Returns the 4 winning cells
 * (sorted by (row, col) ascending) or `null` if no win exists through (r, c).
 */
export function findWinningLine(board: ReadonlyBoard, r: number, c: number): CellRef[] | null {
  const mark = board[r]?.[c];
  if (mark === null || mark === undefined) return null;

  for (const [dr, dc] of DIRECTIONS) {
    const cells: CellRef[] = [{ row: r, col: c }];
    // Walk forward
    let nr = r + dr;
    let nc = c + dc;
    while (board[nr]?.[nc] === mark) {
      cells.push({ row: nr, col: nc });
      nr += dr;
      nc += dc;
    }
    // Walk backward
    nr = r - dr;
    nc = c - dc;
    while (board[nr]?.[nc] === mark) {
      cells.push({ row: nr, col: nc });
      nr -= dr;
      nc -= dc;
    }
    if (cells.length >= 4) {
      const sorted = [...cells].sort((a, b) => (a.row - b.row) || (a.col - b.col));
      // Take the contiguous 4 that includes (r, c).
      return sorted.slice(0, 4);
    }
  }
  return null;
}
