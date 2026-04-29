export type TicTacToeCell = "X" | "O" | null;

export type TicTacToeBoard = ReadonlyArray<ReadonlyArray<TicTacToeCell>>;

export type TicTacToePlayerID = "0" | "1";

export type TicTacToeResult =
  | { winner: TicTacToePlayerID }
  | { draw: true }
  | null;
