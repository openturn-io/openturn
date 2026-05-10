import { defineBot, type LegalAction } from "@openturn/bot";
import {
  COLS,
  ROWS,
  connectFour,
  findWinningLine,
  lowestEmptyRow,
  withDisc,
  type Cell,
  type DropDiscArgs,
  type Mark,
} from "@openturn/example-connect-four-game";

type ReadonlyBoard = ReadonlyArray<ReadonlyArray<Cell>>;

const COL_ORDER = [3, 2, 4, 1, 5, 0, 6] as const;
const WIN_SCORE = 1_000_000;

function opponentOf(me: Mark): Mark {
  return me === "0" ? "1" : "0";
}

/** Count how many lines of 4 cells in the board contain `count` of `mark` and 0 of the opponent. */
function countOpenLines(board: ReadonlyBoard, mark: Mark, count: number): number {
  const opp = opponentOf(mark);
  let total = 0;
  const directions: ReadonlyArray<readonly [number, number]> = [
    [0, 1], [1, 0], [1, 1], [1, -1],
  ];
  for (let r = 0; r < ROWS; r += 1) {
    for (let c = 0; c < COLS; c += 1) {
      for (const [dr, dc] of directions) {
        const er = r + 3 * dr;
        const ec = c + 3 * dc;
        if (er < 0 || er >= ROWS || ec < 0 || ec >= COLS) continue;
        let mine = 0;
        let theirs = 0;
        for (let k = 0; k < 4; k += 1) {
          const cell = board[r + k * dr]![c + k * dc];
          if (cell === mark) mine += 1;
          else if (cell === opp) theirs += 1;
        }
        if (theirs === 0 && mine === count) total += 1;
      }
    }
  }
  return total;
}

function evaluate(board: ReadonlyBoard, me: Mark): number {
  const opp = opponentOf(me);
  const my3 = countOpenLines(board, me, 3);
  const my2 = countOpenLines(board, me, 2);
  const opp3 = countOpenLines(board, opp, 3);
  const opp2 = countOpenLines(board, opp, 2);
  return my3 * 100 + my2 * 10 - opp3 * 100 - opp2 * 10;
}

interface SearchResult {
  bestCol: number;
  score: number;
}

interface DeadlineLike {
  expired: () => boolean;
}

function legalCols(board: ReadonlyBoard): number[] {
  return COL_ORDER.filter((c) => board[0]![c] === null);
}

function alphabeta(
  board: ReadonlyBoard,
  toMove: Mark,
  me: Mark,
  depth: number,
  alpha: number,
  beta: number,
  deadline: DeadlineLike,
): number {
  if (deadline.expired()) return evaluate(board, me);
  if (depth === 0) return evaluate(board, me);

  const cols = legalCols(board);
  if (cols.length === 0) return evaluate(board, me);

  const opp = opponentOf(toMove);
  const isMaxing = toMove === me;
  let best = isMaxing ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
  for (const col of cols) {
    const row = lowestEmptyRow(board, col);
    const next = withDisc(board, row, col, toMove);
    const win = findWinningLine(next, row, col);
    let value: number;
    if (win !== null) {
      value = isMaxing ? WIN_SCORE - (12 - depth) : -(WIN_SCORE - (12 - depth));
    } else {
      value = alphabeta(next, opp, me, depth - 1, alpha, beta, deadline);
    }
    if (isMaxing) {
      if (value > best) best = value;
      if (best > alpha) alpha = best;
    } else {
      if (value < best) best = value;
      if (best < beta) beta = best;
    }
    if (beta <= alpha) break;
  }
  return best;
}

function searchAtDepth(board: ReadonlyBoard, me: Mark, depth: number, deadline: DeadlineLike): SearchResult | null {
  const cols = legalCols(board);
  if (cols.length === 0) return null;
  let bestCol = cols[0]!;
  let bestScore = Number.NEGATIVE_INFINITY;
  let alpha = Number.NEGATIVE_INFINITY;
  const beta = Number.POSITIVE_INFINITY;
  for (const col of cols) {
    if (deadline.expired()) return null;
    const row = lowestEmptyRow(board, col);
    const next = withDisc(board, row, col, me);
    const win = findWinningLine(next, row, col);
    let value: number;
    if (win !== null) {
      value = WIN_SCORE - (12 - depth);
    } else {
      value = alphabeta(next, opponentOf(me), me, depth - 1, alpha, beta, deadline);
    }
    if (value > bestScore) {
      bestScore = value;
      bestCol = col;
    }
    if (bestScore > alpha) alpha = bestScore;
  }
  return { bestCol, score: bestScore };
}

export interface MinimaxBotOptions {
  depth: number;
  budgetMs?: number;
}

export function makeMinimaxBot({ depth, budgetMs = 2_000 }: MinimaxBotOptions) {
  return defineBot<typeof connectFour>({
    name: `minimax-d${depth}`,
    thinkingBudgetMs: budgetMs,
    decide({ view, playerID, legalActions, deadline, rng }) {
      const me = playerID as Mark;
      let best: SearchResult | null = null;
      for (let d = 1; d <= depth; d += 1) {
        const r = searchAtDepth(view.board, me, d, deadline);
        if (r === null) break;
        best = r;
      }
      if (best === null) return rng.pick(legalActions);
      const action = legalActions.find(
        (a) => (a.payload as DropDiscArgs).col === best.bestCol,
      ) as LegalAction | undefined;
      return action ?? rng.pick(legalActions);
    },
  });
}

export const minimaxBot = makeMinimaxBot({ depth: 6 });
