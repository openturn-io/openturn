import { defineBot } from "@openturn/bot";
import {
  enumerateSplendorLegalActions,
  type SplendorPlayerID,
  type SplendorState,
  type splendor,
} from "@openturn/example-splendor-game";

type SplendorGame = typeof splendor;

export const randomBot = defineBot<SplendorGame>({
  name: "random",
  actionDelayMs: 1_500,
  enumerate({ snapshot, playerID }) {
    if (snapshot === null) return [];
    return enumerateSplendorLegalActions(snapshot.G as SplendorState, playerID as SplendorPlayerID);
  },
  decide({ legalActions, rng }) {
    if (legalActions.length === 0) {
      throw new Error("randomBot: no legal actions available");
    }
    return rng.pick(legalActions);
  },
});
