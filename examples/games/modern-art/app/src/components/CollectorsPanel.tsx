import * as React from "react";

import {
  ARTISTS,
  seatsFromLeft,
  type ModernArtPlayerID,
  type ModernArtPlayerView,
} from "@openturn/example-modern-art-game";

import { GavelIcon } from "./icons";
import { Tip } from "./ui/tip";
import { ARTIST_CLASS, ARTIST_NAME, curatorName, curatorShort, money } from "../lib/format";
import { playerRowTip } from "../lib/tutorialTips";

interface CollectorsPanelProps {
  view: ModernArtPlayerView;
}

/** Per-phase, per-player status chip — mirrors the engine's order fields. */
function seatStatus(view: ModernArtPlayerView, id: ModernArtPlayerID): { label: string; kind: string } | null {
  const lot = view.lot;
  if (view.revealedMoney !== null) return null;

  if (view.phase === "selectPainting") {
    return id === view.hammer ? { kind: "acting", label: "Choosing…" } : null;
  }
  if (lot === null) return null;

  if (view.phase === "openAuction") {
    if (lot.highBid?.player === id) return { kind: "high", label: `High ${money(lot.highBid.amount)}` };
    if (lot.passed[id] === true) return { kind: "out", label: "Passed" };
    if (view.activePlayers.includes(id)) return { kind: "acting", label: "Bidding…" };
    return { kind: "out", label: "Out" };
  }

  if (view.phase === "oneOfferAuction") {
    const idx = lot.oneOfferOrder.indexOf(id);
    if (idx === -1) return null;
    if (lot.highBid?.player === id) return { kind: "high", label: `Offered ${money(lot.highBid.amount)}` };
    if (idx < lot.oneOfferIndex) return { kind: "out", label: "Passed" };
    if (idx === lot.oneOfferIndex) return { kind: "acting", label: "Deciding…" };
    return { kind: "wait", label: `${idx - lot.oneOfferIndex} ahead` };
  }

  if (view.phase === "hiddenAuction") {
    return lot.hiddenBidPlayers.includes(id)
      ? { kind: "done", label: "Sealed" }
      : { kind: "acting", label: "Sealing…" };
  }

  if (view.phase === "fixedPriceSet") {
    return id === lot.auctioneer ? { kind: "acting", label: "Setting price…" } : null;
  }

  if (view.phase === "fixedPriceOffer") {
    if (id === lot.auctioneer) return { kind: "high", label: `Asking ${money(lot.fixedPrice ?? 0)}` };
    const idx = lot.fixedOfferOrder.indexOf(id);
    if (idx === -1) return null;
    if (idx < lot.fixedOfferIndex) return { kind: "out", label: "Passed" };
    if (idx === lot.fixedOfferIndex) return { kind: "acting", label: "Deciding…" };
    return { kind: "wait", label: `${idx - lot.fixedOfferIndex} ahead` };
  }

  if (view.phase === "doubleOffer") {
    if (view.activePlayers.includes(id)) return { kind: "acting", label: "May pair…" };
    // Order is public: original auctioneer first, then clockwise.
    const order = [lot.originalAuctioneer, ...seatsFromLeft(view.seatOrder, lot.originalAuctioneer, false)];
    const actor = view.activePlayers[0];
    const cursor = actor === undefined ? order.length : order.indexOf(actor);
    const idx = order.indexOf(id);
    if (idx !== -1 && idx < cursor) return { kind: "out", label: "Passed" };
    return null;
  }

  return null;
}

export function CollectorsPanel({ view }: CollectorsPanelProps) {
  const auctioneer = view.lot?.auctioneer ?? null;

  return (
    <aside className="panel collectors-panel">
      <h2 className="panel-title">Collectors</h2>
      <p className="panel-subtitle">Cash stays secret until the final reveal</p>
      <div className="collector-list">
        {view.seatOrder.map((id, seatIndex) => {
          const player = view.players[id];
          const isMe = id === view.myPlayerID;
          const isActive = view.activePlayers.includes(id);
          const status = seatStatus(view, id);
          const cash = view.revealedMoney?.[id] ?? player.money;
          const galleryByArtist = ARTISTS.map((artist) => ({
            artist,
            count: player.gallery.filter((cardID) => view.cards[cardID]?.artist === artist).length,
          })).filter((entry) => entry.count > 0);

          return (
            <Tip content={playerRowTip({ view, playerID: id })} key={id}>
              <div className={`collector-row ${isActive ? "is-active" : ""} ${isMe ? "is-me" : ""}`}>
                <div className={`collector-avatar seat-${seatIndex}`}>
                  {curatorShort(id)}
                  {(auctioneer ?? view.hammer) === id ? (
                    <span className="collector-gavel" title={auctioneer === id ? "Auctioneer" : "Next to sell"}>
                      <GavelIcon />
                    </span>
                  ) : null}
                </div>
                <div className="collector-main">
                  <div className="collector-name-row">
                    <strong className="collector-name">
                      {curatorName(id)}
                      {isMe ? <span className="you-tag">you</span> : null}
                    </strong>
                    <b className="collector-cash">{cash === null ? "$ ·····" : money(cash)}</b>
                  </div>
                  <div className="collector-meta-row">
                    <span className="collector-meta">
                      {player.handCount} in hand
                      {player.gallery.length > 0 ? ` · ${player.gallery.length} collected` : ""}
                    </span>
                    {status !== null ? (
                      <span className={`seat-status status-${status.kind}`}>{status.label}</span>
                    ) : null}
                  </div>
                  {galleryByArtist.length > 0 ? (
                    <div className="collector-gallery">
                      {galleryByArtist.map(({ artist, count }) => (
                        <span
                          className={`gallery-chip ${ARTIST_CLASS[artist]}`}
                          key={artist}
                          title={`${count} × ${ARTIST_NAME[artist]}`}
                        >
                          <i className="artist-dot" aria-hidden />
                          {count}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            </Tip>
          );
        })}
      </div>
    </aside>
  );
}
