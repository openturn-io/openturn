import * as React from "react";
import { motion } from "framer-motion";

import {
  getPainting,
  type Painting,
} from "@openturn/example-modern-art-v2-game";

import { ARTIST_STYLE, AUCTION_GLYPH, AUCTION_LABEL } from "../lib/artists";
import { cn } from "../lib/utils";

interface PaintingCardProps {
  painting: Painting | string;
  size?: "sm" | "md" | "lg";
  faceDown?: boolean;
  emphasized?: boolean;
  layoutId?: string;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}

const SIZE = {
  sm: { card: "h-28 w-[78px] rounded-md", glyph: "text-[10px]", serial: "text-[8px]" },
  md: { card: "h-40 w-[112px] rounded-lg", glyph: "text-xs", serial: "text-[9px]" },
  lg: { card: "h-52 w-[148px] rounded-lg", glyph: "text-sm", serial: "text-[10px]" },
} as const;

export function PaintingCard({
  painting,
  size = "md",
  faceDown = false,
  emphasized = false,
  layoutId,
  onClick,
  disabled,
  className,
}: PaintingCardProps): React.ReactNode {
  const sizes = SIZE[size];
  const p = typeof painting === "string" ? getPainting(painting) : painting;
  const style = ARTIST_STYLE[p.artist];

  if (faceDown) {
    return (
      <motion.div
        {...(layoutId === undefined ? {} : { layoutId })}
        className={cn("gold-frame flex items-center justify-center", sizes.card, className)}
      >
        <span className="font-display text-2xl text-[var(--color-gold-bright)] text-shadow-soft">MA</span>
      </motion.div>
    );
  }

  const interactive = typeof onClick === "function" && !disabled;

  return (
    <motion.button
      type="button"
      {...(layoutId === undefined ? {} : { layoutId })}
      {...(interactive ? { onClick, whileHover: { y: -3, scale: 1.03 }, whileTap: { scale: 0.97 } } : {})}
      disabled={!interactive}
      className={cn(
        "relative gold-frame overflow-hidden text-left p-[3px]",
        sizes.card,
        emphasized && "shadow-[inset_0_0_0_1.5px_var(--color-gold-bright),inset_0_0_22px_rgba(240,210,122,0.28)]",
        !interactive && "cursor-default",
        interactive && "cursor-pointer",
        className,
      )}
    >
      {/* Inner canvas — the "painting" */}
      <div
        className="relative h-full w-full overflow-hidden rounded-[7px]"
        style={{
          background: `linear-gradient(155deg, ${style.glow} 0%, ${style.base} 45%, ${style.ink} 100%)`,
        }}
      >
        {/* Abstract brushstroke centerpiece — pure CSS, evokes modern art */}
        <span
          aria-hidden
          className="absolute inset-0 opacity-50"
          style={{
            background: `radial-gradient(ellipse at 30% 25%, rgba(255,255,255,0.45) 0%, transparent 45%), radial-gradient(ellipse at 70% 75%, ${style.ink} 0%, transparent 55%)`,
          }}
        />
        <span
          aria-hidden
          className="absolute left-1/2 top-1/2 h-[55%] w-[55%] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-30 blur-[8px]"
          style={{ background: style.glow }}
        />

        {/* Auction-type medallion — top-left */}
        <span
          className={cn(
            "absolute left-1 top-1 inline-flex h-5 items-center gap-0.5 rounded-full bg-black/45 px-1.5 text-[var(--color-gold-bright)] backdrop-blur-sm",
            sizes.glyph,
          )}
          title={`${AUCTION_LABEL[p.auction]} auction`}
        >
          <span className="text-[11px] leading-none">{AUCTION_GLYPH[p.auction]}</span>
          <span className="text-[8px] uppercase tracking-wide opacity-80">{AUCTION_LABEL[p.auction]}</span>
        </span>

        {/* Artist signature — bottom */}
        <div className="absolute inset-x-0 bottom-0 flex items-end justify-between px-1.5 pb-1">
          <span
            className="font-display text-[11px] leading-none text-white/90 text-shadow-soft"
            style={{ textShadow: "0 1px 3px rgba(0,0,0,0.7)" }}
          >
            {style.label}
          </span>
          <span className={cn("font-mono text-white/40", sizes.serial)}>#{p.id.split("-")[1]}</span>
        </div>
      </div>
    </motion.button>
  );
}
