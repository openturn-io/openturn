import * as React from "react";
import { motion, type HTMLMotionProps } from "framer-motion";

import type { ChipColor } from "@openturn/example-splendor-game";

import { cn } from "../lib/utils";

type Size = "xs" | "sm" | "md" | "lg";

interface GemChipProps extends Omit<HTMLMotionProps<"div">, "size"> {
  color: ChipColor;
  size?: Size;
  count?: number | null;
  /** Optional asset slot: when supplied, an <img> overlays the gradient. */
  iconSrc?: string | null;
  showCount?: boolean;
  layoutId?: string;
}

const SIZE_CLASS: Record<Size, string> = {
  xs: "h-5 w-5 text-[9px]",
  sm: "h-7 w-7 text-[11px]",
  md: "h-12 w-12 text-base",
  lg: "h-16 w-16 text-xl",
};

// Per-gem styling: each chip is built from a radial gradient (highlight + base
// + shadow), with inset highlights and a drop shadow to read as a dimensional
// token rather than a flat circle.
const COLOR_STYLE: Record<ChipColor, React.CSSProperties> = {
  white: {
    background: "radial-gradient(circle at 30% 25%, var(--color-gem-white-glow) 0%, var(--color-gem-white) 45%, var(--color-gem-white-shadow) 100%)",
    color: "var(--color-gem-white-ink)",
  },
  blue: {
    background: "radial-gradient(circle at 30% 25%, var(--color-gem-blue-glow) 0%, var(--color-gem-blue) 45%, var(--color-gem-blue-shadow) 100%)",
    color: "var(--color-gem-blue-ink)",
  },
  green: {
    background: "radial-gradient(circle at 30% 25%, var(--color-gem-green-glow) 0%, var(--color-gem-green) 45%, var(--color-gem-green-shadow) 100%)",
    color: "var(--color-gem-green-ink)",
  },
  red: {
    background: "radial-gradient(circle at 30% 25%, var(--color-gem-red-glow) 0%, var(--color-gem-red) 45%, var(--color-gem-red-shadow) 100%)",
    color: "var(--color-gem-red-ink)",
  },
  black: {
    background: "radial-gradient(circle at 30% 25%, var(--color-gem-black-glow) 0%, var(--color-gem-black) 45%, var(--color-gem-black-shadow) 100%)",
    color: "var(--color-gem-black-ink)",
  },
  gold: {
    background: "radial-gradient(circle at 30% 25%, var(--color-gem-gold-glow) 0%, var(--color-gem-gold) 45%, var(--color-gem-gold-shadow) 100%)",
    color: "var(--color-gem-gold-ink)",
  },
};

export function GemChip({
  color,
  size = "md",
  count,
  iconSrc,
  showCount = true,
  className,
  style,
  layoutId,
  ...props
}: GemChipProps) {
  return (
    <motion.div
      {...(layoutId === undefined ? {} : { layoutId })}
      className={cn(
        "relative inline-flex items-center justify-center rounded-full font-semibold select-none",
        SIZE_CLASS[size],
        "shadow-[0_3px_6px_rgba(0,0,0,0.4),inset_0_1px_2px_rgba(255,255,255,0.5),inset_0_-2px_3px_rgba(0,0,0,0.35)]",
        className,
      )}
      style={{ ...COLOR_STYLE[color], ...(style ?? {}) } as never}
      {...props}
    >
      {iconSrc ? (
        <img src={iconSrc} alt="" className="h-1/2 w-1/2 object-contain" />
      ) : null}
      {showCount && typeof count === "number" ? (
        <span className="font-display tabular-nums leading-none drop-shadow-[0_1px_1px_rgba(0,0,0,0.5)]">
          {count}
        </span>
      ) : null}
    </motion.div>
  );
}
