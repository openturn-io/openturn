import { defineBot } from "@openturn/bot";
import {
  enumerateModernArtLegalActions,
  modernArt,
  type ModernArtPlayerID,
  type ModernArtState,
} from "@openturn/example-modern-art-game";

import { bestAction } from "./conservative";

type ModernArtGame = typeof modernArt;

export const speculatorBot = defineBot<ModernArtGame>({
  actionDelayMs: 1_500,
  name: "speculator",
  enumerate({ snapshot, playerID }) {
    if (snapshot === null) return [];
    return enumerateModernArtLegalActions(snapshot.G as unknown as ModernArtState, playerID as ModernArtPlayerID);
  },
  decide({ legalActions, playerID, snapshot, rng }) {
    if (legalActions.length === 0) throw new Error("speculatorBot: no legal actions available");
    const state = snapshot?.G as unknown as ModernArtState | undefined;
    if (state === undefined) return rng.pick(legalActions);
    return bestAction(state, playerID as ModernArtPlayerID, legalActions, 0.88, rng.next());
  },
});
