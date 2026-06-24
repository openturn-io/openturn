import * as React from "react";
import { LayoutGroup, motion } from "framer-motion";

import {
  ARTISTS,
  getPainting,
  type AuctionType,
  type ModernArtPlayerID,
  type ModernArtPlayerView,
} from "@openturn/example-modern-art-v2-game";

import { ARTIST_STYLE, AUCTION_GLYPH, AUCTION_LABEL } from "../lib/artists";
import { cn } from "../lib/utils";
import { AuctionStage } from "./AuctionStage";
import { GameOverDialog } from "./GameOverDialog";
import { PaintingCard } from "./PaintingCard";
import { PlayerTableau } from "./PlayerTableau";
import { TurnBanner } from "./TurnBanner";

interface GalleryProps {
  view: ModernArtPlayerView;
  myID: ModernArtPlayerID | null;
  onPlaceBid: (amount: number) => void;
  onPassBid: () => void;
  onSealBid: (amount: number) => void;
  onSetFixedPrice: (price: number) => void;
  onBuyFixed: () => void;
  onDeclineFixed: () => void;
  onStartAuction: (paintingId: string, doublePaintingId?: string) => void;
  onSkipTurn: () => void;
}

export function Gallery({
  view,
  myID,
  onPlaceBid,
  onPassBid,
  onSealBid,
  onSetFixedPrice,
  onBuyFixed,
  onDeclineFixed,
  onStartAuction,
  onSkipTurn,
}: GalleryProps): React.ReactNode {
  const finished = view.winner !== null;
  const me = myID === null ? null : view.players[myID];
  const isMyAuctioneerTurn =
    myID !== null && view.currentTurn === myID && view.auction === null && !finished;
  const canAct = myID !== null && view.currentTurn === myID && !finished;

  const meLabel = myID === null ? "Spectator" : `Collector ${Number.parseInt(myID, 10) + 1}`;
  const turnLabel =
    view.currentTurn === null ? "—" : `Collector ${Number.parseInt(view.currentTurn, 10) + 1}`;

  return (
    <LayoutGroup>
      <div className="relative grid h-full min-h-0 w-full grid-rows-[auto_minmax(0,1fr)_minmax(0,auto)] gap-3 overflow-hidden px-3 py-3 lg:gap-4 lg:px-6 lg:py-4 xl:grid-rows-[auto_minmax(0,1fr)]">
        <TurnBanner view={view} isMe={canAct} meLabel={meLabel} turnLabel={turnLabel} />

        <div className="grid min-h-0 gap-3 overflow-hidden lg:grid-cols-[minmax(0,1fr)_280px] lg:gap-4">
          {/* Center: artist scoreboard + auction stage */}
          <div className="flex min-h-0 flex-col gap-3 overflow-y-auto pr-1">
            <ArtistScoreboard view={view} />
            <AuctionStage
              view={view}
              myID={myID}
              canAct={canAct}
              onPlaceBid={onPlaceBid}
              onPassBid={onPassBid}
              onSealBid={onSealBid}
              onSetFixedPrice={onSetFixedPrice}
              onBuyFixed={onBuyFixed}
              onDeclineFixed={onDeclineFixed}
            />
            {isMyAuctioneerTurn ? (
              <AuctioneerHand view={view} onStartAuction={onStartAuction} onSkipTurn={onSkipTurn} hasCards={(me?.handSize ?? 0) > 0} />
            ) : null}
          </div>

          {/* Right rail: players */}
          <div className="flex min-h-0 flex-col gap-3 overflow-y-auto pr-1">
            {view.seatOrder.map((id) => (
              <PlayerTableau
                key={id}
                view={view}
                playerID={id}
                isMe={id === myID}
                isCurrentTurn={view.currentTurn === id}
              />
            ))}
          </div>
        </div>

        {/* Smaller screens: players below */}
        <div className="grid max-h-[34svh] min-h-0 gap-3 overflow-y-auto pr-1 lg:hidden">
          {view.seatOrder.map((id) => (
            <PlayerTableau
              key={id}
              view={view}
              playerID={id}
              isMe={id === myID}
              isCurrentTurn={view.currentTurn === id}
            />
          ))}
        </div>
      </div>
    </LayoutGroup>
  );
}

function ArtistScoreboard({ view }: { view: ModernArtPlayerView }): React.ReactNode {
  const ranked = [...ARTISTS].sort(
    (a, b) => view.countsSold[b] - view.countsSold[a],
  );
  return (
    <div className="gallery-panel flex flex-wrap items-stretch gap-2 p-3">
      <span className="mr-1 self-center text-[11px] uppercase tracking-[0.22em] text-[var(--color-gold-bright)]/60">
        Market
      </span>
      {ranked.map((artist) => {
        const style = ARTIST_STYLE[artist];
        const sold = view.countsSold[artist] ?? 0;
        const value = view.cumulativeValue[artist] ?? 0;
        const isLeading = sold >= 5;
        return (
          <div
            key={artist}
            className="flex min-w-[88px] flex-1 flex-col gap-1 rounded-lg bg-black/25 p-2"
            style={{ boxShadow: `inset 0 0 0 1px ${style.base}44` }}
          >
            <div className="flex items-center gap-1.5">
              <span
                className="inline-block h-3 w-3 rounded-full"
                style={{ background: style.base, boxShadow: `0 0 8px ${style.glow}` }}
              />
              <span className="font-display text-xs text-parchment/90">{style.label}</span>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="font-mono text-lg text-parchment">{sold}<span className="text-[10px] text-parchment/50">/5</span></span>
              <span className="font-display text-sm text-[var(--color-gold-bright)]">${value}</span>
            </div>
            {/* Progress bar to 5 */}
            <div className="h-1 w-full overflow-hidden rounded-full bg-black/40">
              <motion.div
                className="h-full rounded-full"
                style={{ background: style.base }}
                animate={{ width: `${Math.min(100, (sold / 5) * 100)}%` }}
                transition={{ duration: 0.4 }}
              />
            </div>
            {isLeading ? (
              <span className="text-[9px] uppercase tracking-wide text-[var(--color-gold-bright)]">Round end</span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

interface AuctioneerHandProps {
  view: ModernArtPlayerView;
  onStartAuction: (paintingId: string, doublePaintingId?: string) => void;
  onSkipTurn: () => void;
  hasCards: boolean;
}

function AuctioneerHand({ view, onStartAuction, onSkipTurn, hasCards }: AuctioneerHandProps): React.ReactNode {
  const [selectedDouble, setSelectedDouble] = React.useState<string | null>(null);

  if (!hasCards) {
    return (
      <div className="gallery-panel flex items-center justify-between gap-3 p-3">
        <p className="m-0 text-sm text-parchment/60">You have no cards to auction.</p>
        <button
          type="button"
          onClick={onSkipTurn}
          className="rounded-full bg-white/10 px-4 py-1.5 text-sm text-parchment/80 transition hover:bg-white/15 cursor-pointer"
        >
          Skip turn
        </button>
      </div>
    );
  }

  return (
    <div className="gallery-panel flex flex-col gap-2 p-3">
      <p className="m-0 text-[11px] uppercase tracking-[0.22em] text-[var(--color-gold-bright)]/70">
        Your turn — choose a lot to auction
      </p>
      <div className="flex flex-wrap gap-2">
        {view.myHand.map((pid) => {
          const painting = getPainting(pid);
          const isDouble = painting.auction === "double";
          const isPaired = selectedDouble !== null;
          const canPair =
            isDouble &&
            selectedDouble === null &&
            view.myHand.some(
              (other) =>
                other !== pid &&
                getPainting(other).artist === painting.artist &&
                getPainting(other).auction !== "double",
            );

          if (isPaired && isDouble && selectedDouble !== pid) {
            // We're in pairing mode; show only same-artist non-double cards as pair targets.
            const other = getPainting(selectedDouble);
            if (painting.artist !== other.artist || painting.auction === "double") return null;
            return (
              <PaintingCard
                key={pid}
                painting={pid}
                size="md"
                emphasized
                onClick={() => {
                  onStartAuction(selectedDouble, pid);
                  setSelectedDouble(null);
                }}
              />
            );
          }
          if (isPaired) return null;

          return (
            <div key={pid} className="relative">
              <PaintingCard
                painting={pid}
                size="md"
                onClick={() => onStartAuction(pid)}
              />
              {canPair ? (
                <button
                  type="button"
                  onClick={() => setSelectedDouble(pid)}
                  className="absolute -bottom-2 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full border border-[var(--color-gold-bright)]/70 bg-black/70 px-2 py-0.5 text-[10px] text-[var(--color-gold-bright)] transition hover:bg-black/85 cursor-pointer"
                >
                  Pair a 2nd
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
      {selectedDouble !== null ? (
        <button
          type="button"
          onClick={() => onStartAuction(selectedDouble)}
          className="self-start rounded-full bg-white/10 px-3 py-1 text-xs text-parchment/70 transition hover:bg-white/15 cursor-pointer"
        >
          Auction solo (no pair)
        </button>
      ) : null}
    </div>
  );
}

void (null as unknown as AuctionType);
void AUCTION_GLYPH;
void AUCTION_LABEL;
