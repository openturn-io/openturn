import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";

import type { SplendorPlayerView } from "@openturn/example-splendor-game";

import { cn } from "../lib/utils";

interface TurnBannerProps {
  view: SplendorPlayerView;
  isMe: boolean;
  meLabel: string;
  turnLabel: string;
  tipsEnabled: boolean;
  onToggleTips: (next: boolean) => void;
}

export function TurnBanner({
  view,
  isMe,
  meLabel,
  turnLabel,
  tipsEnabled,
  onToggleTips,
}: TurnBannerProps) {
  const finished = view.winner !== null;
  const message = finished
    ? view.winner === view.myPlayerID
      ? `${meLabel} prevails`
      : `${turnLabel} prevails`
    : isMe
      ? `Your turn, ${meLabel}`
      : `${turnLabel} is choosing`;

  return (
    <div className="felt-panel flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
      <div className="flex items-baseline gap-2">
        <p className="m-0 text-[10px] uppercase tracking-[0.25em] text-amber-100/70">
          {finished ? "Game complete" : view.isFinalRound ? "Final round" : "Round in play"}
        </p>
        <AnimatePresence mode="wait">
          <motion.h2
            key={message}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 8 }}
            transition={{ duration: 0.25 }}
            className="m-0 font-display text-xl text-amber-50 text-shadow-soft"
          >
            {message}
          </motion.h2>
        </AnimatePresence>
      </div>
      <div className="flex items-center gap-2">
        {view.lastAction ? (
          <span className="rounded-full bg-black/30 px-3 py-1 text-[11px] text-amber-100/80 ring-1 ring-inset ring-white/10">
            P{Number.parseInt(view.lastAction.player, 10) + 1}: {view.lastAction.detail}
          </span>
        ) : null}
        <button
          type="button"
          onClick={() => onToggleTips(!tipsEnabled)}
          aria-pressed={tipsEnabled}
          title={tipsEnabled ? "Tutorial tips on — click to disable" : "Tutorial tips off — click to enable"}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] ring-1 ring-inset transition-colors cursor-pointer",
            tipsEnabled
              ? "bg-amber-300/20 text-amber-100 ring-amber-200/40 hover:bg-amber-300/30"
              : "bg-black/30 text-amber-100/60 ring-white/10 hover:bg-black/40",
          )}
        >
          <span
            aria-hidden
            className={cn(
              "inline-block h-1.5 w-1.5 rounded-full",
              tipsEnabled ? "bg-amber-300" : "bg-white/30",
            )}
          />
          Tips: {tipsEnabled ? "on" : "off"}
        </button>
      </div>
    </div>
  );
}
