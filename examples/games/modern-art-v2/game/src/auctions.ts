import type { AuctionType, ModernArtPlayerID } from "./state";

/**
 * The bidding order for an auction: clockwise starting from the player to the
 * auctioneer's left. The auctioneer is the last seat in the ring (and, for
 * open auctions, can re-enter after every opponent has passed).
 */
export function biddingRing(
  seatOrder: readonly ModernArtPlayerID[],
  auctioneer: ModernArtPlayerID,
): ModernArtPlayerID[] {
  const idx = seatOrder.indexOf(auctioneer);
  if (idx === -1) return [...seatOrder];
  const out: ModernArtPlayerID[] = [];
  for (let i = 1; i <= seatOrder.length; i += 1) {
    out.push(seatOrder[(idx + i) % seatOrder.length]!);
  }
  return out;
}

/**
 * Resolve the effective auction type when a card is played. A "double" card
 * pairs with a second card of the same artist; the SECOND card's symbol
 * governs the auction (and may not itself be "double"). If the second card is
 * missing or also double, the auction defaults to open.
 */
export function resolveDouble(
  first: AuctionType,
  second: AuctionType | null,
): { effective: Exclude<AuctionType, "double">; paired: boolean } {
  if (first !== "double") {
    return { effective: first as Exclude<AuctionType, "double">, paired: false };
  }
  // Double auction: must be paired. If no valid second card, fall back to open.
  if (second === null || second === "double") {
    return { effective: "open", paired: false };
  }
  return { effective: second as Exclude<AuctionType, "double">, paired: true };
}

/** True if `amount` is a legal bid: positive integer the bidder can afford. */
export function isValidBid(amount: number, money: number): boolean {
  return Number.isInteger(amount) && amount > 0 && amount <= money;
}

/** True if `amount` legally raises the current high bid. */
export function isValidRaise(amount: number, highBid: number, money: number): boolean {
  return isValidBid(amount, money) && amount > highBid;
}
