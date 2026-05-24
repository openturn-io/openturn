import { defineBot } from "@openturn/bot";
import {
  enumerateModernArtLegalActions,
  modernArt,
  type ModernArtPlayerID,
  type ModernArtState,
} from "@openturn/example-modern-art-game";

type ModernArtGame = typeof modernArt;

export const randomBot = defineBot<ModernArtGame>({
  actionDelayMs: 1_200,
  name: "random",
  enumerate({ snapshot, playerID }) {
    if (snapshot === null) return [];
    return enumerateModernArtLegalActions(snapshot.G as unknown as ModernArtState, playerID as ModernArtPlayerID);
  },
  decide({ legalActions, rng }) {
    if (legalActions.length === 0) throw new Error("randomBot: no legal actions available");
    return rng.pick(legalActions);
  },
});
