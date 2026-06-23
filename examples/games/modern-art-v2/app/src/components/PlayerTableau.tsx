import * as React from "react";
import { motion } from "framer-motion";

import {
  ARTISTS,
  type ModernArtPlayerID,
  type ModernArtPlayerView,
} from "@openturn/example-modern-art-v2-game";

import { ARTIST_STYLE, playerLabel } from "../lib/artists";
import { cn } from "../lib/utils";

interface PlayerTableauProps {
  view: ModernArtPlayerView;
  playerID: ModernArtPlayerID;
  isMe: boolean;
  isCurrentTurn: boolean;
}

export function PlayerTableau({
  view,
  playerID,
  isMe,
  isCurrentTurn,
}: PlayerTableauProps): React.ReactNode {
  const data = view.players[playerID];
  if (data === undefined) return null;
  const isFinished = view.winner !== null;
  const isWinner = view.winner === playerID;
  const myHand = isMe ? view.myHand : null;

  return (
    <motion.div
      layout
      animate={{
        boxShadow: isCurrentTurn && !isFinished
          ? `inset 0 0 0 1px var(--color-gold-bright), inset 0 0 24px rgba(240,210,122,0.16), inset 0 -2px 4px rgba(0,0,0,0.3)`
          : "inset 0 1px 0 rgba(255,255,255,0.06), inset 0 -2px 4px rgba(0,0,0,0.3)",
      }}
      className={cn(
        "gallery-panel relative flex flex-col gap-2.5 p-3",
        isWinner && "ring-2 ring-[var(--color-gold-bright)]",
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <SeatBadge isMe={isMe} isActive={isCurrentTurn && !isFinished} />
          <span className="font-display text-base text-parchment text-shadow-soft">
            {playerLabel(playerID, isMe)}
          </span>
        </div>
        <motion.div
          key={data.money}
          initial={{ scale: 1 }}
          animate={{ scale: [1, 1.3, 1] }}
          transition={{ duration: 0.4 }}
          className="flex items-center gap-1 font-display text-xl text-[var(--color-gold-bright)]"
        >
          <span className="text-xs">$</span>
          {data.money}
        </motion.div>
      </div>

      {/* Collection counts per artist */}
      <div className="flex flex-wrap gap-1.5">
        {ARTISTS.map((artist) => {
          const owned = data.collection[artist] ?? 0;
          const style = ARTIST_STYLE[artist];
          return (
            <div
              key={artist}
              className={cn(
                "flex h-7 min-w-[2rem] items-center gap-1 rounded-full px-2 text-xs ring-1 ring-inset",
                owned > 0 ? "bg-black/30" : "bg-black/10 opacity-40",
              )}
              style={owned > 0 ? { boxShadow: `inset 0 0 0 1px ${style.base}66` } : undefined}
              title={`${style.label}: ${owned} owned`}
            >
              <span
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ background: style.base, boxShadow: owned > 0 ? `0 0 6px ${style.glow}` : undefined }}
              />
              <span className="font-mono text-parchment/90">{owned}</span>
            </div>
          );
        })}
      </div>

      {/* Hand — only visible to the owner */}
      {myHand !== null && myHand.length > 0 ? (
        <div>
          <p className="mb-1 text-[10px] uppercase tracking-[0.2em] text-[var(--color-gold-bright)]/50">
            Your hand · {myHand.length}
          </p>
        </div>
      ) : !isMe && data.handSize > 0 ? (
        <p className="m-0 text-[10px] uppercase tracking-[0.2em] text-parchment/40">
          {data.handSize} cards in hand
        </p>
      ) : null}
    </motion.div>
  );
}

function SeatBadge({ isMe, isActive }: { isMe: boolean; isActive: boolean }): React.ReactNode {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center justify-center rounded-full px-2 text-[10px] uppercase tracking-[0.2em]",
        isActive
          ? "bg-[var(--color-gold-bright)] text-[var(--color-frame-dark)]"
          : isMe
            ? "bg-[var(--color-gold-leaf)]/25 text-[var(--color-gold-bright)]"
            : "bg-white/10 text-parchment/60",
      )}
    >
      {isActive ? "Turn" : isMe ? "You" : "Seat"}
    </span>
  );
}
