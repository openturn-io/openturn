import { defineBot, type LegalAction } from "@openturn/bot";
import {
  ARTISTS,
  PAYOUT_TOP_3,
  enumerateModernArtLegalActions,
  getPainting,
  rankArtists,
  type Artist,
  type ModernArtPlayerID,
  type ModernArtPlayerView,
  type ModernArtState,
  type modernArt,
} from "@openturn/example-modern-art-v2-game";

type ModernArtGame = typeof modernArt;

/**
 * Collector bot: a heuristic player that estimates each artist's expected
 * payout value this round and bids up to that expected value for paintings it
 * doesn't yet own. When auctioning, it plays the card whose artist has the
 * best projected rank. Avoids bidding above resale value.
 */
export const collectorBot = defineBot<ModernArtGame>({
  name: "collector",
  actionDelayMs: 1_400,
  enumerate({ snapshot, playerID }) {
    if (snapshot === null) return [];
    return enumerateModernArtLegalActions(
      snapshot.G as ModernArtState,
      playerID as ModernArtPlayerID,
      snapshot.position.turn - 1,
    );
  },
  decide({ legalActions, view, playerID }) {
    if (legalActions.length === 0) {
      throw new Error("collectorBot: no legal actions available");
    }
    const v = view as ModernArtPlayerView;
    const me = playerID as ModernArtPlayerID;

    // Estimate each artist's value: cumulative + projected top-3 bonus.
    const projected = projectValues(v);

    const scored = legalActions.map((a) => ({ action: a, score: scoreAction(a, v, me, projected) }));
    scored.sort((a, b) => b.score - a.score);
    return scored[0]!.action;
  },
});

/**
 * Project the cumulative value of each artist at round end, assuming current
 * sales counts hold. Adds the top-3 payout (30/20/10) to the carryover.
 */
function projectValues(v: ModernArtPlayerView): Record<Artist, number> {
  const ranked = rankArtists(v.countsSold);
  const out: Record<Artist, number> = { ...v.cumulativeValue };
  for (const r of ranked) {
    if (r.sold === 0) continue;
    if (r.rank >= 1 && r.rank <= PAYOUT_TOP_3.length) {
      out[r.artist] = (out[r.artist] ?? 0) + PAYOUT_TOP_3[r.rank - 1]!;
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
      // Prefer playing cards of artists we own (to boost their rank) and that
      // have high projected value. Slight bonus for double auctions.
      const own = meData.collection[painting.artist] ?? 0;
      let score = artistValue + own * 5;
      if (payload.doublePaintingId !== undefined) score += 3;
      // Small random tiebreak injected via the label hash so equal-value cards
      // don't always pick the same one.
      return score;
    }
    case "placeBid": {
      const amount = (action.payload as { amount: number }).amount;
      const artist = v.auction?.artist ?? "krypto";
      const artistValue = projected[artist] ?? 0;
      // Expected profit if we win: the painting's value minus what we pay.
      // The painting is worth `artistValue` to us at round end (per painting).
      const paintings = v.auction?.paintings.length ?? 1;
      const resale = artistValue * paintings;
      const profit = resale - amount;
      // Bid only if positive expected profit; scale by profit magnitude.
      if (profit <= 0) return -100;
      return profit + amount * 0.01;
    }
    case "sealBid": {
      const amount = (action.payload as { amount: number }).amount;
      const artist = v.auction?.artist ?? "krypto";
      const artistValue = projected[artist] ?? 0;
      const paintings = v.auction?.paintings.length ?? 1;
      const resale = artistValue * paintings;
      const profit = resale - amount;
      if (profit <= 0) return -50;
      return profit;
    }
    case "buyFixed": {
      const price = v.auction?.fixedPrice ?? 0;
      const artist = v.auction?.artist ?? "krypto";
      const artistValue = projected[artist] ?? 0;
      const profit = artistValue - price;
      if (profit <= 0) return -50;
      return profit;
    }
    case "setFixedPrice": {
      const price = (action.payload as { price: number }).price;
      const artist = v.auction?.artist ?? "krypto";
      const artistValue = projected[artist] ?? 0;
      // Set a price near the artist's projected value to extract profit, but
      // not so high nobody buys.
      return price > 0 ? Math.min(price, artistValue) : 1;
    }
    case "skipTurn":
      return -1000;
    case "passBid":
    case "declineFixed":
    default:
      // Passing is better than overpaying but worse than a profitable bid.
      return -10;
  }
}

void (null as unknown as Artist);
void ARTISTS;
