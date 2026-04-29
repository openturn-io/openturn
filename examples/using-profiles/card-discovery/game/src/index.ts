/**
 * Card discovery — demonstrates *mid-match* profile mutation.
 *
 * The profile's `discovered` array grows every time a player encounters a card
 * they haven't seen before. Discoveries persist even if the player quits mid-run,
 * because moves emit a `profile` delta that the engine applies and the host
 * persists per-action (not just at match end).
 *
 * Contrast with `persistent-wins`, where the only persistent write is the
 * end-of-match `profile.commit` (winner's `wins += 1`). Here the mutation
 * happens in the middle of play.
 */

import {
  defineGame,
  defineProfile,
} from "@openturn/gamekit";

const CARD_DISCOVERY_PLAYERS = ["0", "1"] as const;

export type CardDiscoveryPlayerID = (typeof CARD_DISCOVERY_PLAYERS)[number];

/** The five cards in the deck. Real games would have hundreds; Balatro has ~150 jokers. */
export const ALL_CARDS = ["dragon", "slime", "knight", "wizard", "king"] as const;
export type CardID = (typeof ALL_CARDS)[number];

export type CardDiscoveryProfile = {
  /** Cards this player has ever played, across all matches. Order = first-seen order. */
  discovered: CardID[];
};

export const cardDiscoveryProfile = defineProfile({
  schemaVersion: "1",
  default: { discovered: [] } as CardDiscoveryProfile,
  // No `commit` — all profile writes happen mid-match via move deltas.
});

export interface CardDiscoveryState {
  /** Cards remaining in each player's hand, keyed by player ID. */
  hand: Record<CardDiscoveryPlayerID, readonly CardID[]>;
  over: boolean;
}

export const cardDiscoveryGame = defineGame({
  playerIDs: CARD_DISCOVERY_PLAYERS,
  profile: cardDiscoveryProfile,
  setup: (): CardDiscoveryState => ({
    hand: {
      "0": [...ALL_CARDS],
      "1": [...ALL_CARDS],
    },
    over: false,
  }),
  moves: ({ move }) => ({
    /**
     * Play a specific card. If the player has never seen this card across any
     * match, push it into their persistent `discovered` list via a draft-based
     * profile delta.
     */
    play: move<{ card: CardID }>({
      run: ({ player, profile, profiles, G, args, move: m }) => {
        const playerID = player.id as CardDiscoveryPlayerID;
        const hand = G.hand[playerID];
        if (!hand.includes(args.card)) {
          return m.invalid("card_not_in_hand");
        }
        const remaining = hand.filter((c) => c !== args.card);
        const current = profiles[playerID] as CardDiscoveryProfile | undefined
          ?? { discovered: [] };
        if (current.discovered.includes(args.card)) {
          return m.stay({ hand: { ...G.hand, [playerID]: remaining } });
        }
        return m.stay(
          { hand: { ...G.hand, [playerID]: remaining } },
          {
            profile: profile.push(playerID, "discovered", args.card),
          },
        );
      },
    }),
    /** Forfeit (used only to mark the match over). */
    forfeit: move({
      run: ({ player, move: m }) => m.finish({ winner: player.id === "0" ? "1" : "0" }, { over: true }),
    }),
  }),
  phases: {
    play: {
      activePlayers: ({ turn }) => [...turn.players],
      label: "Play any card to discover it",
    },
  },
});
