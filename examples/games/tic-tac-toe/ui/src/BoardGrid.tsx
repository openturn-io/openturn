import type { ReactNode } from "react";

import { BoardCell } from "./BoardCell";
import type { TicTacToeBoard, TicTacToeCell } from "./types";

export type BoardGridDisabled =
  | boolean
  | ((cell: TicTacToeCell, row: number, col: number) => boolean);

export interface BoardGridProps {
  board: TicTacToeBoard;
  disabled?: BoardGridDisabled;
  onCellPress?: (row: number, col: number) => void;
  ariaLabel?: string;
}

export function BoardGrid({
  board,
  disabled = false,
  onCellPress,
  ariaLabel = "Tic-tac-toe board",
}: BoardGridProps): ReactNode {
  return (
    <div
      role="grid"
      aria-label={ariaLabel}
      className="grid aspect-square w-[360px] max-w-full grid-cols-3 grid-rows-3 gap-3"
    >
      {board.map((row, rowIndex) =>
        row.map((cell, colIndex) => (
          <BoardCell
            key={`${rowIndex}-${colIndex}`}
            cell={cell}
            row={rowIndex}
            col={colIndex}
            disabled={resolveDisabled(disabled, cell, rowIndex, colIndex)}
            onPress={onCellPress === undefined ? undefined : () => onCellPress(rowIndex, colIndex)}
          />
        )),
      )}
    </div>
  );
}

function resolveDisabled(
  disabled: BoardGridDisabled,
  cell: TicTacToeCell,
  row: number,
  col: number,
): boolean {
  if (typeof disabled === "function") return disabled(cell, row, col);
  return disabled === true;
}
