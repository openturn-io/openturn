import type { ReactNode } from "react";

import { cellTextClassName } from "./helpers";
import type { TicTacToeCell } from "./types";

export interface BoardCellProps {
  cell: TicTacToeCell;
  row: number;
  col: number;
  disabled?: boolean | undefined;
  onPress?: (() => void) | undefined;
}

export function BoardCell({ cell, row, col, disabled, onPress }: BoardCellProps): ReactNode {
  return (
    <button
      type="button"
      role="gridcell"
      aria-label={`Row ${row + 1} Column ${col + 1}`}
      data-cell={cell ?? "open"}
      disabled={disabled}
      onClick={onPress}
      className="flex h-full min-h-0 w-full min-w-0 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 text-[clamp(2.4rem,7vw,4rem)] font-display leading-none text-slate-900 transition hover:border-slate-300 hover:bg-white disabled:cursor-not-allowed disabled:hover:border-slate-200 disabled:hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
    >
      <span className={cellTextClassName(cell)}>{cell ?? ""}</span>
    </button>
  );
}
