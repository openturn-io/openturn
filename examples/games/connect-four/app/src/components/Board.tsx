import { useState } from "react";
import type { Board as BoardType, Mark } from "@openturn/example-connect-four-game";

import { cn } from "@/lib/utils";
import { ColumnGhost } from "./ColumnGhost";
import { Disc } from "./Disc";

export type BoardProps = {
  board: BoardType;
  lastMove: { row: number; col: number; player: Mark } | null;
  /** Mark of the active local seat. null when not your turn or no local seat. */
  activeMark: Mark | null;
  /** True when the local seat may dispatch a move right now. */
  canPlay: boolean;
  /** Called when the user clicks a column. */
  onDrop: (col: number) => void;
};

export function Board({ board, lastMove, activeMark, canPlay, onDrop }: BoardProps): React.ReactElement {
  const [hoverCol, setHoverCol] = useState<number | null>(null);

  const handleClick = (col: number): void => {
    if (!canPlay) return;
    if (board[0]![col] !== null) return;
    onDrop(col);
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <ColumnGhost hoverCol={canPlay ? hoverCol : null} activeMark={activeMark} />
      <div role="grid" aria-label="Connect Four board" className="grid grid-cols-7 gap-1.5">
        {board.map((row, r) =>
          row.map((cell, c) => {
            const isLast = lastMove !== null && lastMove.row === r && lastMove.col === c;
            return (
              <button
                key={`${r}-${c}`}
                type="button"
                aria-label={`Drop in column ${c + 1}`}
                disabled={!canPlay || board[0]![c] !== null}
                onClick={() => handleClick(c)}
                onMouseEnter={() => setHoverCol(c)}
                onMouseLeave={() => setHoverCol((cur) => (cur === c ? null : cur))}
                onFocus={() => setHoverCol(c)}
                onBlur={() => setHoverCol((cur) => (cur === c ? null : cur))}
                className={cn(
                  "p-0 m-0 bg-transparent border-0 outline-0 focus-visible:ring-2 focus-visible:ring-slate-400 rounded-full disabled:cursor-not-allowed",
                )}
              >
                <Disc mark={cell} isLastMove={isLast} dropFrom={isLast ? 200 : 0} />
              </button>
            );
          }),
        )}
      </div>
    </div>
  );
}
