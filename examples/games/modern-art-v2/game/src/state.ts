// Modern Art — Reiner Knizia's auction game for 3–5 players.
//
// The max seat pool is 5. `defineGame` slices the seated players from this set
// inside `setup`. 70 paintings span 5 artists with a deliberately uneven
// rarity curve so ranking is non-trivial.

export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 5;
export type ModernArtPlayerID = "0" | "1" | "2" | "3" | "4";

// Artists are listed in ascending rarity (most cards → least cards). This
// ordering is the official tiebreaker when two artists sell the same number of
// paintings in a round: the rarer artist (later in this list) ranks higher.
export const ARTISTS = ["krypto", "karlGitter", "cristinP", "yoko", "liteMetal"] as const;
export type Artist = (typeof ARTISTS)[number];

// Rarity used for the round-end tiebreaker. Lower index in ARTISTS = more
// common. The rules break ties in favor of the *rarer* artist, so we sort
// candidates by (count desc, rarity asc) where rarity asc = ARTISTS index desc.
export const ARTIST_TOTAL_CARDS: Record<Artist, number> = {
  krypto: 16,
  karlGitter: 15,
  cristinP: 14,
  yoko: 13,
  liteMetal: 12,
};

export const AUCTION_TYPES = ["open", "sealed", "once", "fixed", "double"] as const;
export type AuctionType = (typeof AUCTION_TYPES)[number];

export const STARTING_MONEY = 100;
export const TOTAL_ROUNDS = 4;
export const ROUND_END_THRESHOLD = 5; // 5th painting "put up" ends the round.
export const PAYOUT_TOP_3 = [30, 20, 10] as const;

export type PaintingID = string;

export interface Painting {
  id: PaintingID;
  artist: Artist;
  auction: AuctionType;
}

// ---------------------------------------------------------------------------
// Per-player data
// ---------------------------------------------------------------------------

export interface PlayerData {
  money: number;
  /** Hand of unplayed painting cards. */
  hand: readonly PaintingID[];
  /** Paintings owned (bought at auction or kept as auctioneer). Per-artist counts. */
  collection: Record<Artist, number>;
}

// ---------------------------------------------------------------------------
// Auction sub-state — lives inside G while an auction is in flight.
// ---------------------------------------------------------------------------

export type AuctionPhase =
  | "bidding" // open / once-around: players are still raising
  | "sealed" // sealed bids being collected
  | "fixed"; // fixed-price: auctioneer's price set, buyers decide in turn

export interface AuctionState {
  /** The artist being sold. */
  artist: Artist;
  /** The effective auction type. For a double auction this is the 2nd card's symbol. */
  type: Exclude<AuctionType, "double">;
  /** The player who played the card(s) — receives payment if someone else wins. */
  auctioneer: ModernArtPlayerID;
  /** Painting IDs being sold (1 normally; 2 when a double auction pairs them). */
  paintings: readonly PaintingID[];
  /** Current highest bid. 0 means "no bid yet". */
  highBid: number;
  /** Seat holding the high bid (or null if no bid). The winner if nobody raises. */
  highBidder: ModernArtPlayerID | null;
  /** Fixed price set by the auctioneer (fixed-price auctions only). */
  fixedPrice: number | null;
  /** Sealed bids collected so far: Record<playerID, amount>. Hidden from public view. */
  sealedBids: Record<ModernArtPlayerID, number | null>;
  /**
   * Players who have not yet acted in the current auction, in the order they
   * must act. For once-around / fixed / sealed this is the full ring; for open
   * it shrinks as players pass.
   */
  pendingBidders: readonly ModernArtPlayerID[];
  /** For once-around / open: seats that have permanently passed this auction. */
  passed: readonly ModernArtPlayerID[];
}

// ---------------------------------------------------------------------------
// Action log — describes the last thing that happened, for the banner.
// ---------------------------------------------------------------------------

export type ActionLogKind =
  | "startAuction"
  | "startDouble"
  | "bid"
  | "pass"
  | "seal"
  | "buyFixed"
  | "declineFixed"
  | "noBids"
  | "won"
  | "roundScored";

export interface ActionLog {
  kind: ActionLogKind;
  player: ModernArtPlayerID;
  detail: string;
  turn: number;
}

// ---------------------------------------------------------------------------
// Authoritative state
// ---------------------------------------------------------------------------

export interface ModernArtState {
  /** Paintings left in the deck, face-down. */
  deck: readonly PaintingID[];
  /** Per-player private hands + money + collection. */
  players: Record<ModernArtPlayerID, PlayerData>;
  /** Number of each artist's paintings sold (auctioned off) this round. */
  countsSold: Record<Artist, number>;
  /** Cumulative payout value per artist, carried across rounds (0 until ranked once). */
  cumulativeValue: Record<Artist, number>;
  /** Current round, 1-indexed. */
  round: number;
  /** In-flight auction, or null when a new card is needed from the auctioneer. */
  currentAuction: AuctionState | null;
  /** History of payout values per round, per artist — for the scoring reveal. */
  payoutHistory: readonly PayoutRow[];
  lastAction: ActionLog | null;
  seatOrder: readonly ModernArtPlayerID[];
}

export interface PayoutRow {
  round: number;
  /** Per-artist payout value awarded this round (cumulative). */
  values: Record<Artist, number>;
}

// ---------------------------------------------------------------------------
// View shapes
// ---------------------------------------------------------------------------

export interface PublicPlayerData {
  playerID: ModernArtPlayerID;
  money: number;
  collection: Record<Artist, number>;
  handSize: number;
}

export interface ModernArtPublicView {
  myPlayerID: ModernArtPlayerID | null;
  currentTurn: ModernArtPlayerID | null;
  winner: ModernArtPlayerID | null;
  round: number;
  totalRounds: number;
  deckSize: number;
  countsSold: Record<Artist, number>;
  cumulativeValue: Record<Artist, number>;
  /** Auctioneer and high-bid info visible to everyone. Sealed bid amounts hidden. */
  auction: PublicAuctionView | null;
  players: Record<ModernArtPlayerID, PublicPlayerData>;
  seatOrder: readonly ModernArtPlayerID[];
  lastAction: ActionLog | null;
  /** Round-end payout for the just-completed round (revealed), else null. */
  lastPayout: PayoutRow | null;
}

export interface ModernArtPlayerView extends ModernArtPublicView {
  /** Only the viewing player sees their own hand + own sealed bid. */
  myHand: readonly PaintingID[];
  mySealedBid: number | null;
}

export interface PublicAuctionView {
  artist: Artist;
  type: Exclude<AuctionType, "double">;
  auctioneer: ModernArtPlayerID;
  paintings: readonly PaintingID[];
  highBid: number;
  highBidder: ModernArtPlayerID | null;
  fixedPrice: number | null;
  pendingBidders: readonly ModernArtPlayerID[];
  passed: readonly ModernArtPlayerID[];
  /** In a sealed auction, who has submitted (no amounts). */
  sealedSubmitted: readonly ModernArtPlayerID[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function emptyArtistRecord(): Record<Artist, number> {
  return { krypto: 0, karlGitter: 0, cristinP: 0, yoko: 0, liteMetal: 0 };
}

export function dealForPlayers(playerCount: number): number {
  if (playerCount <= 3) return 10;
  if (playerCount === 4) return 9;
  return 8;
}
