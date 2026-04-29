import { type PlayerRecord, type ReplayValue } from "@openturn/core";
export type PaperScissorsRockChoice = "paper" | "scissors" | "rock";
export interface PaperScissorsRockRoundOutcome extends Record<string, ReplayValue> {
    kind: "draw" | "pending" | "win";
    round: number;
    submittedPlayers: readonly PaperScissorsRockPlayers[number][];
    winners: readonly PaperScissorsRockPlayers[number][];
    winningChoice: PaperScissorsRockChoice | null;
}
export interface PaperScissorsRockState extends Record<string, ReplayValue> {
    lastOutcome: PaperScissorsRockRoundOutcome;
    lastRevealed: PlayerRecord<typeof PLAYERS, PaperScissorsRockChoice | null>;
    round: number;
    scores: PlayerRecord<typeof PLAYERS, number>;
    submissions: PlayerRecord<typeof PLAYERS, PaperScissorsRockChoice | null>;
}
export interface PaperScissorsRockPlayerView extends Record<string, ReplayValue> {
    lastOutcome: PaperScissorsRockRoundOutcome;
    lastRevealed: PlayerRecord<typeof PLAYERS, PaperScissorsRockChoice | null>;
    mySubmission: PaperScissorsRockChoice | null;
    round: number;
    scores: PlayerRecord<typeof PLAYERS, number>;
}
export interface PaperScissorsRockPublicView extends Record<string, ReplayValue> {
    lastOutcome: PaperScissorsRockRoundOutcome;
    lastRevealed: PlayerRecord<typeof PLAYERS, PaperScissorsRockChoice | null>;
    round: number;
    scores: PlayerRecord<typeof PLAYERS, number>;
    submittedCount: number;
}
declare const PLAYERS: readonly ["0", "1", "2"];
type PaperScissorsRockPlayers = typeof PLAYERS;
export declare const paperScissorsRockMatch: import("@openturn/core").MatchInput<readonly ["0", "1", "2"], ReplayValue>;
export declare const paperScissorsRock: import("@openturn/core").GameDefinition<PaperScissorsRockState, {
    submitChoice: PaperScissorsRockChoice;
}, ReplayValue, readonly ["0", "1", "2"], string, PaperScissorsRockPublicView, PaperScissorsRockPlayerView, ReplayValue, ({
    event: "submitChoice";
    from: "plan";
    label: string;
    resolve: ({ G, event, playerID }: import("@openturn/core").GameEventContext<PaperScissorsRockState, {
        submitChoice: PaperScissorsRockChoice;
    }, string, readonly ["0", "1", "2"], any, "submitChoice">) => {
        G: {
            submissions: {
                0: PaperScissorsRockChoice | null;
                1: PaperScissorsRockChoice | null;
                2: PaperScissorsRockChoice | null;
            };
            lastOutcome: {
                readonly [x: string]: string | number | boolean | readonly (string | number | boolean | readonly (string | number | boolean | readonly (string | number | boolean | readonly (string | number | boolean | readonly (string | number | boolean | readonly (string | number | boolean | readonly (string | number | boolean | readonly (string | number | boolean | readonly (string | number | boolean | readonly (string | number | boolean | readonly (string | number | boolean | /*elided*/ any | {
                    readonly [x: string]: string | number | boolean | /*elided*/ any | /*elided*/ any | null;
                } | null)[] | {
                    readonly [x: string]: string | number | boolean | readonly (string | number | boolean | /*elided*/ any | /*elided*/ any | null)[] | /*elided*/ any | null;
                } | null)[] | {
                    readonly [x: string]: string | number | boolean | readonly (string | number | boolean | readonly (string | number | boolean | /*elided*/ any | /*elided*/ any | null)[] | /*elided*/ any | null)[] | /*elided*/ any | null;
                } | null)[] | {
                    readonly [x: string]: string | number | boolean | readonly (string | number | boolean | readonly (string | number | boolean | readonly (string | number | boolean | /*elided*/ any | /*elided*/ any | null)[] | /*elided*/ any | null)[] | /*elided*/ any | null)[] | /*elided*/ any | null;
                } | null)[] | {
                    readonly [x: string]: string | number | boolean | readonly (string | number | boolean | readonly (string | number | boolean | readonly (string | number | boolean | readonly (string | number | boolean | /*elided*/ any | /*elided*/ any | null)[] | /*elided*/ any | null)[] | /*elided*/ any | null)[] | /*elided*/ any | null)[] | /*elided*/ any | null;
                } | null)[] | {
                    readonly [x: string]: string | number | boolean | readonly (string | number | boolean | readonly (string | number | boolean | readonly (string | number | boolean | readonly (string | number | boolean | readonly (string | number | boolean | /*elided*/ any | /*elided*/ any | null)[] | /*elided*/ any | null)[] | /*elided*/ any | null)[] | /*elided*/ any | null)[] | /*elided*/ any | null)[] | /*elided*/ any | null;
                } | null)[] | {
                    readonly [x: string]: string | number | boolean | readonly (string | number | boolean | readonly (string | number | boolean | readonly (string | number | boolean | readonly (string | number | boolean | readonly (string | number | boolean | readonly (string | number | boolean | /*elided*/ any | /*elided*/ any | null)[] | /*elided*/ any | null)[] | /*elided*/ any | null)[] | /*elided*/ any | null)[] | /*elided*/ any | null)[] | /*elided*/ any | null)[] | /*elided*/ any | null;
                } | null)[] | {
                    readonly [x: string]: string | number | boolean | readonly (string | number | boolean | readonly (string | number | boolean | readonly (string | number | boolean | readonly (string | number | boolean | readonly (string | number | boolean | readonly (string | number | boolean | readonly (string | number | boolean | /*elided*/ any | /*elided*/ any | null)[] | /*elided*/ any | null)[] | /*elided*/ any | null)[] | /*elided*/ any | null)[] | /*elided*/ any | null)[] | /*elided*/ any | null)[] | /*elided*/ any | null)[] | /*elided*/ any | null;
                } | null)[] | {
                    readonly [x: string]: string | number | boolean | readonly (string | number | boolean | readonly (string | number | boolean | readonly (string | number | boolean | readonly (string | number | boolean | readonly (string | number | boolean | readonly (string | number | boolean | readonly (string | number | boolean | readonly (string | number | boolean | /*elided*/ any | /*elided*/ any | null)[] | /*elided*/ any | null)[] | /*elided*/ any | null)[] | /*elided*/ any | null)[] | /*elided*/ any | null)[] | /*elided*/ any | null)[] | /*elided*/ any | null)[] | /*elided*/ any | null)[] | /*elided*/ any | null;
                } | null)[] | {
                    readonly [x: string]: string | number | boolean | readonly (string | number | boolean | readonly (string | number | boolean | readonly (string | number | boolean | readonly (string | number | boolean | readonly (string | number | boolean | readonly (string | number | boolean | readonly (string | number | boolean | readonly (string | number | boolean | readonly (string | number | boolean | /*elided*/ any | /*elided*/ any | null)[] | /*elided*/ any | null)[] | /*elided*/ any | null)[] | /*elided*/ any | null)[] | /*elided*/ any | null)[] | /*elided*/ any | null)[] | /*elided*/ any | null)[] | /*elided*/ any | null)[] | /*elided*/ any | null)[] | /*elided*/ any | null;
                } | null)[] | {
                    readonly [x: string]: string | number | boolean | readonly (string | number | boolean | readonly (string | number | boolean | readonly (string | number | boolean | readonly (string | number | boolean | readonly (string | number | boolean | readonly (string | number | boolean | readonly (string | number | boolean | readonly (string | number | boolean | readonly (string | number | boolean | readonly (string | number | boolean | /*elided*/ any | /*elided*/ any | null)[] | /*elided*/ any | null)[] | /*elided*/ any | null)[] | /*elided*/ any | null)[] | /*elided*/ any | null)[] | /*elided*/ any | null)[] | /*elided*/ any | null)[] | /*elided*/ any | null)[] | /*elided*/ any | null)[] | /*elided*/ any | null)[] | /*elided*/ any | null;
                } | null)[] | {
                    readonly [x: string]: string | number | boolean | readonly (string | number | boolean | readonly (string | number | boolean | readonly (string | number | boolean | readonly (string | number | boolean | readonly (string | number | boolean | readonly (string | number | boolean | readonly (string | number | boolean | readonly (string | number | boolean | readonly (string | number | boolean | readonly (string | number | boolean | readonly (string | number | boolean | /*elided*/ any | /*elided*/ any | null)[] | /*elided*/ any | null)[] | /*elided*/ any | null)[] | /*elided*/ any | null)[] | /*elided*/ any | null)[] | /*elided*/ any | null)[] | /*elided*/ any | null)[] | /*elided*/ any | null)[] | /*elided*/ any | null)[] | /*elided*/ any | null)[] | /*elided*/ any | null)[] | /*elided*/ any | null;
                } | null;
                readonly kind: "draw" | "pending" | "win";
                readonly round: number;
                readonly submittedPlayers: readonly ("0" | "1" | "2")[];
                readonly winners: readonly ("0" | "1" | "2")[];
                readonly winningChoice: PaperScissorsRockChoice | null;
            };
            lastRevealed: {
                readonly 0: PaperScissorsRockChoice | null;
                readonly 1: PaperScissorsRockChoice | null;
                readonly 2: PaperScissorsRockChoice | null;
            };
            round: number;
            scores: {
                readonly 0: number;
                readonly 1: number;
                readonly 2: number;
            };
        };
    } | null;
    to: "plan";
} | {
    event: "submitChoice";
    from: "plan";
    label: string;
    resolve: ({ G, event, playerID }: import("@openturn/core").GameEventContext<PaperScissorsRockState, {
        submitChoice: PaperScissorsRockChoice;
    }, string, readonly ["0", "1", "2"], any, "submitChoice">) => {
        G: {
            lastOutcome: {
                round: number;
                kind: "draw" | "pending" | "win";
                submittedPlayers: readonly PaperScissorsRockPlayers[number][];
                winners: readonly PaperScissorsRockPlayers[number][];
                winningChoice: PaperScissorsRockChoice | null;
            };
            lastRevealed: {
                0: PaperScissorsRockChoice | null;
                1: PaperScissorsRockChoice | null;
                2: PaperScissorsRockChoice | null;
            };
            round: number;
            scores: {
                0: number;
                1: number;
                2: number;
            };
            submissions: PlayerRecord<readonly ["0", "1", "2"], PaperScissorsRockChoice | null>;
        };
        turn: "increment";
    } | null;
    to: "plan";
})[]>;
export {};
