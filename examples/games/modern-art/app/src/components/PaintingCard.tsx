import * as React from "react";

import {
  type ArtistID,
  type PaintingCard as PaintingCardData,
} from "@openturn/example-modern-art-game";

import { Tip } from "./ui/tip";

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
  /** Optional tutorial-tip content. When omitted the card has no tooltip. */
  tip?: React.ReactNode | null | false;
}

export function PaintingCard({ card, disabled = false, onClick, selected = false, tip }: PaintingCardProps) {
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

  const element =
    onClick === undefined ? (
      <div className={`painting-card ${selected ? "selected" : ""}`}>{body}</div>
    ) : (
      <button
        type="button"
        className={`painting-card button-card ${selected ? "selected" : ""}`}
        disabled={disabled}
        onClick={onClick}
      >
        {body}
      </button>
    );

  if (tip === undefined || tip === null || tip === false) return element;
  return <Tip content={tip}>{element}</Tip>;
}
