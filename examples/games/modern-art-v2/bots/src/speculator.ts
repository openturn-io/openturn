import { defineBot, simulate, type LegalAction } from "@openturn/bot";
import {
  ARTIST_TOTAL_CARDS,
  PAYOUT_TOP_3,
  enumerateModernArtLegalActions,
  getPainting,
  modernArt,
  rankArtists,
  type Artist,
  type ModernArtPlayerID,
  type ModernArtPlayerView,
  type ModernArtState,
} from "@openturn/example-modern-art-v2-game";

type ModernArtGame = typeof modernArt;

/**
 * Speculator bot: a strategic player that combines forward valuation with
 * rarity-weighting. It projects each artist's round-end value (including a
 * rarity premium for scarce artists), refuses to bid above expected resale,
 * and when auctioning prefers to play artists it owns many of (to push them
 * into the top-3 payout tier). Uses `simulate` to sanity-check bids.
 */
export const speculatorBot = defineBot<ModernArtGame>({
  name: "speculator",
  actionDelayMs: 1_600,
  enumerate({ snapshot, playerID }) {
    if (snapshot === null) return [];
    return enumerateModernArtLegalActions(
      snapshot.G as ModernArtState,
      playerID as ModernArtPlayerID,
      snapshot.position.turn - 1,
    );
  },
  decide({ legalActions, view, playerID, snapshot, rng }) {
    if (legalActions.length === 0) {
      throw new Error("speculatorBot: no legal actions available");
    }
    const v = view as ModernArtPlayerView;
    const me = playerID as ModernArtPlayerID;
    const projected = projectValuesWithRarity(v);

    // Score each action; tiebreak with the forked rng for variety.
    const scored = legalActions.map((a) => ({
      action: a,
      score: scoreAction(a, v, me, projected) + rng.next() * 0.5,
    }));
    scored.sort((a, b) => b.score - a.score);

    // For high-stakes bids, sanity-check the top candidate via simulate: if
    // it would leave us broke with no painting, fall back to pass.
    const top = scored[0]!;
    if ((top.action.event === "placeBid" || top.action.event === "sealBid") && snapshot !== null) {
      const sim = simulate(modernArt, snapshot as never, playerID as never, top.action);
      if (!sim.ok) {
        // If the top bid is illegal for some reason, fall back to pass.
        const fallback = legalActions.find(
          (a) => a.event === "passBid" || a.event === "declineFixed",
        );
        if (fallback !== undefined) return fallback;
      }
    }
    return top.action;
  },
});

/**
 * Projected round-end value per artist, with a rarity premium: rarer artists
 * (fewer total cards) are slightly over-valued because they're harder to push
 * into the top-3, so when they ARE there, their payout is more reliable.
 */
function projectValuesWithRarity(v: ModernArtPlayerView): Record<Artist, number> {
  const ranked = rankArtists(v.countsSold);
  const out: Record<Artist, number> = { ...v.cumulativeValue };
  for (const r of ranked) {
    if (r.sold === 0) continue;
    if (r.rank >= 1 && r.rank <= PAYOUT_TOP_3.length) {
      const rarityBonus = (16 - ARTIST_TOTAL_CARDS[r.artist]) * 0.5;
      out[r.artist] = (out[r.artist] ?? 0) + PAYOUT_TOP_3[r.rank - 1]! + rarityBonus;
    }
  }
  return out;
}

function scoreAction(
  action: LegalAction,
  v: ModernArtPlayerView,
  me: ModernArtPlayerID,
  projected: Record<Artist, number>,
): number {
  const meData = v.players[me];
  if (meData === undefined) return -1;

  switch (action.event) {
    case "startAuction": {
      const payload = action.payload as { paintingId: string; doublePaintingId?: string };
      const painting = getPainting(payload.paintingId);
      const artistValue = projected[painting.artist] ?? 0;
      const own = meData.collection[painting.artist] ?? 0;
      // Strongly prefer playing artists we own (synergy) and that project well.
      let score = artistValue * 1.1 + own * 8;
      // Penalize playing artists opponents dominate (helps them, not us).
      let oppMax = 0;
      for (const id of v.seatOrder) {
        if (id === me) continue;
        oppMax = Math.max(oppMax, v.players[id]?.collection[painting.artist] ?? 0);
      }
      score -= oppMax * 4;
      if (payload.doublePaintingId !== undefined) score += 4;
      return score;
    }
    case "placeBid": {
      const amount = (action.payload as { amount: number }).amount;
      const artist = v.auction?.artist ?? "krypto";
      const artistValue = projected[artist] ?? 0;
      const paintings = v.auction?.paintings.length ?? 1;
      const resale = artistValue * paintings;
      const profit = resale - amount;
      // Never bid above resale; reward profitable bids proportionally.
      if (profit <= 0) return -200;
      // Keep a cash reserve: penalize bids that would leave us broke.
      const reserve = meData.money - amount;
      const reservePenalty = reserve < 20 ? (20 - reserve) * 2 : 0;
      return profit - reservePenalty;
    }
    case "sealBid": {
      const amount = (action.payload as { amount: number }).amount;
      const artist = v.auction?.artist ?? "krypto";
      const artistValue = projected[artist] ?? 0;
      const paintings = v.auction?.paintings.length ?? 1;
      const resale = artistValue * paintings;
      const profit = resale - amount;
      if (profit <= 0) return -100;
      // Sealed bids win more often with a slight inflation; reward mid-range.
      return profit * 0.9;
    }
    case "buyFixed": {
      const price = v.auction?.fixedPrice ?? 0;
      const artist = v.auction?.artist ?? "krypto";
      const artistValue = projected[artist] ?? 0;
      const profit = artistValue - price;
      if (profit <= 0) return -100;
      return profit;
    }
    case "setFixedPrice": {
      const price = (action.payload as { price: number }).price;
      const artist = v.auction?.artist ?? "krypto";
      const artistValue = projected[artist] ?? 0;
      // Set just under the projected value so a buyer is likely to take it,
      // extracting near-maximum profit for us as the auctioneer.
      const target = Math.max(1, Math.floor(artistValue * 0.9));
      return price === target ? 20 : -Math.abs(price - target);
    }
    case "skipTurn":
      return -2000;
    case "passBid":
    case "declineFixed":
    default:
      return -20;
  }
}

void (null as unknown as Artist);
