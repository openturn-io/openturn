import type { Mark } from "@openturn/example-connect-four-game";

import { cn } from "@/lib/utils";

export type PlayerCardProps = {
  mark: Mark;
  name: string;
  role: string;
  active: boolean;
};

const COLOR_BY_MARK: Record<Mark, string> = {
  "0": "bg-red-500",
  "1": "bg-amber-400",
};

const LABEL_BY_MARK: Record<Mark, string> = {
  "0": "Red",
  "1": "Yellow",
};

export function PlayerCard({ mark, name, role, active }: PlayerCardProps): React.ReactElement {
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3.5 py-3",
        active && "ring-1 ring-slate-300",
      )}
    >
      <div className={cn("w-7 h-7 rounded-full shadow-sm shrink-0", COLOR_BY_MARK[mark])} aria-hidden />
      <div className="flex flex-col gap-0.5 min-w-0">
        <div className="text-sm font-semibold leading-tight">{LABEL_BY_MARK[mark]}</div>
        <div className={cn("text-xs", active ? "text-slate-900 font-medium" : "text-slate-500")}>
          <span className="font-medium">{name}</span> · {role}
        </div>
      </div>
    </div>
  );
}
