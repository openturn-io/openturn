import type { TicTacToePlayerID } from "./types";

export const PLAYER_LABEL: Record<TicTacToePlayerID, string> = {
  "0": "Player X",
  "1": "Player O",
};

export const PLAYER_MARK: Record<TicTacToePlayerID, "X" | "O"> = {
  "0": "X",
  "1": "O",
};
