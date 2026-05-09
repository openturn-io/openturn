import type { Mark } from "@openturn/example-connect-four-game";

import { Board, type BoardProps } from "./Board";
import { Sidebar, type SeatInfo } from "./Sidebar";
import { StatusBanner } from "./StatusBanner";

export type MatchProps = {
  board: BoardProps["board"];
  lastMove: BoardProps["lastMove"];
  activeMark: Mark | null;
  canPlay: boolean;
  onDrop: (col: number) => void;
  status: string;
  seats: readonly [SeatInfo, SeatInfo];
  turn: number;
  moves: number;
  isOver: boolean;
  onNewMatch?: () => void;
};

export function Match(props: MatchProps): React.ReactElement {
  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <header className="flex items-baseline justify-between border-b border-slate-200 pb-4 mb-6">
        <div>
          <p className="text-[10px] uppercase tracking-[0.18em] font-medium text-slate-500 mb-1">
            Openturn · Hosted match
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">Connect Four</h1>
        </div>
      </header>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-[1fr_260px] items-start">
        <section>
          <StatusBanner text={props.status} />
          <Board
            board={props.board}
            lastMove={props.lastMove}
            activeMark={props.activeMark}
            canPlay={props.canPlay}
            onDrop={props.onDrop}
          />
        </section>
        <Sidebar
          seats={props.seats}
          turn={props.turn}
          moves={props.moves}
          isOver={props.isOver}
          {...(props.onNewMatch !== undefined ? { onNewMatch: props.onNewMatch } : {})}
        />
      </div>
    </div>
  );
}
