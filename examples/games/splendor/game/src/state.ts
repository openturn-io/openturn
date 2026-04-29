// 2–4 player game; max is 4. The game's full player pool is generated from
// this max via `definePlayerIDs(MAX_PLAYERS)` in [./index.ts](./index.ts).
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 4;
export type SplendorPlayerID = "0" | "1" | "2" | "3";

export const GEM_COLORS = ["white", "blue", "green", "red", "black"] as const;
export type GemColor = (typeof GEM_COLORS)[number];

export const CHIP_COLORS = ["white", "blue", "green", "red", "black", "gold"] as const;
export type ChipColor = (typeof CHIP_COLORS)[number];

export type Tier = 1 | 2 | 3;

export type CardID = string;
export type NobleID = string;

export interface Card {
  id: CardID;
  tier: Tier;
  bonus: GemColor;
  prestige: number;
  cost: GemBag;
}

export interface Noble {
  id: NobleID;
  name: string;
  prestige: number;
  requires: GemBag;
}

export type GemBag = Partial<Record<GemColor, number>>;
export type ChipBag = Partial<Record<ChipColor, number>>;

export interface PlayerData {
  chips: Record<ChipColor, number>;
  bonuses: Record<GemColor, number>;
  reserved: readonly CardID[];
  nobles: readonly NobleID[];
  score: number;
  mustDiscard: number;
}

export type MarketRow = readonly (CardID | null)[];

export interface MarketState {
  tier1: MarketRow;
  tier2: MarketRow;
  tier3: MarketRow;
}

export interface DeckState {
  tier1: readonly CardID[];
  tier2: readonly CardID[];
  tier3: readonly CardID[];
}

export type ActionLogKind =
  | "takeThree"
  | "takeTwo"
  | "reserveMarket"
  | "reserveDeck"
  | "buyMarket"
  | "buyReserved"
  | "discard"
  | "claimNoble";

export interface ActionLog {
  kind: ActionLogKind;
  player: SplendorPlayerID;
  detail: string;
  turn: number;
}

export interface SplendorState {
  bank: Record<ChipColor, number>;
  decks: DeckState;
  market: MarketState;
  nobles: readonly NobleID[];
  players: Record<SplendorPlayerID, PlayerData>;
  /** First player to reach the win threshold; once set, the round is played out. */
  lastRoundTrigger: SplendorPlayerID | null;
  lastAction: ActionLog | null;
  /** Seated players, in turn order. */
  seatOrder: readonly SplendorPlayerID[];
}

export const WIN_PRESTIGE = 15;
export const CHIP_CAP = 10;
export const TAKE_TWO_MIN_PILE = 4;
export const RESERVE_LIMIT = 3;
export const MARKET_SLOTS = 4;

export function bankInitForPlayers(playerCount: number): number {
  if (playerCount <= 2) return 4;
  if (playerCount === 3) return 5;
  return 7;
}

export function nobleCountForPlayers(playerCount: number): number {
  return playerCount + 1;
}

export function emptyChipRecord(): Record<ChipColor, number> {
  return { white: 0, blue: 0, green: 0, red: 0, black: 0, gold: 0 };
}

export function emptyBonusRecord(): Record<GemColor, number> {
  return { white: 0, blue: 0, green: 0, red: 0, black: 0 };
}

// ---- View shapes (returned by views.player) ---------------------------------

export interface PublicPlayerData {
  playerID: SplendorPlayerID;
  chips: Record<ChipColor, number>;
  bonuses: Record<GemColor, number>;
  reservedCount: number;
  nobles: readonly NobleID[];
  score: number;
  mustDiscard: number;
  /** Only populated for the viewing player; opponents see []. */
  reservedCards: readonly CardID[];
}

export interface SplendorPlayerView {
  myPlayerID: SplendorPlayerID | null;
  currentTurn: SplendorPlayerID | null;
  winner: SplendorPlayerID | null;
  isFinalRound: boolean;
  bank: Record<ChipColor, number>;
  market: MarketState;
  deckCounts: { tier1: number; tier2: number; tier3: number };
  nobles: readonly NobleID[];
  players: Record<SplendorPlayerID, PublicPlayerData>;
  seatOrder: readonly SplendorPlayerID[];
  lastAction: ActionLog | null;
}
