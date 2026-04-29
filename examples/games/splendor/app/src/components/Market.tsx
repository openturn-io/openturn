import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";

import {
  canAfford,
  getCard,
  type SplendorPlayerID,
  type SplendorPlayerView,
  type Tier,
} from "@openturn/example-splendor-game";

import { DevCard } from "./DevCard";
import { Tip } from "./ui/tip";
import { deckStubTip, marketCardTip, reserveButtonTip } from "../lib/tutorialTips";
import { cn } from "../lib/utils";

interface MarketProps {
  view: SplendorPlayerView;
  isMyTurn: boolean;
  canBuy: boolean;
  canReserve: boolean;
  onBuy: (tier: Tier, slot: number) => void;
  onReserve: (tier: Tier, slot: number) => void;
  onReserveTopOfDeck: (tier: Tier) => void;
}

export function Market({
  view,
  isMyTurn,
  canBuy,
  canReserve,
  onBuy,
  onReserve,
  onReserveTopOfDeck,
}: MarketProps) {
  const me = view.myPlayerID === null ? null : view.players[view.myPlayerID as SplendorPlayerID] ?? null;

  return (
    <div className="felt-panel flex flex-col gap-3 p-3 lg:p-4">
      {([3, 2, 1] as const).map((tier) => (
        <TierRow
          key={tier}
          tier={tier}
          view={view}
          isMyTurn={isMyTurn}
          canBuy={canBuy}
          canReserve={canReserve}
          mePlayer={me}
          onBuy={onBuy}
          onReserve={onReserve}
          onReserveTopOfDeck={onReserveTopOfDeck}
        />
      ))}
    </div>
  );
}

interface TierRowProps {
  tier: Tier;
  view: SplendorPlayerView;
  isMyTurn: boolean;
  canBuy: boolean;
  canReserve: boolean;
  mePlayer: SplendorPlayerView["players"][SplendorPlayerID] | null;
  onBuy: (tier: Tier, slot: number) => void;
  onReserve: (tier: Tier, slot: number) => void;
  onReserveTopOfDeck: (tier: Tier) => void;
}

function TierRow({
  tier,
  view,
  isMyTurn,
  canBuy,
  canReserve,
  mePlayer,
  onBuy,
  onReserve,
  onReserveTopOfDeck,
}: TierRowProps) {
  const rowKey = `tier${tier}` as const;
  const ids = view.market[rowKey];
  const deckCount = view.deckCounts[rowKey];
  const tierLabel = tier === 1 ? "I" : tier === 2 ? "II" : "III";
  const finished = view.winner !== null;
  const reserveCount = mePlayer?.reservedCount ?? 0;
  const mustDiscard = mePlayer?.mustDiscard ?? 0;
  return (
    <div className="flex items-center gap-2 lg:gap-3">
      {/* Deck stub */}
      <Tip
        content={deckStubTip({
          tier,
          deckCount,
          reserveCount,
          bankGold: view.bank.gold,
          isMyTurn,
          mustDiscard,
          finished,
        })}
      >
        <button
          type="button"
          className={cn(
            "relative flex h-36 w-[72px] flex-col items-center justify-center rounded-lg lg:h-40 lg:w-[80px]",
            isMyTurn && canReserve && deckCount > 0
              ? "cursor-pointer hover:-translate-y-0.5 transition-transform"
              : "cursor-default opacity-90",
          )}
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
            color: "rgba(255,255,255,0.9)",
          }}
          onClick={() => isMyTurn && canReserve && deckCount > 0 && onReserveTopOfDeck(tier)}
          disabled={!(isMyTurn && canReserve && deckCount > 0)}
        >
          <span className="font-display text-3xl text-shadow-soft">{tierLabel}</span>
          <span className="mt-1 rounded-full bg-black/40 px-2 py-0.5 text-[10px] text-amber-100">
            {deckCount}
          </span>
        </button>
      </Tip>

      {/* Market slots */}
      <div className="flex flex-1 items-center gap-2 lg:gap-3">
        <AnimatePresence initial={false}>
          {ids.map((id, slot) => {
            if (id === null || id === undefined) {
              return (
                <div
                  key={`${tier}-empty-${slot}`}
                  className="h-36 w-[100px] rounded-lg border border-dashed border-white/15 bg-black/15 lg:h-40 lg:w-[112px]"
                />
              );
            }
            const card = getCard(id);
            const affordable = mePlayer !== null && canAfford(
              {
                bonuses: mePlayer.bonuses,
                chips: mePlayer.chips,
                reserved: mePlayer.reservedCards,
                nobles: mePlayer.nobles,
                score: mePlayer.score,
                mustDiscard: mePlayer.mustDiscard,
              },
              card,
            );
            const buyable = isMyTurn && canBuy && affordable;
            return (
              <motion.div
                key={id}
                data-flight-anchor={`market-card-${id}`}
                layout
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ duration: 0.25, delay: slot * 0.05 }}
                className="relative"
              >
                <Tip
                  content={marketCardTip({
                    card,
                    view,
                    isMyTurn,
                    mustDiscard,
                    finished,
                  })}
                >
                  <DevCard
                    card={card}
                    layoutId={`card-${id}`}
                    size="md"
                    emphasized={buyable}
                    {...(buyable ? { onClick: () => onBuy(tier, slot) } : {})}
                  />
                </Tip>
                {isMyTurn && canReserve ? (
                  <Tip
                    content={reserveButtonTip({
                      reserveCount,
                      bankGold: view.bank.gold,
                      isMyTurn,
                      mustDiscard,
                      finished,
                    })}
                  >
                    <button
                      type="button"
                      onClick={() => onReserve(tier, slot)}
                      className="absolute -bottom-2 left-1/2 -translate-x-1/2 rounded-full border border-amber-300/70 bg-black/60 px-2 py-0.5 text-[10px] text-amber-200 hover:bg-black/80 cursor-pointer"
                    >
                      Reserve
                    </button>
                  </Tip>
                ) : null}
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
}
