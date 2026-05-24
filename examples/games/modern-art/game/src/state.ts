export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 5;
export const PLAYER_IDS = ["0", "1", "2", "3", "4"] as const;
export type ModernArtPlayerID = (typeof PLAYER_IDS)[number];

export const ARTISTS = ["liteMetal", "yoko", "christinP", "karlGitter", "krypto"] as const;
export type ArtistID = (typeof ARTISTS)[number];

export const AUCTION_TYPES = ["open", "oneOffer", "hidden", "fixed", "double"] as const;
export type AuctionType = (typeof AUCTION_TYPES)[number];

export interface Artist {
  id: ArtistID;
  name: string;
  shortName: string;
  color: string;
}

export interface PaintingCard {
  id: string;
  artist: ArtistID;
  type: AuctionType;
  title: string;
  index: number;
}

export interface PlayerState {
  gallery: readonly string[];
  hand: readonly string[];
  money: number;
}

export interface Bid {
  player: ModernArtPlayerID;
  amount: number;
}

export interface AuctionLot {
  cards: readonly string[];
  originalAuctioneer: ModernArtPlayerID;
  auctioneer: ModernArtPlayerID;
  type: Exclude<AuctionType, "double">;
  highBid: Bid | null;
  passed: Partial<Record<ModernArtPlayerID, boolean>>;
  oneOfferOrder: readonly ModernArtPlayerID[];
  oneOfferIndex: number;
  fixedPrice: number | null;
  fixedOfferOrder: readonly ModernArtPlayerID[];
  fixedOfferIndex: number;
  hiddenBids: Partial<Record<ModernArtPlayerID, number>>;
  doubleOfferOrder: readonly ModernArtPlayerID[];
  doubleOfferIndex: number;
}

export type PhaseName =
  | "selectPainting"
  | "doubleOffer"
  | "openAuction"
  | "oneOfferAuction"
  | "hiddenAuction"
  | "fixedPriceSet"
  | "fixedPriceOffer";

export interface RoundSummary {
  round: number;
  counts: Record<ArtistID, number>;
  rankedArtists: readonly ArtistID[];
  values: Record<ArtistID, number>;
  payouts: Record<ModernArtPlayerID, number>;
}

export interface ActionLog {
  detail: string;
  kind:
    | "auction"
    | "bid"
    | "double"
    | "fixed"
    | "hidden"
    | "pass"
    | "payout"
    | "play"
    | "sale";
  player: ModernArtPlayerID | null;
  round: number;
}

export interface ModernArtState {
  deck: readonly string[];
  hammer: ModernArtPlayerID;
  lastAction: ActionLog | null;
  lot: AuctionLot | null;
  offeredCounts: Record<ArtistID, number>;
  players: Record<ModernArtPlayerID, PlayerState>;
  revealedMoney: Record<ModernArtPlayerID, number> | null;
  round: number;
  roundSummary: RoundSummary | null;
  seatOrder: readonly ModernArtPlayerID[];
  valueTiles: Record<ArtistID, readonly number[]>;
  winners: readonly ModernArtPlayerID[];
}

export interface PublicPlayerData {
  gallery: readonly string[];
  handCount: number;
  money: number | null;
  playerID: ModernArtPlayerID;
}

export interface PublicAuctionLot {
  auctioneer: ModernArtPlayerID;
  cards: readonly string[];
  fixedOfferIndex: number;
  fixedOfferOrder: readonly ModernArtPlayerID[];
  fixedPrice: number | null;
  highBid: Bid | null;
  hiddenBidPlayers: readonly ModernArtPlayerID[];
  oneOfferIndex: number;
  oneOfferOrder: readonly ModernArtPlayerID[];
  originalAuctioneer: ModernArtPlayerID;
  passed: Partial<Record<ModernArtPlayerID, boolean>>;
  type: Exclude<AuctionType, "double">;
}

export interface ModernArtPlayerView {
  activePlayers: readonly ModernArtPlayerID[];
  artists: readonly Artist[];
  cards: Record<string, PaintingCard>;
  deckCount: number;
  hammer: ModernArtPlayerID;
  lastAction: ActionLog | null;
  lot: PublicAuctionLot | null;
  myHand: readonly string[];
  myHiddenBid: number | null;
  myMoney: number | null;
  myPlayerID: ModernArtPlayerID | null;
  offeredCounts: Record<ArtistID, number>;
  phase: PhaseName;
  players: Record<ModernArtPlayerID, PublicPlayerData>;
  revealedMoney: Record<ModernArtPlayerID, number> | null;
  round: number;
  roundSummary: RoundSummary | null;
  seatOrder: readonly ModernArtPlayerID[];
  valueTiles: Record<ArtistID, readonly number[]>;
  winners: readonly ModernArtPlayerID[];
}

export function emptyArtistRecord<T>(value: T): Record<ArtistID, T> {
  return {
    christinP: value,
    karlGitter: value,
    krypto: value,
    liteMetal: value,
    yoko: value,
  };
}

export function emptyPlayerRecord<T>(value: T): Record<ModernArtPlayerID, T> {
  return {
    "0": value,
    "1": value,
    "2": value,
    "3": value,
    "4": value,
  };
}
