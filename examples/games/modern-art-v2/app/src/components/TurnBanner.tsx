import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";

import type { ModernArtPlayerView } from "@openturn/example-modern-art-v2-game";

interface TurnBannerProps {
  view: ModernArtPlayerView;
  isMe: boolean;
  meLabel: string;
  turnLabel: string;
}

export function TurnBanner({ view, isMe, meLabel, turnLabel }: TurnBannerProps): React.ReactNode {
  const finished = view.winner !== null;
  const message = finished
    ? view.winner === view.myPlayerID
      ? `${meLabel} wins the auction`
      : `${turnLabel} wins the auction`
    : isMe
      ? `Your turn, ${meLabel}`
      : `${turnLabel} is choosing`;

  return (
    <div className="gallery-panel flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
      <div className="flex items-baseline gap-2">
        <p className="m-0 text-[10px] uppercase tracking-[0.25em] text-[var(--color-gold-bright)]/60">
          {finished ? "Auction closed" : `Round ${view.round} of ${view.totalRounds}`}
        </p>
        <AnimatePresence mode="wait">
          <motion.h2
            key={message}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 8 }}
            transition={{ duration: 0.25 }}
            className="m-0 font-display text-xl text-parchment text-shadow-soft"
          >
            {message}
          </motion.h2>
        </AnimatePresence>
      </div>
      {view.lastAction ? (
        <span className="rounded-full bg-black/30 px-3 py-1 text-[11px] text-[var(--color-gold-bright)]/80 ring-1 ring-inset ring-[var(--color-gold-leaf)]/20">
          {view.lastAction.detail}
        </span>
      ) : null}
    </div>
  );
}
