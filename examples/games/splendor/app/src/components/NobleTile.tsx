import * as React from "react";
import { motion } from "framer-motion";

import { GEM_COLORS, type GemColor, type Noble } from "@openturn/example-splendor-game";

import { GemChip } from "./GemChip";
import { cn } from "../lib/utils";

interface NobleTileProps {
  noble: Noble;
  /** Optional asset slot — replaces the placeholder centerpiece. */
  portraitSrc?: string | null;
  size?: "sm" | "md";
  emphasized?: boolean;
  layoutId?: string;
  className?: string;
}

const SIZE: Record<NonNullable<NobleTileProps["size"]>, { tile: string; prestige: string; cost: "xs" | "sm" }> = {
  sm: { tile: "h-20 w-20 rounded-md", prestige: "text-base", cost: "xs" },
  md: { tile: "h-28 w-28 rounded-lg", prestige: "text-2xl", cost: "xs" },
};

function initials(name: string): string {
  const parts = name.split(/\s+/).slice(0, 3);
  return parts.map((p) => p[0] ?? "").join("").toUpperCase();
}

export function NobleTile({
  noble,
  portraitSrc,
  size = "md",
  emphasized = false,
  layoutId,
  className,
}: NobleTileProps) {
  const sizes = SIZE[size];
  const reqs = (Object.entries(noble.requires) as [GemColor, number][])
    .filter(([, v]) => (v ?? 0) > 0)
    .sort((a, b) => GEM_COLORS.indexOf(a[0]) - GEM_COLORS.indexOf(b[0]));
  return (
    <motion.div
      {...(layoutId === undefined ? {} : { layoutId })}
      className={cn(
        "relative overflow-hidden",
        sizes.tile,
        emphasized && "border-amber-200",
        className,
      )}
      style={{
        background:
          "linear-gradient(135deg, #d9b864 0%, #b8902e 50%, #7c5a10 100%)",
        boxShadow: emphasized
          ? "inset 0 0 0 1px rgba(255,225,138,0.78), inset 0 0 16px rgba(255,225,138,0.22), inset 0 1px 0 rgba(255,255,255,0.4), inset 0 -2px 0 rgba(0,0,0,0.35)"
          : "inset 0 1px 0 rgba(255,255,255,0.4), inset 0 -2px 0 rgba(0,0,0,0.35)",
        border: "1px solid var(--color-noble-gold-edge)",
      }}
      title={noble.name}
    >
      {/* Prestige number — top-right */}
      <span
        className={cn(
          "absolute right-2 top-1.5 font-display leading-none text-shadow-soft text-stone-900",
          sizes.prestige,
        )}
      >
        {noble.prestige}
      </span>
      {/* Center: portrait placeholder = serif initials over a textured patch */}
      <div className="absolute inset-x-1 top-3 bottom-8 flex items-center justify-center">
        {portraitSrc ? (
          <img src={portraitSrc} alt={noble.name} className="h-full w-full object-cover rounded-md" />
        ) : (
          <div
            className="flex h-full w-full items-center justify-center rounded-md"
            style={{
              background:
                "radial-gradient(circle at 50% 30%, rgba(255,255,255,0.35) 0%, rgba(0,0,0,0.2) 100%)",
            }}
          >
            <span className="font-display text-2xl text-stone-900/80">{initials(noble.name)}</span>
          </div>
        )}
      </div>
      {/* Bottom: requirement chips */}
      <div className="absolute inset-x-0 bottom-2 flex items-end justify-center gap-1 px-1">
        {reqs.map(([color, n]) => (
          <GemChip key={color} color={color} size={sizes.cost} count={n} />
        ))}
      </div>
    </motion.div>
  );
}
