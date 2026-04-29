import { createLocalSession, defineGame, defineMatch, defineEvent, } from "@openturn/core";
export const ticTacToeMachineMatch = defineMatch({
    players: ["0", "1"],
});
const PLAYER_MARKS = {
    "0": "X",
    "1": "O",
};
export const ticTacToeMachine = defineGame(ticTacToeMachineMatch, {
    events: {
        place_mark: defineEvent(),
    },
    initial: "play",
    selectors: {
        boardFull: ({ G }) => isBoardFull(G.board),
        winnerMark: ({ G }) => getWinner(G.board),
    },
    setup: () => ({
        board: createEmptyBoard(),
    }),
    states: {
        drawn: {
            activePlayers: () => [],
            control: () => ({ status: "drawn" }),
            label: "Draw",
            metadata: () => [],
        },
        play: {
            activePlayers: ({ match, position }) => [match.players[(position.turn - 1) % match.players.length]],
            control: () => ({ status: "playing" }),
            label: ({ match, position }) => `Player ${currentPlayer(match.players, position.turn)} to play`,
            metadata: ({ match, position }) => [
                {
                    key: "currentPlayer",
                    value: currentPlayer(match.players, position.turn),
                },
            ],
        },
        won: {
            activePlayers: () => [],
            control: () => ({ status: "won" }),
            label: "Winner",
            metadata: ({ G }) => [
                {
                    key: "winnerMark",
                    value: getWinner(G.board),
                },
            ],
        },
    },
    transitions: ({ transition }) => [
        transition("place_mark", {
            from: "play",
            label: "place_mark_to_won",
            resolve: ({ G, event, playerID }) => {
                const board = placeMark(G.board, event.payload.row, event.payload.col, playerID);
                const winner = board === null ? null : getWinner(board);
                if (board === null || winner === null) {
                    return null;
                }
                return {
                    G: { board },
                    result: { winner: winner === "X" ? "0" : "1" },
                    turn: "increment",
                };
            },
            to: "won",
        }),
        transition("place_mark", {
            from: "play",
            label: "place_mark_to_drawn",
            resolve: ({ G, event, playerID }) => {
                const board = placeMark(G.board, event.payload.row, event.payload.col, playerID);
                if (board === null || getWinner(board) !== null || !isBoardFull(board)) {
                    return null;
                }
                return {
                    G: { board },
                    result: { draw: true },
                    turn: "increment",
                };
            },
            to: "drawn",
        }),
        transition("place_mark", {
            from: "play",
            label: "place_mark_continue",
            resolve: ({ G, event, playerID }) => {
                const board = placeMark(G.board, event.payload.row, event.payload.col, playerID);
                if (board === null || getWinner(board) !== null || isBoardFull(board)) {
                    return null;
                }
                return {
                    G: { board },
                    turn: "increment",
                };
            },
            to: "play",
        }),
    ],
    views: {
        player: ({ G, match, position }, playerID) => ({
            board: G.board,
            currentPlayer: currentPlayer(match.players, position.turn),
            myMark: PLAYER_MARKS[playerID] ?? null,
        }),
        public: ({ G, match, position }) => ({
            board: G.board,
            currentPlayer: currentPlayer(match.players, position.turn),
        }),
    },
});
export function createTicTacToeMachineSession() {
    return createLocalSession(ticTacToeMachine, {
        match: ticTacToeMachineMatch,
    });
}
function createEmptyBoard() {
    return [
        [null, null, null],
        [null, null, null],
        [null, null, null],
    ];
}
function placeMark(board, row, col, playerID) {
    const currentCell = board[row]?.[col];
    if (currentCell !== null) {
        return null;
    }
    const mark = playerID === null ? undefined : PLAYER_MARKS[playerID];
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
function currentPlayer(players, turnNumber) {
    return players[(turnNumber - 1) % players.length];
}
