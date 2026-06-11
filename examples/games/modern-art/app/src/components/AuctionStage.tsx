import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";

import {
  seatsFromLeft,
  type ModernArtPlayerID,
  type ModernArtPlayerView,
} from "@openturn/example-modern-art-game";

import { AuctionControls, type AuctionHandlers } from "./AuctionControls";
import { AuctionTypeIcon, GavelIcon } from "./icons";
import { PaintingCard } from "./PaintingCard";
import { Tip } from "./ui/tip";
import { AUCTION_NAME, AUCTION_SUMMARY, curatorName, curatorShort, money } from "../lib/format";
import { lotHeaderTip, lotPaintingTip, phaseTip } from "../lib/tutorialTips";

interface AuctionStageProps extends AuctionHandlers {
  view: ModernArtPlayerView;
}

/** Headline status line for the current auction state. */
function ribbonText(view: ModernArtPlayerView): string {
  const lot = view.lot;
  if (view.revealedMoney !== null) {
    return "The gavel falls for the last time — final standings are in.";
  }
  if (view.phase === "selectPainting") {
    return `${curatorName(view.hammer)} is choosing the next painting to sell.`;
  }
  if (lot === null) return "";
  if (view.phase === "doubleOffer") {
    const actor = view.activePlayers[0];
    return actor === undefined
      ? "Resolving the double offer…"
      : `${curatorName(actor)} may pair a matching painting — or pass.`;
  }
  if (view.phase === "openAuction") {
    return lot.highBid === null
      ? "No bids yet — if everyone passes, the auctioneer keeps it for free."
      : `High bid ${money(lot.highBid.amount)} — ${curatorName(lot.highBid.player)}.`;
  }
  if (view.phase === "oneOfferAuction") {
    const base = lot.highBid === null
      ? "No offers yet."
      : `Best offer ${money(lot.highBid.amount)} — ${curatorName(lot.highBid.player)}.`;
    return `${base} Each collector bids once; the auctioneer goes last.`;
  }
  if (view.phase === "hiddenAuction") {
    return `${lot.hiddenBidPlayers.length} of ${view.seatOrder.length} bids sealed.`;
  }
  if (view.phase === "fixedPriceSet") {
    return `${curatorName(lot.auctioneer)} is setting the asking price.`;
  }
  if (view.phase === "fixedPriceOffer") {
    const actor = lot.fixedOfferOrder[lot.fixedOfferIndex];
    return `Asking ${money(lot.fixedPrice ?? 0)}${actor === undefined ? "" : ` — ${curatorName(actor)} deciding`}.`;
  }
  return "";
}

/** Ordered turn chips for the sequential phases. */
function orderStrip(view: ModernArtPlayerView): { order: readonly ModernArtPlayerID[]; index: number } | null {
  const lot = view.lot;
  if (lot === null) return null;
  if (view.phase === "oneOfferAuction") return { index: lot.oneOfferIndex, order: lot.oneOfferOrder };
  if (view.phase === "fixedPriceOffer") return { index: lot.fixedOfferIndex, order: lot.fixedOfferOrder };
  if (view.phase === "doubleOffer") {
    // The public lot omits the double-offer cursor, but the order itself is
    // public knowledge: original auctioneer first, then clockwise around.
    const order = [lot.originalAuctioneer, ...seatsFromLeft(view.seatOrder, lot.originalAuctioneer, false)];
    const actor = view.activePlayers[0];
    const index = actor === undefined ? order.length : order.indexOf(actor);
    return { index: index === -1 ? 0 : index, order };
  }
  return null;
}

export function AuctionStage(props: AuctionStageProps) {
  const { view } = props;
  const lot = view.lot;
  const lotCards = lot?.cards ?? [];
  const strip = orderStrip(view);
  const takenOver = lot !== null && lot.originalAuctioneer !== lot.auctioneer;

  return (
    <section className="panel auction-stage">
      <div className="stage-header">
        <Tip content={lotHeaderTip({ view })}>
          <div className="stage-title-block">
            <p className="eyebrow">{lotCards.length > 1 ? "Double lot" : "On the block"}</p>
            <h2 className="stage-title">
              {lotCards.length === 0
                ? "The floor is open"
                : lotCards.map((id) => view.cards[id]?.title).join("  +  ")}
            </h2>
          </div>
        </Tip>
        {lot !== null ? (
          <Tip content={phaseTip(view)}>
            <div className="auction-banner">
              <AuctionTypeIcon className="auction-banner-icon" type={lotCards.length > 1 ? "double" : lot.type} />
              <div>
                <strong>{lotCards.length > 1 ? `Double · ${AUCTION_NAME[lot.type]}` : AUCTION_NAME[lot.type]} auction</strong>
                <span>{AUCTION_SUMMARY[lot.type]}</span>
              </div>
            </div>
          </Tip>
        ) : null}
      </div>

      <div className="easel">
        <AnimatePresence mode="popLayout">
          <motion.div
            animate={{ opacity: 1, scale: 1, y: 0 }}
            className="easel-cards"
            exit={{ opacity: 0, scale: 0.96, y: -10 }}
            initial={{ opacity: 0, scale: 0.94, y: 24 }}
            key={lotCards.join(":") || "empty"}
            transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
          >
            {lotCards.length === 0 ? (
              <div className="empty-easel">
                <GavelIcon className="empty-easel-icon" />
                <span>
                  {view.revealedMoney !== null
                    ? "The gallery is closed"
                    : `${curatorName(view.hammer)} brings the next piece to the block`}
                </span>
              </div>
            ) : (
              lotCards.map((cardID) => (
                <PaintingCard
                  card={view.cards[cardID]!}
                  key={cardID}
                  selected
                  size="lg"
                  tip={lotPaintingTip({ card: view.cards[cardID]!, view })}
                />
              ))
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="stage-status">
        {lot !== null ? (
          <span className="auctioneer-chip">
            <GavelIcon className="pill-icon" />
            {curatorName(lot.auctioneer)}
            {takenOver ? ` (took over from ${curatorName(lot.originalAuctioneer)})` : ""}
          </span>
        ) : null}
        <p className="ribbon-text">{ribbonText(view)}</p>
        {strip !== null ? (
          <div className="order-strip" aria-label="Turn order">
            {strip.order.map((id, idx) => (
              <span
                className={`order-chip ${idx < strip.index ? "done" : ""} ${idx === strip.index ? "now" : ""} ${
                  id === view.myPlayerID ? "me" : ""
                }`}
                key={`${id}-${idx}`}
                title={curatorName(id)}
              >
                {curatorShort(id)}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      <AuctionControls {...props} />

      {view.lastAction !== null ? (
        <p className="action-ticker" aria-live="polite">
          {view.lastAction.detail}
        </p>
      ) : null}
    </section>
  );
}
