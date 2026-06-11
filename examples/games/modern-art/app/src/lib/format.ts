import {
  type ArtistID,
  type AuctionType,
  type ModernArtPlayerID,
} from "@openturn/example-modern-art-game";

/**
 * Seat labels. Must stay "Curator N" — the game engine writes action-log
 * strings (G.lastAction.detail) with playerLabel(), which uses the same
 * naming, so any divergence makes the log contradict the table.
 */
export function curatorName(id: ModernArtPlayerID): string {
  return `Curator ${Number.parseInt(id, 10) + 1}`;
}

export function curatorShort(id: ModernArtPlayerID): string {
  return `C${Number.parseInt(id, 10) + 1}`;
}

export function money(amount: number): string {
  return `$${amount}`;
}

export const AUCTION_NAME: Record<AuctionType, string> = {
  double: "Double",
  fixed: "Fixed price",
  hidden: "Sealed bid",
  oneOffer: "One offer",
  open: "Open",
};

export const AUCTION_SUMMARY: Record<AuctionType, string> = {
  double: "Pairs with a second painting by the same artist, then sells by that card's auction.",
  fixed: "The auctioneer names a price; each player in turn buys or passes.",
  hidden: "Everyone seals one secret bid; the highest wins, ties go clockwise.",
  oneOffer: "One bid each around the table; every offer must beat the last.",
  open: "Free-for-all raises until all but one bidder pass.",
};

export const ARTIST_NAME: Record<ArtistID, string> = {
  christinP: "Christin P.",
  karlGitter: "Karl Gitter",
  krypto: "Krypto",
  liteMetal: "Lite Metal",
  yoko: "Yoko",
};

/** Static artist→class mapping so components never need inline color styles. */
export const ARTIST_CLASS: Record<ArtistID, string> = {
  christinP: "artist-christin",
  karlGitter: "artist-gitter",
  krypto: "artist-krypto",
  liteMetal: "artist-lite",
  yoko: "artist-yoko",
};

export const PHASE_LABEL: Record<string, string> = {
  doubleOffer: "Double offer",
  fixedPriceOffer: "Fixed price — buy or pass",
  fixedPriceSet: "Setting the price",
  hiddenAuction: "Sealed-bid auction",
  oneOfferAuction: "One-offer auction",
  openAuction: "Open auction",
  selectPainting: "Choosing a painting",
};
