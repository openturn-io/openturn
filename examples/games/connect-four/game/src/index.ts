import { defineGame, turn } from "@openturn/gamekit";

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
  moves: ({ move }) => ({
    dropDisc: move<DropDiscArgs>({
      run({ move }) {
        return move.finish({ draw: true });
      },
    }),
  }),
});
