import type { Mark } from "@openturn/example-connect-four-game";

import { PlayerCard } from "./PlayerCard";

export type SeatInfo = {
  mark: Mark;
  name: string;
  role: string;
  active: boolean;
};

export type SidebarProps = {
  seats: readonly [SeatInfo, SeatInfo];
  turn: number;
  moves: number;
  isOver: boolean;
  onNewMatch?: () => void;
};

export function Sidebar({ seats, turn, moves, isOver, onNewMatch }: SidebarProps): React.ReactElement {
  return (
    <aside className="flex flex-col gap-2.5">
      {seats.map((s) => (
        <PlayerCard key={s.mark} mark={s.mark} name={s.name} role={s.role} active={s.active} />
      ))}
      <div className="px-3.5 py-2 text-xs text-slate-500 flex flex-col gap-1">
        <div className="flex justify-between">
          <span className="uppercase tracking-[0.14em] text-[10px] text-slate-400">Turn</span>
          <span className="tabular-nums">{turn}</span>
        </div>
        <div className="flex justify-between">
          <span className="uppercase tracking-[0.14em] text-[10px] text-slate-400">Moves</span>
          <span className="tabular-nums">{moves}</span>
        </div>
      </div>
      {isOver && onNewMatch !== undefined && (
        <button
          type="button"
          onClick={onNewMatch}
          className="rounded-full border border-slate-300 bg-slate-950 px-5 py-2 text-sm font-medium text-white transition hover:bg-slate-800 focus-visible:ring-2 focus-visible:ring-slate-400"
        >
          New match
        </button>
      )}
    </aside>
  );
}
