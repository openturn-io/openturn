import { defineBot, type LegalAction } from "@openturn/bot";
import {
  CARD_BY_ID,
  ARTISTS,
  enumerateModernArtLegalActions,
  getCard,
  modernArt,
  type ArtistID,
  type ModernArtPlayerID,
  type ModernArtState,
} from "@openturn/example-modern-art-game";

type ModernArtGame = typeof modernArt;

export const conservativeBot = defineBot<ModernArtGame>({
  actionDelayMs: 1_300,
  name: "conservative",
  enumerate({ snapshot, playerID }) {
    if (snapshot === null) return [];
    return enumerateModernArtLegalActions(snapshot.G as unknown as ModernArtState, playerID as ModernArtPlayerID);
  },
  decide({ legalActions, playerID, snapshot, rng }) {
    if (legalActions.length === 0) throw new Error("conservativeBot: no legal actions available");
    const state = snapshot?.G as unknown as ModernArtState | undefined;
    if (state === undefined) return rng.pick(legalActions);
    return bestAction(state, playerID as ModernArtPlayerID, legalActions, 0.55, rng.next());
  },
});

export function currentArtistValues(state: ModernArtState): Record<ArtistID, number> {
  const out = {} as Record<ArtistID, number>;
  for (const artist of ARTISTS) {
    out[artist] = state.valueTiles[artist].reduce((sum, value) => sum + value, 0);
  }
  return out;
}

export function projectedLotValue(state: ModernArtState): number {
  const lot = state.lot;
  if (lot === null) return 0;
  const values = currentArtistValues(state);
  let total = 0;
  for (const cardID of lot.cards) {
    const card = getCard(cardID);
    const count = state.offeredCounts[card.artist];
    const likelyBonus = count >= 4 ? 30 : count >= 3 ? 20 : count >= 2 ? 10 : 0;
    total += values[card.artist] + likelyBonus;
  }
  return total;
}

export function bestAction(
  state: ModernArtState,
  playerID: ModernArtPlayerID,
  legalActions: readonly LegalAction[],
  risk: number,
  jitter: number,
): LegalAction {
  const scored = legalActions.map((action, index) => ({
    action,
    score: scoreAction(state, playerID, action, risk) + jitter * 0.001 - index * 0.00001,
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored[0]!.action;
}

function scoreAction(
  state: ModernArtState,
  playerID: ModernArtPlayerID,
  action: LegalAction,
  risk: number,
): number {
  if (action.event === "playPainting") {
    const card = CARD_BY_ID[(action.payload as { cardID: string }).cardID]!;
    const sameArtistInHand = state.players[playerID].hand
      .map((id) => CARD_BY_ID[id]!)
      .filter((candidate) => candidate.artist === card.artist).length;
    const existingValue = currentArtistValues(state)[card.artist];
    return 100 + sameArtistInHand * 12 + state.offeredCounts[card.artist] * 10 + existingValue * 0.5;
  }
  if (action.event === "offerDouble") {
    const cardID = (action.payload as { cardID: string | null }).cardID;
    if (cardID === null) return state.lot?.originalAuctioneer === playerID ? -5 : 0;
    const card = CARD_BY_ID[cardID]!;
    return 130 + state.offeredCounts[card.artist] * 12;
  }
  if (action.event === "raiseOpenBid" || action.event === "submitOneOffer" || action.event === "submitHiddenBid") {
    const amount = (action.payload as { amount: number | null }).amount ?? 0;
    const cap = projectedLotValue(state) * risk;
    if (amount === 0) return 4;
    return amount <= cap ? 80 - amount * 0.4 : 10 - amount;
  }
  if (action.event === "setFixedPrice") {
    const amount = (action.payload as { amount: number }).amount;
    const target = Math.max(5, projectedLotValue(state) * 0.72);
    return 70 - Math.abs(amount - target);
  }
  if (action.event === "respondFixedPrice") {
    if (!(action.payload as { accept: boolean }).accept) return 8;
    const price = state.lot?.fixedPrice ?? 0;
    return price <= projectedLotValue(state) * risk ? 80 - price * 0.25 : -20 - price;
  }
  if (action.event === "passOpenBid") return 6;
  return 0;
}
