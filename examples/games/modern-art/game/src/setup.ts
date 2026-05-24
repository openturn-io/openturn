import { type DeterministicRng } from "@openturn/core";

import { CARDS } from "./data";
import {
  ARTISTS,
  type ArtistID,
  type ModernArtPlayerID,
  type ModernArtState,
  type PaintingCard,
  type PlayerState,
  emptyArtistRecord,
  emptyPlayerRecord,
} from "./state";

export const STARTING_MONEY = 100;
export const ROUND_DEALS: Record<number, readonly number[]> = {
  3: [10, 6, 6, 0],
  4: [9, 4, 4, 0],
  5: [8, 3, 3, 0],
};

export function shuffleCards(cards: readonly PaintingCard[], rng: DeterministicRng): string[] {
  const out = cards.map((card) => card.id);
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = rng.int(i + 1);
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
}

export function buildInitialState(
  seatOrder: readonly ModernArtPlayerID[],
  rng: DeterministicRng,
): ModernArtState {
  const players = emptyPlayerRecord<PlayerState>({ gallery: [], hand: [], money: STARTING_MONEY });
  let deck = shuffleCards(CARDS, rng);
  const dealCount = ROUND_DEALS[seatOrder.length]?.[0] ?? 0;

  for (const id of seatOrder) {
    const hand = deck.slice(0, dealCount);
    deck = deck.slice(dealCount);
    players[id] = { gallery: [], hand, money: STARTING_MONEY };
  }

  return {
    deck,
    hammer: seatOrder[0]!,
    lastAction: null,
    lot: null,
    offeredCounts: emptyArtistRecord(0),
    players,
    revealedMoney: null,
    round: 1,
    roundSummary: null,
    seatOrder,
    valueTiles: ARTISTS.reduce((acc, artist) => {
      acc[artist] = [];
      return acc;
    }, {} as Record<ArtistID, readonly number[]>),
    winners: [],
  };
}
