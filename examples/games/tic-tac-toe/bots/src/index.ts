import { attachBots, defineBotRegistry, type BotRegistry } from "@openturn/lobby/registry";
import { ticTacToe } from "@openturn/example-tic-tac-toe-game";

import { randomBot } from "./random";
import { makeMinimaxBot, minimaxBot } from "./minimax";

export { randomBot } from "./random";
export { makeMinimaxBot, minimaxBot } from "./minimax";

/**
 * Bot catalog for tic-tac-toe. Distinct difficulties register as distinct
 * `Bot` instances so the lobby UI can offer them as separate dropdown
 * options. The `botID`s here are stable wire identifiers.
 */
export const ticTacToeBotRegistry: BotRegistry<typeof ticTacToe> = defineBotRegistry([
  {
    botID: "random",
    label: "Random",
    description: "Picks a uniformly random legal move.",
    difficulty: "easy",
    bot: randomBot,
  },
  {
    botID: "minimax-easy",
    label: "Minimax · easy",
    description: "Alpha-beta minimax cut at depth 2 — beatable.",
    difficulty: "easy",
    bot: makeMinimaxBot({ depth: 2, name: "minimax-easy" }),
  },
  {
    botID: "minimax-hard",
    label: "Minimax · hard",
    description: "Full-depth alpha-beta minimax — optimal play.",
    difficulty: "hard",
    bot: minimaxBot,
  },
]);

/**
 * Tic-tac-toe game pre-decorated with its bot registry. Apps that want
 * lobby bot picking import this instead of the bare `ticTacToe`. Apps
 * that don't ship bots can keep using `ticTacToe` from
 * `@openturn/example-tic-tac-toe-game` directly.
 */
export const ticTacToeWithBots = attachBots(ticTacToe, ticTacToeBotRegistry);
