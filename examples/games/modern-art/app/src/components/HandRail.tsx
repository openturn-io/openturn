import * as React from "react";

import { type ModernArtPlayerView } from "@openturn/example-modern-art-game";

import { PaintingCard } from "./PaintingCard";
import { handPaintingTip } from "../lib/tutorialTips";

interface HandRailProps {
  onPlayPainting: (cardID: string) => void;
  view: ModernArtPlayerView;
}

export function HandRail({ onPlayPainting, view }: HandRailProps) {
  const me = view.myPlayerID;
  const canPlay =
    me !== null && view.phase === "selectPainting" && view.activePlayers.includes(me);

  if (me === null) {
    return (
      <section className="panel hand-rail hand-empty">
        <span className="hand-note">Spectating — hands are hidden.</span>
      </section>
    );
  }

  return (
    <section className={`panel hand-rail ${canPlay ? "is-hot" : ""}`}>
      <div className="hand-title">
        <h2 className="panel-title">Your Hand</h2>
        <span className="hand-note">
          {canPlay
            ? "You hold the gavel — pick a painting to auction"
            : `${view.myHand.length} painting${view.myHand.length === 1 ? "" : "s"}`}
        </span>
      </div>
      <div className="hand-scroll">
        {view.myHand.length === 0 ? (
          <span className="hand-note">No paintings left this round.</span>
        ) : (
          view.myHand.map((cardID) => {
            const card = view.cards[cardID]!;
            return (
              <PaintingCard
                card={card}
                disabled={!canPlay}
                highlight={canPlay}
                key={cardID}
                onClick={() => onPlayPainting(cardID)}
                size="md"
                tip={handPaintingTip({ card, view, canPlay })}
              />
            );
          })
        )}
      </div>
    </section>
  );
}
