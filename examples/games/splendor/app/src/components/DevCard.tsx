import * as React from "react";
import { motion } from "framer-motion";

import {
  GEM_COLORS,
  type Card,
  type GemColor,
} from "@openturn/example-splendor-game";

import { GemChip } from "./GemChip";
import { cn } from "../lib/utils";

interface DevCardProps {
  card: Card;
  /** Optional asset slot — if supplied, replaces the placeholder centerpiece. */
  artworkSrc?: string | null;
  size?: "sm" | "md" | "lg";
  /** Highlight when this card is targeted (hover, can-buy state, etc.). */
  emphasized?: boolean;
  /** Show face-down (used for opponent reserves & deck stubs). */
  faceDown?: boolean;
  layoutId?: string;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}

const SIZE: Record<NonNullable<DevCardProps["size"]>, { card: string; prestige: string; cost: "xs" | "sm" }> = {
  sm: { card: "h-24 w-[68px] rounded-md", prestige: "text-lg", cost: "xs" },
  md: { card: "h-36 w-[100px] rounded-lg", prestige: "text-2xl", cost: "sm" },
  lg: { card: "h-44 w-[124px] rounded-lg", prestige: "text-3xl", cost: "sm" },
};

// Per-bonus tint: a soft band painted across the top of the card. The body
// remains parchment-cream so chips and prestige read clearly.
const BONUS_BAND: Record<GemColor, React.CSSProperties> = {
  white: { background: "linear-gradient(180deg, #ffffff 0%, #e8e8e8 100%)" },
  blue: { background: "linear-gradient(180deg, var(--color-gem-blue-glow) 0%, var(--color-gem-blue) 100%)" },
  green: { background: "linear-gradient(180deg, var(--color-gem-green-glow) 0%, var(--color-gem-green) 100%)" },
  red: { background: "linear-gradient(180deg, var(--color-gem-red-glow) 0%, var(--color-gem-red) 100%)" },
  black: { background: "linear-gradient(180deg, #43434a 0%, var(--color-gem-black) 100%)" },
};

export function DevCard({
  card,
  artworkSrc,
  size = "md",
  emphasized = false,
  faceDown = false,
  layoutId,
  onClick,
  disabled,
  className,
}: DevCardProps) {
  const sizes = SIZE[size];
  const tier = card.tier;

  if (faceDown) {
    return (
      <motion.div
        {...(layoutId === undefined ? {} : { layoutId })}
        className={cn(
          "relative parchment overflow-hidden",
          sizes.card,
          "flex items-center justify-center",
          className,
        )}
        style={{
          background: tier === 3
            ? "linear-gradient(135deg, #1a1a2a 0%, #2d2d4a 100%)"
            : tier === 2
              ? "linear-gradient(135deg, #b3a25a 0%, #7a6630 100%)"
              : "linear-gradient(135deg, #4a8a3a 0%, #2a5a20 100%)",
          color: "rgba(255,255,255,0.85)",
        }}
      >
        <span className="font-display text-2xl text-shadow-soft">{tier === 1 ? "I" : tier === 2 ? "II" : "III"}</span>
      </motion.div>
    );
  }

  const costEntries = (Object.entries(card.cost) as [GemColor, number][])
    .filter(([, v]) => (v ?? 0) > 0)
    .sort((a, b) => GEM_COLORS.indexOf(a[0]) - GEM_COLORS.indexOf(b[0]));

  const interactive = typeof onClick === "function" && !disabled;

  return (
    <motion.button
      type="button"
      {...(layoutId === undefined ? {} : { layoutId })}
      {...(interactive ? { onClick, whileHover: { y: -3, scale: 1.03 }, whileTap: { scale: 0.97 } } : {})}
      disabled={!interactive}
      className={cn(
        "relative parchment overflow-hidden text-left p-0",
        sizes.card,
        emphasized && "border-amber-400/90 shadow-[inset_0_0_0_1px_rgba(255,225,138,0.78),inset_0_0_18px_rgba(255,225,138,0.22)]",
        !interactive && "cursor-default",
        interactive && "cursor-pointer",
        className,
      )}
    >
      {/* Top band: bonus color */}
      <div className="relative h-[40%] w-full" style={BONUS_BAND[card.bonus]}>
        {/* Prestige number — top-left */}
        {card.prestige > 0 ? (
          <span
            className={cn(
              "absolute left-2 top-1 font-display leading-none text-shadow-soft",
              sizes.prestige,
              card.bonus === "white" ? "text-stone-900" : "text-white",
            )}
          >
            {card.prestige}
          </span>
        ) : null}
        {/* Bonus chip — top-right */}
        <span className="absolute right-1.5 top-1.5">
          <GemChip color={card.bonus} size="xs" showCount={false} iconSrc={artworkSrc ?? null} />
        </span>
        {/* Subtle gem-colored emboss occupying the band — placeholder artwork */}
        <span
          className="absolute inset-x-0 bottom-0 mx-auto h-[60%] w-[60%] rounded-full opacity-40 blur-[6px]"
          style={{
            background: `radial-gradient(circle, var(--color-gem-${card.bonus === "black" ? "black" : card.bonus}-glow) 0%, transparent 70%)`,
          }}
        />
      </div>
      {/* Bottom: cost circles */}
      <div className="absolute inset-x-0 bottom-1.5 flex flex-col gap-1 px-1.5">
        <div className="flex flex-wrap items-end justify-end gap-1">
          {costEntries.map(([color, n]) => (
            <span key={color} className="relative inline-flex items-center justify-center">
              <GemChip color={color} size={sizes.cost} count={n} />
            </span>
          ))}
        </div>
      </div>
    </motion.button>
  );
}
