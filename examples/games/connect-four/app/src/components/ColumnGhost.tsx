import { cn } from "../lib/utils";

export type ColumnGhostProps = {
  /** Hovered column index, or null when no column is hovered. */
  hoverCol: number | null;
  activeMark: "0" | "1" | null;
};

const COLOR_BY_MARK: Record<"0" | "1", string> = {
  "0": "bg-red-500/30",
  "1": "bg-amber-400/30",
};

export function ColumnGhost({ hoverCol, activeMark }: ColumnGhostProps): React.ReactElement {
  return (
    <div aria-hidden className="grid grid-cols-7 gap-1.5 px-1 mb-1 transition-opacity">
      {Array.from({ length: 7 }, (_, col) => (
        <div
          key={col}
          className={cn(
            "aspect-square rounded-full",
            hoverCol === col && activeMark !== null ? COLOR_BY_MARK[activeMark] : "bg-transparent",
          )}
        />
      ))}
    </div>
  );
}
