import type { TicTacToeCell, TicTacToeResult } from "./types";

export function describeResult(result: TicTacToeResult | { winner?: string; draw?: true } | null): string {
  if (result === null || result === undefined) return "In progress";
  if ("winner" in result && result.winner === "0") return "Player X wins";
  if ("winner" in result && result.winner === "1") return "Player O wins";
  if ("draw" in result && result.draw) return "Draw";
  return "In progress";
}

export function cellTextClassName(cell: TicTacToeCell): string {
  if (cell === "X") return "text-x-tone";
  if (cell === "O") return "text-o-tone";
  return "text-slate-300";
}
