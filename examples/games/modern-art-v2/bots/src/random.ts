import { defineBot } from "@openturn/bot";
import {
  enumerateModernArtLegalActions,
  type ModernArtPlayerID,
  type ModernArtState,
  type modernArt,
} from "@openturn/example-modern-art-v2-game";

type ModernArtGame = typeof modernArt;

/**
 * Random bot: picks a uniformly random legal action. Useful as a baseline and
 * for stress-testing the engine's termination (every match must complete).
 */
export const randomBot = defineBot<ModernArtGame>({
  name: "random",
  actionDelayMs: 1_200,
  enumerate({ snapshot, playerID }) {
    if (snapshot === null) return [];
    return enumerateModernArtLegalActions(
      snapshot.G as ModernArtState,
      playerID as ModernArtPlayerID,
      snapshot.position.turn - 1,
    );
  },
  decide({ legalActions, rng }) {
    if (legalActions.length === 0) {
      throw new Error("randomBot: no legal actions available");
    }
    return rng.pick(legalActions);
  },
});
