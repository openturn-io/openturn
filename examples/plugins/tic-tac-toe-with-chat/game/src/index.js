import { defineMatch } from "@openturn/core";
import { defineGame, turn } from "@openturn/gamekit";
import { withPlugins } from "@openturn/plugins";
import { chatPlugin } from "@openturn/plugin-chat";
const PLAYER_MARKS = {
    "0": "X",
    "1": "O",
};
export const ticTacToeWithChatGameID = "example/tic-tac-toe-with-chat";
export const ticTacToeWithChatMatch = defineMatch({
    players: ["0", "1"],
});
// Composes the host gamekit definition with the chat plugin via
// `withPlugins(...)`. The plugin contributes a `G.plugins.chat` slice and a
// namespaced `chat__send` move; both clients receive chat history through the
// player view because the plugin runtime merges plugin slices into views by
// default.
//
// The base game definition is duplicated from `examples/tic-tac-toe/game` (not
// re-imported) because the canonical export is the *compiled* `defineGame(...)`
// result — gamekit relies on inline literal inference, so the source object is
// not exported separately to keep that example unchanged. A future refactor can
// reuse the base when gamekit grows a stable source-export API.
export const ticTacToeWithChat = defineGame(ticTacToeWithChatMatch, withPlugins({
    computed: {
        boardFull: ({ G }) => isBoardFull(G.board),
        winner: ({ G }) => getWinner(G.board),
    },
    setup: () => ({
        board: [
            [null, null, null],
            [null, null, null],
            [null, null, null],
        ],
    }),
    turn: turn.roundRobin(),
    moves: ({ move }) => ({
        placeMark: move({
            run({ G, args, move, player }) {
                const board = placeMark(G.board, args.row, args.col, player.id);
                if (board === null) {
                    return move.invalid("occupied", { col: args.col, row: args.row });
                }
                if (getWinner(board) !== null) {
                    return move.finish({ winner: player.id }, { board });
                }
                if (isBoardFull(board)) {
                    return move.finish({ draw: true }, { board });
                }
                return move.endTurn({ board });
            },
        }),
    }),
    views: {
        player: ({ G, turn }, player) => ({
            board: G.board,
            currentPlayer: turn.currentPlayer,
            myMark: PLAYER_MARKS[player.id] ?? null,
        }),
        public: ({ G, turn }) => ({
            board: G.board,
            currentPlayer: turn.currentPlayer,
        }),
    },
}, [chatPlugin]));
function placeMark(board, row, col, playerID) {
    const currentCell = board[row]?.[col];
    if (currentCell !== null) {
        return null;
    }
    const mark = PLAYER_MARKS[playerID];
    if (mark === undefined) {
        return null;
    }
    return board.map((cells, rowIndex) => cells.map((cell, colIndex) => rowIndex === row && colIndex === col ? mark : cell));
}
function getWinner(board) {
    const row0 = board[0];
    const row1 = board[1];
    const row2 = board[2];
    const lines = [
        [row0[0], row0[1], row0[2]],
        [row1[0], row1[1], row1[2]],
        [row2[0], row2[1], row2[2]],
        [row0[0], row1[0], row2[0]],
        [row0[1], row1[1], row2[1]],
        [row0[2], row1[2], row2[2]],
        [row0[0], row1[1], row2[2]],
        [row0[2], row1[1], row2[0]],
    ];
    for (const [a, b, c] of lines) {
        if (a !== null && a === b && b === c) {
            return a;
        }
    }
    return null;
}
function isBoardFull(board) {
    return board.every((row) => row.every((cell) => cell !== null));
}
