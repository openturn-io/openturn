import * as React from "react";

import { type PaintingCard as PaintingCardData } from "@openturn/example-modern-art-game";

import { Artwork } from "./Artwork";
import { AuctionTypeIcon } from "./icons";
import { Tip } from "./ui/tip";
import { ARTIST_CLASS, ARTIST_NAME, AUCTION_NAME } from "../lib/format";

export type PaintingSize = "sm" | "md" | "lg";

interface PaintingCardProps {
  card: PaintingCardData;
  disabled?: boolean;
  /** Adds a gold "playable" shimmer on top of the enabled state. */
  highlight?: boolean;
  onClick?: () => void;
  selected?: boolean;
  size?: PaintingSize;
  /** Optional tutorial-tip content. When omitted the card has no tooltip. */
  tip?: React.ReactNode | null | false;
}

export function PaintingCard({
  card,
  disabled = false,
  highlight = false,
  onClick,
  selected = false,
  size = "md",
  tip,
}: PaintingCardProps) {
  const classes = [
    "painting-card",
    `painting-${size}`,
    ARTIST_CLASS[card.artist],
    selected ? "is-selected" : "",
    highlight ? "is-playable" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const body = (
    <>
      <span className="painting-frame" aria-hidden />
      <span className="painting-canvas">
        <Artwork card={card} />
        <span className="painting-type-badge" title={AUCTION_NAME[card.type]}>
          <AuctionTypeIcon type={card.type} />
        </span>
      </span>
      <span className="painting-plate">
        <span className="painting-title">{card.title}</span>
        <span className="painting-artist">
          <i className="artist-dot" aria-hidden />
          {ARTIST_NAME[card.artist]}
          <em className="painting-type-name">{AUCTION_NAME[card.type]}</em>
        </span>
      </span>
    </>
  );

  const element =
    onClick === undefined ? (
      <div className={classes}>{body}</div>
    ) : (
      <button className={`${classes} is-button`} disabled={disabled} onClick={onClick} type="button">
        {body}
      </button>
    );

  if (tip === undefined || tip === null || tip === false) return element;
  return <Tip content={tip}>{element}</Tip>;
}

/** Face-down card back, used for opponents' sealed decisions / deck. */
export function CardBack({ size = "sm" }: { size?: PaintingSize }) {
  return (
    <div aria-hidden className={`painting-card painting-${size} card-back`}>
      <span className="painting-frame" />
      <span className="painting-canvas card-back-canvas">
        <span className="card-back-monogram">MA</span>
      </span>
    </div>
  );
}
