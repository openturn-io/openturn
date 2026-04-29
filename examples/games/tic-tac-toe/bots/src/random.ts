import { defineBot } from "@openturn/bot";
import type { ticTacToe } from "@openturn/example-tic-tac-toe-game";

type TicTacToeGame = typeof ticTacToe;

export const randomBot = defineBot<TicTacToeGame>({
  name: "random",
  decide({ legalActions, rng }) {
    if (legalActions.length === 0) {
      throw new Error("randomBot: no legal actions available");
    }
    return rng.pick(legalActions);
  },
});
