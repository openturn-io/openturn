import { defineBot, type LegalAction } from "@openturn/bot";
import {
  connectFour,
  findWinningLine,
  lowestEmptyRow,
  withDisc,
  type Board,
  type DropDiscArgs,
  type Mark,
} from "@openturn/example-connect-four-game";

const CENTER_BIAS = [3, 4, 5, 7, 5, 4, 3] as const;

function opponentOf(me: Mark): Mark {
  return me === "0" ? "1" : "0";
}

function wouldWin(board: Board, col: number, mark: Mark): boolean {
  const row = lowestEmptyRow(board, col);
  if (row < 0) return false;
  const next = withDisc(board, row, col, mark);
  return findWinningLine(next, row, col) !== null;
}

function scoreForCol(board: Board, col: number, me: Mark): number {
  if (wouldWin(board, col, me)) return Number.POSITIVE_INFINITY;
  if (wouldWin(board, col, opponentOf(me))) return 10_000;
  return CENTER_BIAS[col] ?? 0;
}

export const heuristicBot = defineBot<typeof connectFour>({
  name: "heuristic",
  decide({ view, playerID, legalActions, rng }) {
    const me = playerID as Mark;
    let bestScore = Number.NEGATIVE_INFINITY;
    let bestActions: LegalAction[] = [];
    for (const action of legalActions) {
      const col = (action.payload as DropDiscArgs).col;
      const score = scoreForCol(view.board, col, me);
      if (score > bestScore) {
        bestScore = score;
        bestActions = [action];
      } else if (score === bestScore) {
        bestActions.push(action);
      }
    }
    if (bestActions.length === 0) return rng.pick(legalActions);
    return rng.pick(bestActions);
  },
});
