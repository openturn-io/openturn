import { attachBots, defineBotRegistry, type BotRegistry } from "@openturn/lobby/registry";
import { modernArt } from "@openturn/example-modern-art-game";

import { conservativeBot } from "./conservative";
import { randomBot } from "./random";
import { speculatorBot } from "./speculator";

export { conservativeBot } from "./conservative";
export { randomBot } from "./random";
export { speculatorBot } from "./speculator";

export const modernArtBotRegistry: BotRegistry<typeof modernArt> = defineBotRegistry([
  {
    bot: randomBot,
    botID: "random",
    description: "Chooses among legal auction actions uniformly.",
    difficulty: "easy",
    label: "Random",
  },
  {
    bot: conservativeBot,
    botID: "conservative",
    description: "Keeps bids below expected resale value and favors safe auction lots.",
    difficulty: "easy",
    label: "Conservative",
  },
  {
    bot: speculatorBot,
    botID: "speculator",
    description: "Pushes artist momentum and accepts higher risk on emerging markets.",
    difficulty: "medium",
    label: "Speculator",
  },
]);

export const modernArtWithBots = attachBots(modernArt, modernArtBotRegistry);
