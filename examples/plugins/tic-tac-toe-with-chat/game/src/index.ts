import type { PlayerID } from "@openturn/core";
import { turn } from "@openturn/gamekit";
import { withPlugins } from "@openturn/plugins";
import { chatPlugin } from "@openturn/plugin-chat";

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

export const ticTacToeWithChatGameID = "example/tic-tac-toe-with-chat";

// Composes the host gamekit definition with the chat plugin via
// `withPlugins(...)`. The plugin contributes a `G.plugins.chat` slice and a
// namespaced `chat__send` move; both clients receive chat history through the
// player view because the plugin runtime merges plugin slices into views by
// default.
//
// `withPlugins` wraps `defineGame` directly — the result is a finalized game
// definition, and the author writes `setup`/`moves`/`views` with the same
// contextual typing they'd get from `defineGame` itself.
export const ticTacToeWithChat = withPlugins(
  {
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
    moves: ({ move }) => ({
      placeMark: move<PlaceMarkArgs>({
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
  },
  [chatPlugin],
);

export type TicTacToeWithChatGame = typeof ticTacToeWithChat;

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
