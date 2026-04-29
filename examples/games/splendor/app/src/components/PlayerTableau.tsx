import * as React from "react";
import { motion } from "framer-motion";

import {
  CHIP_COLORS,
  GEM_COLORS,
  canAfford,
  getCard,
  getNoble,
  type GemColor,
  type SplendorPlayerID,
  type SplendorPlayerView,
} from "@openturn/example-splendor-game";

import { DevCard } from "./DevCard";
import { GemChip } from "./GemChip";
import { NobleTile } from "./NobleTile";
import { Tip } from "./ui/tip";
import { nobleTip, playerChipRowTip } from "../lib/tutorialTips";
import { cn } from "../lib/utils";

interface PlayerTableauProps {
  view: SplendorPlayerView;
  playerID: string;
  isCurrentTurn: boolean;
  isMe: boolean;
  /** When true, reserved cards become interactive buy targets. */
  canBuyReserved: boolean;
  onBuyReserved?: (cardID: string) => void;
}

export function PlayerTableau({
  view,
  playerID,
  isCurrentTurn,
  isMe,
  canBuyReserved,
  onBuyReserved,
}: PlayerTableauProps) {
  const data = view.players[playerID as SplendorPlayerID];
  if (data === undefined) return null;
  const isFinished = view.winner !== null;
  const isWinner = view.winner === playerID;
  return (
    <motion.div
      layout
      animate={{
        boxShadow: isCurrentTurn && !isFinished
          ? "inset 0 0 0 1px rgba(255, 225, 138, 0.62), inset 0 0 22px rgba(255, 225, 138, 0.18), inset 0 -2px 4px rgba(0,0,0,0.25)"
          : "inset 0 1px 0 rgba(255,255,255,0.08), inset 0 -2px 4px rgba(0,0,0,0.25)",
      }}
      className={cn(
        "felt-panel relative flex flex-col gap-2 p-3 transition-colors",
        isCurrentTurn && !isFinished && "border-amber-200/50",
        isWinner && "border-amber-300",
      )}
    >
      <div className="flex items-center justify-between gap-3 text-shadow-soft">
        <div className="flex items-center gap-2">
          <SeatBadge isMe={isMe} isActive={isCurrentTurn && !isFinished} />
          <span className="font-display text-base text-amber-50">{playerLabel(playerID, isMe)}</span>
          {data.mustDiscard > 0 && isMe ? (
            <span className="rounded-full bg-red-500/30 px-2 py-0.5 text-[10px] text-red-100">
              Discard {data.mustDiscard}
            </span>
          ) : null}
        </div>
        <motion.div
          key={data.score}
          initial={{ scale: 1 }}
          animate={{ scale: [1, 1.35, 1] }}
          transition={{ duration: 0.45 }}
          className="flex items-center gap-1 font-display text-2xl text-amber-100"
        >
          {data.score}
          <span className="text-[10px] uppercase tracking-[0.2em] text-amber-100/70">pts</span>
        </motion.div>
      </div>
      {/* Chips + bonuses */}
      <div className="flex flex-wrap gap-2">
        {GEM_COLORS.map((color) => {
          const chips = data.chips[color];
          const bonuses = data.bonuses[color];
          if (chips === 0 && bonuses === 0) {
            return (
              <Tip
                key={color}
                content={playerChipRowTip({ color, chips, bonuses, isMe })}
              >
                <div
                  data-flight-anchor={`player-chip-${playerID}-${color}`}
                  className="flex h-8 items-center gap-1 rounded-full border border-white/5 px-2 text-[10px] text-white/30"
                >
                  <span className="capitalize">{color}</span>
                </div>
              </Tip>
            );
          }
          return (
            <Tip
              key={color}
              content={playerChipRowTip({ color, chips, bonuses, isMe })}
            >
              <div
                data-flight-anchor={`player-chip-${playerID}-${color}`}
                className="flex h-8 items-center gap-1 rounded-full bg-black/30 px-1.5 ring-1 ring-inset ring-white/10"
              >
                <GemChip color={color} size="xs" count={chips} />
                {bonuses > 0 ? (
                  <span className="ml-1 inline-flex items-center gap-0.5 rounded-full bg-amber-300/15 px-1.5 py-0.5 text-[10px] text-amber-100">
                    +{bonuses}
                  </span>
                ) : null}
              </div>
            </Tip>
          );
        })}
        {/* Gold pile separately */}
        <Tip
          content={playerChipRowTip({
            color: "gold",
            chips: data.chips.gold,
            bonuses: 0,
            isMe,
          })}
        >
          <div
            data-flight-anchor={`player-chip-${playerID}-gold`}
            className="flex h-8 items-center gap-1 rounded-full bg-black/30 px-1.5 ring-1 ring-inset ring-white/10"
          >
            <GemChip color="gold" size="xs" count={data.chips.gold} />
          </div>
        </Tip>
      </div>
      {/* Reserved + nobles */}
      {(data.reservedCount > 0 || data.nobles.length > 0) && (
        <div className="flex flex-wrap items-end gap-2">
          {data.nobles.length > 0 ? (
            <div className="flex items-end gap-1">
              {data.nobles.map((id: string) => {
                const noble = getNoble(id);
                return (
                  <Tip key={id} content={nobleTip({ noble, view })}>
                    <div>
                      <NobleTile noble={noble} size="sm" layoutId={`noble-${id}`} />
                    </div>
                  </Tip>
                );
              })}
            </div>
          ) : null}
          {data.reservedCount > 0 ? (
            <div className="flex flex-wrap items-end gap-1">
              {isMe
                ? data.reservedCards.map((id: string) => {
                  const card = getCard(id);
                  const buyable = canBuyReserved && canAfford(
                    {
                      bonuses: data.bonuses,
                      chips: data.chips,
                      reserved: data.reservedCards,
                      nobles: data.nobles,
                      score: data.score,
                      mustDiscard: data.mustDiscard,
                    },
                    card,
                  );
                  return (
                    <div key={id} data-flight-anchor={`reserved-card-${id}`}>
                      <DevCard
                        card={card}
                        size="sm"
                        layoutId={`card-${id}`}
                        emphasized={buyable}
                        {...(buyable && onBuyReserved ? { onClick: () => onBuyReserved(id) } : {})}
                      />
                    </div>
                  );
                })
                : Array.from({ length: data.reservedCount }, (_, i) => (
                  <FaceDownCard key={i} tier={1} />
                ))}
            </div>
          ) : null}
        </div>
      )}
    </motion.div>
  );
}

function FaceDownCard({ tier }: { tier: 1 | 2 | 3 }) {
  return (
    <div
      className="h-24 w-[68px] rounded-md"
      style={{
        background:
          tier === 3
            ? "linear-gradient(135deg, #1a1a2a 0%, #2d2d4a 100%)"
            : tier === 2
              ? "linear-gradient(135deg, #b3a25a 0%, #7a6630 100%)"
              : "linear-gradient(135deg, #4a8a3a 0%, #2a5a20 100%)",
        boxShadow:
          "inset 0 1px 0 rgba(255,255,255,0.18), inset 0 -2px 0 rgba(0,0,0,0.45)",
        border: "1px solid rgba(0,0,0,0.4)",
      }}
    />
  );
}

function SeatBadge({ isMe, isActive }: { isMe: boolean; isActive: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center justify-center rounded-full px-2 text-[10px] uppercase tracking-[0.2em]",
        isActive
          ? "bg-amber-300 text-stone-900"
          : isMe
            ? "bg-amber-100/20 text-amber-100"
            : "bg-white/10 text-white/70",
      )}
    >
      {isActive ? "Turn" : isMe ? "You" : "Player"}
    </span>
  );
}

function playerLabel(id: string, isMe: boolean): string {
  const n = Number.parseInt(id, 10);
  const name = `Merchant ${Number.isFinite(n) ? n + 1 : id}`;
  return isMe ? `${name} (you)` : name;
}

// Avoid unused-warning when CHIP_COLORS isn't directly referenced.
void CHIP_COLORS;
