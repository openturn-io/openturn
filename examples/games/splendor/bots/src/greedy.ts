import { defineBot, type LegalAction } from "@openturn/bot";
import {
  RESERVE_LIMIT,
  TAKE_TWO_MIN_PILE,
  enumerateSplendorLegalActions,
  getCard,
  splendor,
  type BuyCardArgs,
  type GemColor,
  type ReserveCardArgs,
  type SplendorPlayerID,
  type SplendorPlayerView,
  type SplendorState,
  type TakeThreeArgs,
  type TakeTwoArgs,
  type Tier,
} from "@openturn/example-splendor-game";

type SplendorGame = typeof splendor;

interface ScoredAction {
  action: LegalAction;
  score: number;
}

/**
 * Greedy heuristic bot: prefers buying the highest-prestige affordable card,
 * then reserving high-value tier-3 cards, then collecting gems aligned with
 * the costs of cards already on its radar. Reads only `view` (no simulate).
 */
export const greedyBot = defineBot<SplendorGame>({
  name: "greedy",
  actionDelayMs: 1_500,
  enumerate({ snapshot, playerID }) {
    if (snapshot === null) return [];
    return enumerateSplendorLegalActions(snapshot.G as SplendorState, playerID as SplendorPlayerID);
  },
  decide({ legalActions, view, playerID }) {
    if (legalActions.length === 0) {
      throw new Error("greedyBot: no legal actions available");
    }

    const playerView = view as SplendorPlayerView;
    const me = playerView.players[playerID];
    if (me === undefined) return legalActions[0]!;

    const buys = legalActions.filter((a) => a.event === "buyCard");
    if (buys.length > 0) {
      const ranked = buys
        .map((a) => ({ action: a, score: scoreBuy(a, playerView) }))
        .sort((a, b) => b.score - a.score);
      return ranked[0]!.action;
    }

    if (me.reservedCount < RESERVE_LIMIT) {
      const reserves = legalActions.filter((a) => a.event === "reserveCard");
      const tier3Reserves = reserves
        .map((a) => ({ action: a, score: scoreReserve(a, playerView) }))
        .filter((r) => r.score > 0)
        .sort((a, b) => b.score - a.score);
      if (tier3Reserves.length > 0) return tier3Reserves[0]!.action;
    }

    const takeThrees = legalActions.filter(
      (a) => a.event === "takeThreeGems" && (a.payload as TakeThreeArgs).colors.length === 3,
    );
    if (takeThrees.length > 0) {
      const ranked = takeThrees
        .map((a) => ({ action: a, score: scoreGemSet(a, playerView) }))
        .sort((a, b) => b.score - a.score);
      return ranked[0]!.action;
    }

    const takeTwos = legalActions.filter((a) => {
      if (a.event !== "takeTwoGems") return false;
      const color = (a.payload as TakeTwoArgs).color;
      // Skip colors where we already have plenty of bonuses.
      return playerView.bank[color] >= TAKE_TWO_MIN_PILE && me.bonuses[color] < 4;
    });
    if (takeTwos.length > 0) {
      const ranked: ScoredAction[] = takeTwos.map((a) => ({
        action: a,
        score: gemPriority(playerView, (a.payload as TakeTwoArgs).color),
      }));
      ranked.sort((a, b) => b.score - a.score);
      return ranked[0]!.action;
    }

    const fallbackTakes = legalActions.filter((a) => a.event === "takeThreeGems");
    if (fallbackTakes.length > 0) return fallbackTakes[0]!;

    return legalActions[0]!;
  },
});

function scoreBuy(action: LegalAction, view: SplendorPlayerView): number {
  const payload = action.payload as BuyCardArgs;
  const cardID = resolveBuyCardID(payload, view);
  if (cardID === null) return -1;
  const card = getCard(cardID);
  // Higher prestige beats higher tier; reserved buys edge out market on ties to free a slot.
  const reservedBonus = payload.source === "reserved" ? 0.5 : 0;
  return card.prestige * 10 + card.tier + reservedBonus;
}

function scoreReserve(action: LegalAction, view: SplendorPlayerView): number {
  const payload = action.payload as ReserveCardArgs;
  if (payload.tier !== 3) return 0;
  if (payload.source === "deck") return 1; // weak signal — blind reserve
  const tier = payload.tier as Tier;
  const slot = payload.slot ?? 0;
  const rowKey = `tier${tier}` as const;
  const cardID = view.market[rowKey][slot];
  if (cardID === null || cardID === undefined) return 0;
  const card = getCard(cardID);
  return card.prestige >= 4 ? card.prestige * 10 : 0;
}

function scoreGemSet(action: LegalAction, view: SplendorPlayerView): number {
  const colors = (action.payload as TakeThreeArgs).colors;
  let total = 0;
  for (const color of colors) total += gemPriority(view, color);
  return total;
}

function gemPriority(view: SplendorPlayerView, color: GemColor): number {
  // Prefer colors that appear in market-card costs and that we don't already
  // dominate via bonuses. Cheap, view-only signal.
  const me = view.players[view.myPlayerID ?? "0"];
  const haveBonus = me?.bonuses[color] ?? 0;
  let demand = 0;
  for (const tier of [1, 2, 3] as const) {
    const rowKey = `tier${tier}` as const;
    for (const cardID of view.market[rowKey]) {
      if (cardID === null) continue;
      const card = getCard(cardID);
      const need = card.cost[color] ?? 0;
      if (need > 0) demand += need;
    }
  }
  // Penalize colors already saturated with bonuses.
  return demand - haveBonus * 2;
}

function resolveBuyCardID(payload: BuyCardArgs, view: SplendorPlayerView): string | null {
  if (payload.source === "reserved") return payload.cardID ?? null;
  if (payload.source === "market") {
    const tier = payload.tier as Tier | undefined;
    const slot = payload.slot;
    if (tier === undefined || slot === undefined) return null;
    const rowKey = `tier${tier}` as const;
    return view.market[rowKey][slot] ?? null;
  }
  return null;
}
