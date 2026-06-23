import type { DeterministicRng } from "@openturn/core";

import { ALL_PAINTING_IDS } from "./data";
import {
  dealForPlayers,
  emptyArtistRecord,
  STARTING_MONEY,
  type ModernArtPlayerID,
  type PaintingID,
  type PlayerData,
  type ModernArtState,
} from "./state";

export function shuffleIDs(rng: DeterministicRng, ids: readonly string[]): string[] {
  const next = [...ids];
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = rng.int(i + 1);
    const tmp = next[i]!;
    next[i] = next[j]!;
    next[j] = tmp;
  }
  return next;
}

export function freshPlayerData(hand: PaintingID[]): PlayerData {
  return {
    money: STARTING_MONEY,
    hand,
    collection: emptyArtistRecord(),
  };
}

export function buildInitialState(
  seatedPlayers: readonly ModernArtPlayerID[],
  rng: DeterministicRng,
): ModernArtState {
  const deck = shuffleIDs(rng, ALL_PAINTING_IDS);
  const perPlayer = dealForPlayers(seatedPlayers.length);

  const players = {} as Record<ModernArtPlayerID, PlayerData>;
  let cursor = 0;
  for (const id of seatedPlayers) {
    const hand = deck.slice(cursor, cursor + perPlayer);
    cursor += perPlayer;
    players[id] = freshPlayerData(hand);
  }
  // Remaining cards stay in the deck.
  const remaining = deck.slice(cursor);

  return {
    deck: remaining,
    players,
    countsSold: emptyArtistRecord(),
    cumulativeValue: emptyArtistRecord(),
    round: 1,
    currentAuction: null,
    payoutHistory: [],
    lastAction: null,
    seatOrder: seatedPlayers,
  };
}
