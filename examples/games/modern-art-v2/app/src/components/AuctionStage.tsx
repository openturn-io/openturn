import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";

import type {
  ModernArtPlayerID,
  ModernArtPlayerView,
  PublicAuctionView,
} from "@openturn/example-modern-art-v2-game";

import { ARTIST_STYLE, AUCTION_LABEL } from "../lib/artists";
import { cn } from "../lib/utils";
import { PaintingCard } from "./PaintingCard";

interface AuctionStageProps {
  view: ModernArtPlayerView;
  myID: ModernArtPlayerID | null;
  canAct: boolean;
  onPlaceBid: (amount: number) => void;
  onPassBid: () => void;
  onSealBid: (amount: number) => void;
  onSetFixedPrice: (price: number) => void;
  onBuyFixed: () => void;
  onDeclineFixed: () => void;
}

export function AuctionStage({
  view,
  myID,
  canAct,
  onPlaceBid,
  onPassBid,
  onSealBid,
  onSetFixedPrice,
  onBuyFixed,
  onDeclineFixed,
}: AuctionStageProps): React.ReactNode {
  const auction = view.auction;
  if (auction === null) {
    return (
      <div className="gallery-panel flex min-h-[180px] flex-col items-center justify-center gap-2 p-6 text-center">
        <span className="text-[11px] uppercase tracking-[0.25em] text-[var(--color-gold-bright)]/60">
          The floor is open
        </span>
        <p className="m-0 font-display text-xl text-parchment/70">
          Awaiting the next lot…
        </p>
      </div>
    );
  }

  const style = ARTIST_STYLE[auction.artist];
  const isMyTurn = canAct && auction.pendingBidders[0] === myID;
  const me = myID === null ? null : view.players[myID];
  const myMoney = me?.money ?? 0;

  return (
    <motion.div
      layout
      className="gallery-panel relative overflow-hidden p-4 lg:p-5"
      style={{
        boxShadow: `inset 0 0 0 1px ${style.base}55, inset 0 1px 0 rgba(255,255,255,0.06), inset 0 -2px 6px rgba(0,0,0,0.3)`,
      }}
    >
      {/* Artist-tinted glow */}
      <span
        aria-hidden
        className="pointer-events-none absolute -top-1/3 left-1/2 h-2/3 w-2/3 -translate-x-1/2 rounded-full opacity-25 blur-3xl"
        style={{ background: style.glow }}
      />

      <div className="relative flex flex-col gap-4 lg:flex-row lg:items-center lg:gap-6">
        {/* Lot display */}
        <div className="flex flex-col items-center gap-2">
          <div className="flex items-end gap-2">
            <AnimatePresence mode="popLayout">
              {auction.paintings.map((pid) => (
                <motion.div
                  key={pid}
                  layout
                  initial={{ opacity: 0, scale: 0.85, rotateY: -25 }}
                  animate={{ opacity: 1, scale: 1, rotateY: 0 }}
                  exit={{ opacity: 0, scale: 0.85 }}
                  transition={{ duration: 0.35 }}
                >
                  <PaintingCard painting={pid} size="lg" emphasized />
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
          <span className="font-display text-sm text-parchment/80">
            {style.label} · {AUCTION_LABEL[auction.type]}
          </span>
        </div>

        {/* Auction state + interaction */}
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <AuctionMeta auction={auction} />
          <AuctionControls
            auction={auction}
            isMyTurn={isMyTurn}
            myMoney={myMoney}
            myID={myID}
            view={view}
            onPlaceBid={onPlaceBid}
            onPassBid={onPassBid}
            onSealBid={onSealBid}
            onSetFixedPrice={onSetFixedPrice}
            onBuyFixed={onBuyFixed}
            onDeclineFixed={onDeclineFixed}
          />
        </div>
      </div>
    </motion.div>
  );
}

function AuctionMeta({ auction }: { auction: PublicAuctionView }): React.ReactNode {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="rounded-full bg-black/35 px-2.5 py-1 text-[var(--color-gold-bright)]/90 ring-1 ring-inset ring-[var(--color-gold-leaf)]/30">
        Lot by P{Number.parseInt(auction.auctioneer, 10) + 1}
      </span>
      {auction.type !== "sealed" && auction.highBidder !== null ? (
        <motion.span
          key={auction.highBid}
          initial={{ scale: 1 }}
          animate={{ scale: [1, 1.18, 1] }}
          transition={{ duration: 0.4 }}
          className="rounded-full bg-[var(--color-gold-leaf)]/20 px-2.5 py-1 font-display text-sm text-[var(--color-gold-bright)] ring-1 ring-inset ring-[var(--color-gold-bright)]/40"
        >
          High bid ${auction.highBid} · P{Number.parseInt(auction.highBidder, 10) + 1}
        </motion.span>
      ) : auction.type !== "sealed" ? (
        <span className="rounded-full bg-black/25 px-2.5 py-1 text-parchment/50">No bids yet</span>
      ) : null}
      {auction.type === "sealed" ? (
        <span className="rounded-full bg-black/35 px-2.5 py-1 text-parchment/70">
          {auction.sealedSubmitted.length} sealed {auction.sealedSubmitted.length === 1 ? "bid" : "bids"} in
        </span>
      ) : null}
      {auction.fixedPrice !== null ? (
        <span className="rounded-full bg-[var(--color-gold-leaf)]/25 px-2.5 py-1 font-display text-sm text-[var(--color-gold-bright)]">
          Fixed price ${auction.fixedPrice}
        </span>
      ) : null}
    </div>
  );
}

interface ControlsProps {
  auction: PublicAuctionView;
  isMyTurn: boolean;
  myMoney: number;
  myID: ModernArtPlayerID | null;
  view: ModernArtPlayerView;
  onPlaceBid: (amount: number) => void;
  onPassBid: () => void;
  onSealBid: (amount: number) => void;
  onSetFixedPrice: (price: number) => void;
  onBuyFixed: () => void;
  onDeclineFixed: () => void;
}

function AuctionControls(props: ControlsProps): React.ReactNode {
  const { auction, isMyTurn, myMoney } = props;

  if (!isMyTurn) {
    return (
      <p className="m-0 text-sm text-parchment/50">
        {auction.pendingBidders.length > 0
          ? `Waiting on P${Number.parseInt(auction.pendingBidders[0]!, 10) + 1}…`
          : "Resolving…"}
      </p>
    );
  }

  if (auction.type === "fixed" && auction.fixedPrice === null) {
    return <FixedPriceSetter {...props} />;
  }

  if (auction.type === "sealed") {
    return <SealedBidder {...props} />;
  }

  if (auction.type === "fixed") {
    return <FixedBuyer {...props} />;
  }

  // open / once-around
  return <OpenBidder minRaise={auction.highBid + 1} money={myMoney} onPlaceBid={props.onPlaceBid} onPass={props.onPassBid} />;
}

function OpenBidder({
  minRaise,
  money,
  onPlaceBid,
  onPass,
}: {
  minRaise: number;
  money: number;
  onPlaceBid: (amount: number) => void;
  onPass: () => void;
}): React.ReactNode {
  const [amount, setAmount] = React.useState(minRaise);
  React.useEffect(() => setAmount(minRaise), [minRaise]);
  const canBid = amount >= minRaise && amount <= money;
  const quickSteps = [minRaise, minRaise + 5, minRaise + 10, Math.min(money, minRaise + 20)].filter(
    (v, i, arr) => v >= minRaise && v <= money && arr.indexOf(v) === i,
  );
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-1.5 rounded-lg bg-black/30 px-2 py-1 ring-1 ring-inset ring-white/10">
        <span className="text-xs text-[var(--color-gold-bright)]/70">$</span>
        <input
          type="number"
          min={minRaise}
          max={money}
          value={amount}
          onChange={(e) => setAmount(Number.parseInt(e.target.value, 10) || 0)}
          className="w-16 bg-transparent text-sm text-parchment outline-none"
        />
      </div>
      {quickSteps.map((v) => (
        <button
          key={v}
          type="button"
          onClick={() => onPlaceBid(v)}
          className="rounded-full bg-[var(--color-gold-leaf)]/20 px-3 py-1 text-xs text-[var(--color-gold-bright)] ring-1 ring-inset ring-[var(--color-gold-bright)]/30 transition hover:bg-[var(--color-gold-leaf)]/35 cursor-pointer"
        >
          ${v}
        </button>
      ))}
      <button
        type="button"
        onClick={() => canBid && onPlaceBid(amount)}
        disabled={!canBid}
        className="rounded-full bg-[var(--color-gold-bright)] px-4 py-1.5 text-sm font-medium text-[var(--color-frame-dark)] transition hover:brightness-110 disabled:opacity-40 cursor-pointer"
      >
        Bid
      </button>
      <button
        type="button"
        onClick={onPass}
        className="rounded-full bg-white/10 px-4 py-1.5 text-sm text-parchment/80 transition hover:bg-white/15 cursor-pointer"
      >
        Pass
      </button>
    </div>
  );
}

function SealedBidder({ myMoney, onSealBid, onPassBid }: ControlsProps): React.ReactNode {
  const [amount, setAmount] = React.useState(Math.min(myMoney, 20));
  React.useEffect(() => setAmount(Math.min(myMoney, 20)), [myMoney]);
  const canBid = amount >= 0 && amount <= myMoney;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-[var(--color-gold-bright)]/70">Your sealed bid:</span>
      <div className="flex items-center gap-1.5 rounded-lg bg-black/40 px-2 py-1 ring-1 ring-inset ring-[var(--color-gold-bright)]/30">
        <span className="text-xs text-[var(--color-gold-bright)]/70">$</span>
        <input
          type="number"
          min={0}
          max={myMoney}
          value={amount}
          onChange={(e) => setAmount(Number.parseInt(e.target.value, 10) || 0)}
          className="w-16 bg-transparent text-sm text-parchment outline-none"
        />
      </div>
      <button
        type="button"
        onClick={() => canBid && amount > 0 && onSealBid(amount)}
        disabled={!canBid || amount <= 0}
        className="rounded-full bg-[var(--color-gold-bright)] px-4 py-1.5 text-sm font-medium text-[var(--color-frame-dark)] transition hover:brightness-110 disabled:opacity-40 cursor-pointer"
      >
        Seal bid
      </button>
      <button
        type="button"
        onClick={onPassBid}
        className="rounded-full bg-white/10 px-4 py-1.5 text-sm text-parchment/80 transition hover:bg-white/15 cursor-pointer"
      >
        Pass
      </button>
    </div>
  );
}

function FixedPriceSetter({ myMoney, onSetFixedPrice }: ControlsProps): React.ReactNode {
  const [price, setPrice] = React.useState(Math.min(myMoney, 30));
  React.useEffect(() => setPrice(Math.min(myMoney, 30)), [myMoney]);
  const steps = [10, 20, 30, 40, 50, 60, 80].filter((v) => v <= myMoney || v <= 100);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-[var(--color-gold-bright)]/80">Set your fixed price:</span>
      {steps.map((v) => (
        <button
          key={v}
          type="button"
          onClick={() => onSetFixedPrice(v)}
          className={cn(
            "rounded-full px-3 py-1 text-xs ring-1 ring-inset transition cursor-pointer",
            price === v
              ? "bg-[var(--color-gold-bright)] text-[var(--color-frame-dark)] ring-[var(--color-gold-bright)]"
              : "bg-[var(--color-gold-leaf)]/20 text-[var(--color-gold-bright)] ring-[var(--color-gold-bright)]/30 hover:bg-[var(--color-gold-leaf)]/35",
          )}
        >
          ${v}
        </button>
      ))}
      <div className="flex items-center gap-1.5 rounded-lg bg-black/30 px-2 py-1 ring-1 ring-inset ring-white/10">
        <span className="text-xs text-[var(--color-gold-bright)]/70">$</span>
        <input
          type="number"
          min={0}
          value={price}
          onChange={(e) => setPrice(Number.parseInt(e.target.value, 10) || 0)}
          className="w-16 bg-transparent text-sm text-parchment outline-none"
        />
      </div>
      <button
        type="button"
        onClick={() => onSetFixedPrice(price)}
        className="rounded-full bg-[var(--color-gold-bright)] px-4 py-1.5 text-sm font-medium text-[var(--color-frame-dark)] transition hover:brightness-110 cursor-pointer"
      >
        Set price
      </button>
    </div>
  );
}

function FixedBuyer({ auction, myMoney, onBuyFixed, onDeclineFixed }: ControlsProps): React.ReactNode {
  const price = auction.fixedPrice ?? 0;
  const canAfford = myMoney >= price;
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={onBuyFixed}
        disabled={!canAfford}
        className="rounded-full bg-[var(--color-gold-bright)] px-5 py-1.5 text-sm font-medium text-[var(--color-frame-dark)] transition hover:brightness-110 disabled:opacity-40 cursor-pointer"
      >
        Buy for ${price}
      </button>
      {!canAfford ? <span className="text-xs text-red-300/80">Not enough money</span> : null}
      <button
        type="button"
        onClick={onDeclineFixed}
        className="rounded-full bg-white/10 px-4 py-1.5 text-sm text-parchment/80 transition hover:bg-white/15 cursor-pointer"
      >
        Decline
      </button>
    </div>
  );
}
