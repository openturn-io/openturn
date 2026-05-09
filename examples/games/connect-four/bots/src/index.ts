import { attachBots, defineBotRegistry, type BotRegistry } from "@openturn/lobby/registry";
import { connectFour } from "@openturn/example-connect-four-game";

import { heuristicBot } from "./heuristic";
import { minimaxBot } from "./minimax";
import { randomBot } from "./random";

export { heuristicBot } from "./heuristic";
export { makeMinimaxBot, minimaxBot } from "./minimax";
export { randomBot } from "./random";

/**
 * Bot catalog for Connect Four. The `botID`s are stable wire identifiers
 * used by the lobby's per-seat dropdown and the in-DO bot driver.
 */
export const connectFourBotRegistry: BotRegistry<typeof connectFour> = defineBotRegistry([
  {
    botID: "random",
    label: "Random",
    description: "Picks a uniformly random legal move.",
    difficulty: "easy",
    bot: randomBot,
  },
  {
    botID: "heuristic",
    label: "Heuristic",
    description: "One-ply: takes immediate wins, blocks immediate threats, prefers the center.",
    difficulty: "medium",
    bot: heuristicBot,
  },
  {
    botID: "minimax",
    label: "Minimax",
    description: "Alpha-beta search at depth 6 with iterative deepening.",
    difficulty: "hard",
    bot: minimaxBot,
  },
]);

/**
 * Connect Four pre-decorated with its bot registry. Apps that want lobby
 * bot picking import this instead of the bare `connectFour`.
 */
export const connectFourWithBots = attachBots(connectFour, connectFourBotRegistry);
