import { type PlayerID, type PlayerRecord, type ReplayValue } from "@openturn/core";
export type PaperScissorsRockChoice = "paper" | "scissors" | "rock";
export interface PaperScissorsRockRoundOutcome {
    kind: "draw" | "pending" | "win";
    round: number;
    submittedPlayers: readonly PlayerID[];
    winners: readonly PlayerID[];
    winningChoice: PaperScissorsRockChoice | null;
}
export interface PaperScissorsRockState {
    lastOutcome: PaperScissorsRockRoundOutcome;
    lastRevealed: PlayerRecord<typeof PLAYERS, PaperScissorsRockChoice | null>;
    round: number;
    scores: PlayerRecord<typeof PLAYERS, number>;
    submissions: PlayerRecord<typeof PLAYERS, PaperScissorsRockChoice | null>;
}
export interface PaperScissorsRockPlayerView {
    lastOutcome: PaperScissorsRockRoundOutcome;
    lastRevealed: PlayerRecord<typeof PLAYERS, PaperScissorsRockChoice | null>;
    mySubmission: PaperScissorsRockChoice | null;
    round: number;
    scores: PlayerRecord<typeof PLAYERS, number>;
}
export interface PaperScissorsRockPublicView {
    lastOutcome: PaperScissorsRockRoundOutcome;
    lastRevealed: PlayerRecord<typeof PLAYERS, PaperScissorsRockChoice | null>;
    round: number;
    scores: PlayerRecord<typeof PLAYERS, number>;
    submittedCount: number;
}
declare const PLAYERS: readonly ["0", "1", "2"];
export declare const paperScissorsRockMatch: import("@openturn/core").MatchInput<readonly ["0", "1", "2"], ReplayValue>;
export declare const paperScissorsRock: import("@openturn/core").GameDefinition<import("@openturn/gamekit").GamekitState<PaperScissorsRockState>, {
    submitChoice: "paper" | "scissors" | "rock";
}, import("@openturn/gamekit").GamekitResultState, readonly ["0", "1", "2"], "__gamekit_finished" | "plan", PaperScissorsRockPublicView, PaperScissorsRockPlayerView, ReplayValue, readonly import("@openturn/core").GameTransitionConfig<import("@openturn/gamekit").GamekitState<PaperScissorsRockState>, {
    submitChoice: "paper" | "scissors" | "rock";
}, import("@openturn/gamekit").GamekitResultState, "__gamekit_finished" | "plan", readonly ["0", "1", "2"], ReplayValue>[]>;
export {};
