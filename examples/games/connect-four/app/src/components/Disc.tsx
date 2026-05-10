import { motion } from "framer-motion";

import { LAST_MOVE_HALO } from "../lib/halo";
import { cn } from "../lib/utils";

export type DiscProps = {
  mark: "0" | "1" | null;
  isLastMove?: boolean;
  /** Approximate pixels to drop from. Pass the column height in pixels for the spring start. */
  dropFrom?: number;
};

const COLOR_BY_MARK: Record<"0" | "1", string> = {
  "0": "bg-red-500",
  "1": "bg-amber-400",
};

export function Disc({ mark, isLastMove = false, dropFrom = 0 }: DiscProps): React.ReactElement {
  if (mark === null) {
    return (
      <div
        role="gridcell"
        aria-label="empty"
        className="aspect-square rounded-full bg-slate-100 border border-slate-200"
      />
    );
  }
  return (
    <motion.div
      role="gridcell"
      aria-label={mark === "0" ? "red" : "yellow"}
      initial={{ y: -dropFrom }}
      animate={{ y: 0, scaleY: [0.92, 1] }}
      transition={{ y: { type: "spring", stiffness: 380, damping: 24, mass: 1 }, scaleY: { duration: 0.12 } }}
      className={cn(
        "aspect-square rounded-full shadow-sm border border-slate-200/0",
        COLOR_BY_MARK[mark],
        isLastMove && LAST_MOVE_HALO,
      )}
    />
  );
}
