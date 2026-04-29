import type { PlayerID } from "@openturn/core";
import { defineGame, turn } from "@openturn/gamekit";

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

const PLAYER_MARKS: Record<PlayerID, TicTacToeMark> = {
  "0": "X",
  "1": "O",
};

export const ticTacToeGameID = "example/tic-tac-toe";

export const ticTacToe = defineGame({
  maxPlayers: 2,
  computed: {
    boardFull: ({ G }) => isBoardFull(G.board),
    winner: ({ G }) => getWinner(G.board),
  },
  setup: (): TicTacToeState => ({
    board: [
      [null, null, null],
      [null, null, null],
      [null, null, null],
    ],
  }),
  turn: turn.roundRobin(),
  legalActions: ({ G, derived }, playerID) => {
    if (!derived.activePlayers.includes(playerID)) return [];
    const actions: { event: string; payload: PlaceMarkArgs; label: string }[] = [];
    for (let row = 0; row < G.board.length; row += 1) {
      const cells = G.board[row]!;
      for (let col = 0; col < cells.length; col += 1) {
        if (cells[col] === null) {
          actions.push({ event: "placeMark", payload: { row, col }, label: `(${row},${col})` });
        }
      }
    }
    return actions;
  },
  moves: ({ move }) => ({
    placeMark: move<PlaceMarkArgs>({
      run({ G, args, move, player }) {
        const board = placeMark(G.board, args.row, args.col, player.id);

        if (board === null) {
          return move.invalid("occupied", {
            col: args.col,
            row: args.row,
          });
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
    player: ({ G, turn }, player): TicTacToePlayerView => ({
      board: G.board,
      currentPlayer: turn.currentPlayer,
      myMark: PLAYER_MARKS[player.id] ?? null,
    }),
    public: ({ G, turn }): TicTacToePublicView => ({
      board: G.board,
      currentPlayer: turn.currentPlayer,
    }),
  },
});

function placeMark(
  board: readonly (readonly TicTacToeCell[])[],
  row: number,
  col: number,
  playerID: PlayerID,
): TicTacToeCell[][] | null {
  const currentCell = board[row]?.[col];
  if (currentCell !== null) {
    return null;
  }

  const mark = PLAYER_MARKS[playerID];
  if (mark === undefined) {
    return null;
  }

  return board.map((cells, rowIndex) => cells.map((cell, colIndex) =>
    rowIndex === row && colIndex === col ? mark : cell));
}

function getWinner(board: readonly (readonly TicTacToeCell[])[]): TicTacToeMark | null {
  const row0 = board[0]!;
  const row1 = board[1]!;
  const row2 = board[2]!;
  const lines = [
    [row0[0]!, row0[1]!, row0[2]!],
    [row1[0]!, row1[1]!, row1[2]!],
    [row2[0]!, row2[1]!, row2[2]!],
    [row0[0]!, row1[0]!, row2[0]!],
    [row0[1]!, row1[1]!, row2[1]!],
    [row0[2]!, row1[2]!, row2[2]!],
    [row0[0]!, row1[1]!, row2[2]!],
    [row0[2]!, row1[1]!, row2[0]!],
  ] as const;

  for (const [a, b, c] of lines) {
    if (a !== null && a === b && b === c) {
      return a;
    }
  }

  return null;
}

function isBoardFull(board: readonly (readonly TicTacToeCell[])[]): boolean {
  return board.every((row) => row.every((cell) => cell !== null));
}
