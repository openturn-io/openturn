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
import { defineMatch } from "@openturn/core";
import { defineGame, defineProfile, } from "@openturn/gamekit";
export const cardDiscoveryMatch = defineMatch({
    players: ["0", "1"],
});
/** The five cards in the deck. Real games would have hundreds; Balatro has ~150 jokers. */
export const ALL_CARDS = ["dragon", "slime", "knight", "wizard", "king"];
export const cardDiscoveryProfile = defineProfile({
    schemaVersion: "1",
    default: { discovered: [] },
    // No `commit` — all profile writes happen mid-match via move deltas.
});
export const cardDiscoveryGame = defineGame(cardDiscoveryMatch, {
    profile: cardDiscoveryProfile,
    setup: () => ({
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
        play: move({
            args: undefined,
            run: ({ player, profile, profiles, G, args, move: m }) => {
                const playerID = player.id;
                const hand = G.hand[playerID];
                if (!hand.includes(args.card)) {
                    return m.invalid("card_not_in_hand");
                }
                const remaining = hand.filter((c) => c !== args.card);
                const current = profiles[playerID]
                    ?? { discovered: [] };
                if (current.discovered.includes(args.card)) {
                    return m.stay({ hand: { ...G.hand, [playerID]: remaining } });
                }
                return m.stay({ hand: { ...G.hand, [playerID]: remaining } }, {
                    profile: profile.push(playerID, "discovered", args.card),
                });
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
