import { type PlayerID } from "@openturn/core";
export type TicTacToeCell = "X" | "O" | null;
export interface TicTacToeState {
    board: TicTacToeCell[][];
}
export interface TicTacToePublicView {
    board: readonly (readonly TicTacToeCell[])[];
    currentPlayer: PlayerID;
}
export interface TicTacToePlayerView extends TicTacToePublicView {
    myMark: TicTacToeMark | null;
}
export interface PlaceMarkArgs {
    col: number;
    row: number;
}
type TicTacToeMark = Exclude<TicTacToeCell, null>;
export declare const ticTacToeWithChatGameID = "example/tic-tac-toe-with-chat";
export declare const ticTacToeWithChatMatch: import("@openturn/core").MatchInput<readonly ["0", "1"], import("@openturn/core").ReplayValue>;
export declare const ticTacToeWithChat: import("@openturn/core").GameDefinition<import("@openturn/gamekit").GamekitState<object>, {
    [x: string]: any;
}, import("@openturn/gamekit").GamekitResultState, readonly ["0", "1"], "__gamekit_finished" | "play", object, object, import("@openturn/core").ReplayValue, readonly import("@openturn/core").GameTransitionConfig<import("@openturn/gamekit").GamekitState<object>, {
    [x: string]: any;
}, import("@openturn/gamekit").GamekitResultState, "__gamekit_finished" | "play", readonly ["0", "1"], import("@openturn/core").ReplayValue>[]>;
export type TicTacToeWithChatGame = typeof ticTacToeWithChat;
export {};
