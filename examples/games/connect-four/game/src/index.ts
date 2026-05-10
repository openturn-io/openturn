import { defineGame, turn } from "@openturn/gamekit";

import { findWinningLine, lowestEmptyRow, withDisc } from "./board";

export type Mark = "0" | "1";
export type Cell = Mark | null;
export type Board = Cell[][];

export const ROWS = 6;
export const COLS = 7;

export interface ConnectFourState {
  board: Board;
  lastMove: { col: number; row: number; player: Mark } | null;
}

export interface DropDiscArgs {
  col: number;
}

export { lowestEmptyRow, withDisc, findWinningLine } from "./board";
export type { CellRef } from "./board";

export const connectFour = defineGame({
  playerIDs: ["0", "1"] as const,
  setup: (): ConnectFourState => ({
    board: Array.from({ length: ROWS }, () => Array<Cell>(COLS).fill(null)),
    lastMove: null,
  }),
  turn: turn.roundRobin(),
  computed: {
    winningLine: ({ G }) =>
      G.lastMove ? findWinningLine(G.board, G.lastMove.row, G.lastMove.col) : null,
    isBoardFull: ({ G }) => G.board[0]!.every((c) => c !== null),
  },
  legalActions: ({ G, derived }, playerID) => {
    if (!derived.activePlayers.includes(playerID)) return [];
    return Array.from({ length: COLS }, (_, col) => col)
      .filter((col) => G.board[0]![col] === null)
      .map((col) => ({ event: "dropDisc", payload: { col }, label: `Col ${col + 1}` }));
  },
  moves: ({ move }) => ({
    dropDisc: move<DropDiscArgs>({
      run({ G, args, move, player }) {
        if (G.board[0]![args.col] !== null) {
          return move.invalid("column_full", { col: args.col });
        }
        const row = lowestEmptyRow(G.board, args.col);
        const board = withDisc(G.board, row, args.col, player.id as Mark);
        const lastMove = { col: args.col, row, player: player.id as Mark };
        if (findWinningLine(board, row, args.col) !== null) {
          return move.finish({ winner: player.id }, { board, lastMove });
        }
        if (board[0]!.every((c) => c !== null)) {
          return move.finish({ draw: true }, { board, lastMove });
        }
        return move.endTurn({ board, lastMove });
      },
    }),
  }),
  views: {
    public: ({ G, turn: t, C }) => ({
      board: G.board,
      lastMove: G.lastMove,
      currentPlayer: t.currentPlayer,
      winningLine: C.winningLine,
    }),
    player: ({ G, turn: t, C }) => ({
      board: G.board,
      lastMove: G.lastMove,
      currentPlayer: t.currentPlayer,
      winningLine: C.winningLine,
    }),
  },
});
