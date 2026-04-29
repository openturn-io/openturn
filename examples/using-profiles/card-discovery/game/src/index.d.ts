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
export declare const cardDiscoveryMatch: import("@openturn/core").MatchInput<readonly ["0", "1"], import("@openturn/core").ReplayValue>;
export type CardDiscoveryPlayerID = (typeof cardDiscoveryMatch.players)[number];
/** The five cards in the deck. Real games would have hundreds; Balatro has ~150 jokers. */
export declare const ALL_CARDS: readonly ["dragon", "slime", "knight", "wizard", "king"];
export type CardID = (typeof ALL_CARDS)[number];
export type CardDiscoveryProfile = {
    /** Cards this player has ever played, across all matches. Order = first-seen order. */
    discovered: CardID[];
};
export declare const cardDiscoveryProfile: import("@openturn/core").GameProfileConfig<CardDiscoveryProfile, import("@openturn/core").PlayerList, import("@openturn/gamekit").GamekitResultState | null>;
export interface CardDiscoveryState {
    /** Cards remaining in each player's hand, keyed by player ID. */
    hand: Record<CardDiscoveryPlayerID, readonly CardID[]>;
    over: boolean;
}
export declare const cardDiscoveryGame: import("@openturn/core").GameDefinition<import("@openturn/gamekit").GamekitState<CardDiscoveryState>, {
    play: {
        card: CardID;
    };
    forfeit: any;
}, import("@openturn/gamekit").GamekitResultState, import("@openturn/core").PlayerList, "__gamekit_finished" | "play", CardDiscoveryState, CardDiscoveryState, import("@openturn/core").ReplayValue, readonly import("@openturn/core").GameTransitionConfig<import("@openturn/gamekit").GamekitState<CardDiscoveryState>, {
    play: {
        card: CardID;
    };
    forfeit: any;
}, import("@openturn/gamekit").GamekitResultState, "__gamekit_finished" | "play", import("@openturn/core").PlayerList, import("@openturn/core").ReplayValue>[]>;
