import type { DeterministicRng } from "@openturn/core";

import { NOBLES, TIER_1_CARDS, TIER_2_CARDS, TIER_3_CARDS } from "./data";
import {
  bankInitForPlayers,
  emptyBonusRecord,
  emptyChipRecord,
  MARKET_SLOTS,
  nobleCountForPlayers,
  type ChipColor,
  type MarketRow,
  type PlayerData,
  type SplendorPlayerID,
  type SplendorState,
} from "./state";

export function shuffleIDs(rng: DeterministicRng, ids: readonly string[]): string[] {
  const next = [...ids];
  for (let i = next.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    const tmp = next[i]!;
    next[i] = next[j]!;
    next[j] = tmp;
  }
  return next;
}

export function freshPlayerData(): PlayerData {
  return {
    chips: emptyChipRecord(),
    bonuses: emptyBonusRecord(),
    reserved: [],
    nobles: [],
    score: 0,
    mustDiscard: 0,
  };
}

export function dealMarketRow(deck: string[], slots = MARKET_SLOTS): MarketRow {
  const out: (string | null)[] = [];
  for (let i = 0; i < slots; i++) {
    out.push(deck.shift() ?? null);
  }
  return out;
}

export function buildInitialState(
  seatedPlayers: readonly SplendorPlayerID[],
  rng: DeterministicRng,
): SplendorState {
  const playerCount = seatedPlayers.length;
  const initBank = bankInitForPlayers(playerCount);
  const bank: Record<ChipColor, number> = {
    white: initBank,
    blue: initBank,
    green: initBank,
    red: initBank,
    black: initBank,
    gold: 5,
  };

  const tier1Deck = shuffleIDs(rng, TIER_1_CARDS.map((c) => c.id));
  const tier2Deck = shuffleIDs(rng, TIER_2_CARDS.map((c) => c.id));
  const tier3Deck = shuffleIDs(rng, TIER_3_CARDS.map((c) => c.id));
  const noblePool = shuffleIDs(rng, NOBLES.map((n) => n.id));

  const market = {
    tier1: dealMarketRow(tier1Deck),
    tier2: dealMarketRow(tier2Deck),
    tier3: dealMarketRow(tier3Deck),
  };

  const nobles = noblePool.slice(0, nobleCountForPlayers(playerCount));

  const players = {} as Record<SplendorPlayerID, PlayerData>;
  for (const id of seatedPlayers) {
    players[id] = freshPlayerData();
  }

  return {
    bank,
    decks: { tier1: tier1Deck, tier2: tier2Deck, tier3: tier3Deck },
    market,
    nobles,
    players,
    lastRoundTrigger: null,
    lastAction: null,
    seatOrder: seatedPlayers,
  };
}
