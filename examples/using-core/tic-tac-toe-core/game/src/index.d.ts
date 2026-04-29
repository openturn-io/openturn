import { type LocalGameSession } from "@openturn/core";
export type TicTacToeCell = "X" | "O" | null;
export interface TicTacToeState {
    board: TicTacToeCell[][];
}
export interface PlaceMarkArgs {
    col: number;
    row: number;
}
type TicTacToeMark = Exclude<TicTacToeCell, null>;
type TicTacToePublicView = {
    board: readonly (readonly TicTacToeCell[])[];
    currentPlayer: TicTacToePlayerID;
};
type TicTacToePlayerView = TicTacToePublicView & {
    myMark: TicTacToeMark | null;
};
export declare const ticTacToeMachineMatch: import("@openturn/core").MatchInput<readonly ["0", "1"], import("@openturn/core").ReplayValue>;
type TicTacToePlayerID = (typeof ticTacToeMachineMatch.players)[number];
export declare const ticTacToeMachine: import("@openturn/core").GameDefinition<TicTacToeState, {
    place_mark: PlaceMarkArgs;
}, {
    winner: "0" | "1";
} | {
    draw: true;
}, readonly ["0", "1"], "play" | "drawn" | "won", TicTacToePublicView, TicTacToePlayerView, import("@openturn/core").ReplayValue, readonly import("@openturn/core").GameTransitionConfig<TicTacToeState, {
    place_mark: PlaceMarkArgs;
}, {
    winner: "0" | "1";
} | {
    draw: true;
}, "play" | "drawn" | "won", readonly ["0", "1"], import("@openturn/core").ReplayValue>[]>;
export declare function createTicTacToeMachineSession(): LocalGameSession<typeof ticTacToeMachine>;
export {};
