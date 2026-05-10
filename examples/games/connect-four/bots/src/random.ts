import { defineBot } from "@openturn/bot";
import type { connectFour } from "@openturn/example-connect-four-game";

export const randomBot = defineBot<typeof connectFour>({
  name: "random",
  decide({ legalActions, rng }) {
    if (legalActions.length === 0) {
      throw new Error("randomBot: no legal actions available");
    }
    return rng.pick(legalActions);
  },
});
