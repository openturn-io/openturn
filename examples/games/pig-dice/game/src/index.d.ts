import { type PlayerID, type PlayerRecord } from "@openturn/core";
export declare const PIG_DICE_TARGET_SCORE = 20;
export interface PigDiceState {
    lastRoll: number | null;
    scores: PlayerRecord<typeof pigDiceMatch.players, number>;
    turnTotal: number;
}
export interface PigDicePublicView {
    currentPlayer: PlayerID;
    lastRoll: number | null;
    scores: PlayerRecord<typeof pigDiceMatch.players, number>;
    turnTotal: number;
}
export declare const pigDiceMatch: import("@openturn/core").MatchInput<readonly ["0", "1"], import("@openturn/core").ReplayValue>;
export declare const pigDice: import("@openturn/core").GameDefinition<import("@openturn/gamekit").GamekitState<PigDiceState>, {
    hold: any;
    roll: {
        value: number;
    };
}, import("@openturn/gamekit").GamekitResultState, readonly ["0", "1"], "__gamekit_finished" | "play", PigDicePublicView, PigDicePublicView, import("@openturn/core").ReplayValue, readonly import("@openturn/core").GameTransitionConfig<import("@openturn/gamekit").GamekitState<PigDiceState>, {
    hold: any;
    roll: {
        value: number;
    };
}, import("@openturn/gamekit").GamekitResultState, "__gamekit_finished" | "play", readonly ["0", "1"], import("@openturn/core").ReplayValue>[]>;
