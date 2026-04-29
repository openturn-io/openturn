import { defineBot, simulate, type Bot, type LegalAction } from "@openturn/bot";
import { ticTacToe } from "@openturn/example-tic-tac-toe-game";

type TicTacToeGame = typeof ticTacToe;

const OTHER: Record<string, string> = { "0": "1", "1": "0" };

function legalForSnapshot(snapshot: ReturnType<typeof getStateShape>, playerID: string): LegalAction[] {
  const board = snapshot.G.board;
  const out: LegalAction[] = [];
  for (let row = 0; row < board.length; row += 1) {
    const cells = board[row]!;
    for (let col = 0; col < cells.length; col += 1) {
      if (cells[col] === null) {
        out.push({ event: "placeMark", payload: { row, col }, label: `(${row},${col})` });
      }
    }
  }
  return out;
}

function getStateShape(snapshot: { G: { board: (string | null)[][] } }) {
  return snapshot;
}

interface ResultLike {
  winner?: string;
  draw?: boolean;
}

function evaluate(snapshot: { meta: { result: ResultLike | null } }, me: string): number | null {
  const result = snapshot.meta.result;
  if (result === null || result === undefined) return null;
  if (result.draw === true) return 0;
  if (result.winner === me) return 10;
  if (typeof result.winner === "string") return -10;
  return 0;
}

function search(
  snapshot: ReturnType<typeof getStateShape> & { meta: { result: ResultLike | null } },
  toMove: string,
  me: string,
  depth: number,
  alpha: number,
  beta: number,
  maxDepth: number,
): number {
  const terminal = evaluate(snapshot, me);
  if (terminal !== null) return terminal - Math.sign(terminal) * depth;
  if (depth >= maxDepth) return 0; // depth-cut: treat as drawn

  const moves = legalForSnapshot(snapshot, toMove);
  if (moves.length === 0) return 0;

  const isMaxing = toMove === me;
  if (isMaxing) {
    let best = -Infinity;
    for (const action of moves) {
      const sim = simulate(ticTacToe, snapshot as never, toMove as never, action);
      if (!sim.ok) continue;
      const score = search(
        sim.next as never,
        OTHER[toMove] ?? toMove,
        me,
        depth + 1,
        alpha,
        beta,
        maxDepth,
      );
      if (score > best) best = score;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
    }
    return best;
  }
  let best = Infinity;
  for (const action of moves) {
    const sim = simulate(ticTacToe, snapshot as never, toMove as never, action);
    if (!sim.ok) continue;
    const score = search(
      sim.next as never,
      OTHER[toMove] ?? toMove,
      me,
      depth + 1,
      alpha,
      beta,
      maxDepth,
    );
    if (score < best) best = score;
    if (best < beta) beta = best;
    if (alpha >= beta) break;
  }
  return best;
}

export interface MakeMinimaxBotOptions {
  /** Max search depth in plies. Tic-tac-toe terminates at 9. */
  depth: number;
  /** Override `Bot.name` (default `"minimax-d{depth}"`). */
  name?: string;
  /** Soft per-decision budget in ms. */
  thinkingBudgetMs?: number;
}

/**
 * Build an alpha-beta minimax bot for tic-tac-toe with a configurable search
 * depth. Lower `depth` = weaker (cheaper) opponent; depth 9 = optimal play.
 *
 * Distinct difficulties register as distinct `Bot` instances in the
 * registry, each with its own `botID`. The lobby UI treats them as
 * separate options in the per-seat dropdown.
 */
export function makeMinimaxBot(options: MakeMinimaxBotOptions): Bot<TicTacToeGame> {
  const { depth, name, thinkingBudgetMs } = options;
  return defineBot<TicTacToeGame>({
    name: name ?? `minimax-d${depth}`,
    ...(thinkingBudgetMs === undefined ? {} : { thinkingBudgetMs }),
    decide({ legalActions, snapshot, playerID }) {
      if (legalActions.length === 0) {
        throw new Error("minimaxBot: no legal actions available");
      }
      if (snapshot === null) {
        // Fallback for hosted clients (no snapshot/simulate): play first legal.
        return legalActions[0]!;
      }
      let bestAction = legalActions[0]!;
      let bestScore = -Infinity;
      for (const action of legalActions) {
        const sim = simulate(ticTacToe, snapshot, playerID, action);
        if (!sim.ok) continue;
        const score = search(
          sim.next as never,
          OTHER[playerID] ?? playerID,
          playerID,
          1,
          -Infinity,
          Infinity,
          depth,
        );
        if (score > bestScore) {
          bestScore = score;
          bestAction = action;
        }
      }
      return bestAction;
    },
  });
}

/**
 * Backwards-compat: the original `minimaxBot` is now full-depth alpha-beta
 * minimax (depth 9 = optimal tic-tac-toe play). Existing CLI flags
 * `--bot 1=minimax` resolve to this instance.
 */
export const minimaxBot = makeMinimaxBot({ depth: 9, name: "minimax", thinkingBudgetMs: 5_000 });
