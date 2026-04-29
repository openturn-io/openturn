import { attachBots, defineBotRegistry, type BotRegistry } from "@openturn/lobby/registry";
import { splendor } from "@openturn/example-splendor-game";

import { greedyBot } from "./greedy";
import { randomBot } from "./random";
import { strategicBot } from "./strategic";

export { greedyBot } from "./greedy";
export { randomBot } from "./random";
export { strategicBot } from "./strategic";

/**
 * Bot catalog for Splendor. The `botID`s are stable wire identifiers used by
 * the lobby's per-seat dropdown and the in-DO bot driver.
 */
export const splendorBotRegistry: BotRegistry<typeof splendor> = defineBotRegistry([
  {
    botID: "random",
    label: "Random",
    description: "Picks a uniformly random legal move.",
    difficulty: "easy",
    bot: randomBot,
  },
  {
    botID: "greedy",
    label: "Greedy",
    description: "Buys the best affordable card, otherwise grabs gems aligned with market costs.",
    difficulty: "easy",
    bot: greedyBot,
  },
  {
    botID: "strategic",
    label: "Strategic",
    description: "Plans around nobles, engine balance, reserves, and opponent threats.",
    difficulty: "hard",
    bot: strategicBot,
  },
]);

/**
 * Splendor pre-decorated with its bot registry. Apps that want lobby bot
 * picking import this instead of the bare `splendor` from
 * `@openturn/example-splendor-game`.
 */
export const splendorWithBots = attachBots(splendor, splendorBotRegistry);
