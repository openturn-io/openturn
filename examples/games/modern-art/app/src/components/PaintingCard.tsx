import * as React from "react";

import {
  type ArtistID,
  type PaintingCard as PaintingCardData,
} from "@openturn/example-modern-art-game";

const AUCTION_LABELS = {
  double: "Double",
  fixed: "Fixed",
  hidden: "Sealed",
  oneOffer: "Once",
  open: "Open",
} as const;

const ARTIST_CLASS: Record<ArtistID, string> = {
  christinP: "artist-christin",
  karlGitter: "artist-gitter",
  krypto: "artist-krypto",
  liteMetal: "artist-lite",
  yoko: "artist-yoko",
};

interface PaintingCardProps {
  card: PaintingCardData;
  disabled?: boolean;
  onClick?: () => void;
  selected?: boolean;
}

export function PaintingCard({ card, disabled = false, onClick, selected = false }: PaintingCardProps) {
  const interactive = onClick !== undefined && !disabled;
  const body = (
    <>
      <div className={`artwork ${ARTIST_CLASS[card.artist]}`}>
        <span className="artwork-mark">{card.index}</span>
      </div>
      <div className="painting-meta">
        <span>{card.title}</span>
        <strong>{AUCTION_LABELS[card.type]}</strong>
      </div>
    </>
  );

  if (onClick === undefined) {
    return <div className={`painting-card ${selected ? "selected" : ""}`}>{body}</div>;
  }

  return (
    <button
      type="button"
      className={`painting-card button-card ${selected ? "selected" : ""}`}
      disabled={disabled}
      onClick={onClick}
    >
      {body}
    </button>
  );
}
