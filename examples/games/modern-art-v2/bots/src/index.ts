import { attachBots, defineBotRegistry, type BotRegistry } from "@openturn/lobby/registry";
import { modernArt } from "@openturn/example-modern-art-v2-game";

import { collectorBot } from "./collector";
import { randomBot } from "./random";
import { speculatorBot } from "./speculator";

export { collectorBot } from "./collector";
export { randomBot } from "./random";
export { speculatorBot } from "./speculator";

/**
 * Bot catalog for Modern Art. The `botID`s are stable wire identifiers used by
 * the lobby's per-seat dropdown and the in-DO bot driver.
 */
export const modernArtBotRegistry: BotRegistry<typeof modernArt> = defineBotRegistry([
  {
    botID: "random",
    label: "Random",
    description: "Picks a uniformly random legal action.",
    difficulty: "easy",
    bot: randomBot,
  },
  {
    botID: "collector",
    label: "Collector",
    description: "Bids up to each painting's projected resale value; avoids overpaying.",
    difficulty: "medium",
    bot: collectorBot,
  },
  {
    botID: "speculator",
    label: "Speculator",
    description: "Rarity-weighted valuation, cash-reserve aware, simulate-checked bids.",
    difficulty: "hard",
    bot: speculatorBot,
  },
]);

/**
 * Modern Art pre-decorated with its bot registry. Apps that want lobby bot
 * picking import this instead of the bare `modernArt`.
 */
export const modernArtWithBots = attachBots(modernArt, modernArtBotRegistry);
