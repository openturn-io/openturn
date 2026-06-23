import { ARTISTS, PAYOUT_TOP_3, ROUND_END_THRESHOLD, type Artist, type PlayerData } from "./state";

/**
 * Has the round ended? The round ends the moment a 5th painting of any single
 * artist is *put up* for auction — that 5th painting is not auctioned off.
 *
 * Callers pass `additionalSold` = the artist counts that would result from the
 * painting(s) currently being put up (before they are paid for). If any artist
 * reaches ROUND_END_THRESHOLD, the round is over.
 */
export function roundWouldEnd(counts: Record<Artist, number>): boolean {
  for (const artist of ARTISTS) {
    if (counts[artist] >= ROUND_END_THRESHOLD) return true;
  }
  return false;
}

export interface RankedArtist {
  artist: Artist;
  sold: number;
  rank: number; // 1-based; 0 if unranked (outside top 3)
}

/**
 * Rank artists by paintings sold this round. Ties broken in favor of the
 * rarer artist (rarity = fewer total cards = later in ARTISTS). Returns
 * positions 1..N; only the top 3 carry a payout.
 */
export function rankArtists(countsSold: Record<Artist, number>): readonly RankedArtist[] {
  const entries = ARTISTS.map((artist) => ({ artist, sold: countsSold[artist] }));
  // Sort: more sold first; tie → rarer artist (higher ARTISTS index) first.
  entries.sort((a, b) => {
    if (b.sold !== a.sold) return b.sold - a.sold;
    return ARTISTS.indexOf(b.artist) - ARTISTS.indexOf(a.artist);
  });
  return entries.map((e, i) => ({
    artist: e.artist,
    sold: e.sold,
    rank: i + 1,
  }));
}

/**
 * Compute the new cumulative per-artist value after a round, given the sales
 * counts. Top-3 artists gain 30/20/10 respectively (stacking on prior value).
 * Artists with zero sales keep their prior cumulative value (they were never
 * ranked, so no payout is added, but a prior round's value persists).
 */
export function computeCumulativeValues(
  prior: Record<Artist, number>,
  countsSold: Record<Artist, number>,
): Record<Artist, number> {
  const next = { ...prior };
  const ranked = rankArtists(countsSold);
  for (const r of ranked) {
    if (r.sold === 0) continue;
    if (r.rank >= 1 && r.rank <= PAYOUT_TOP_3.length) {
      next[r.artist] = (next[r.artist] ?? 0) + PAYOUT_TOP_3[r.rank - 1]!;
    }
  }
  return next;
}

/**
 * Award money to each player based on the NEW cumulative values and the
 * paintings in their collection. Returns a per-player payout map.
 */
export function scoreRound(
  players: Record<string, PlayerData>,
  cumulativeValue: Record<Artist, number>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, p] of Object.entries(players)) {
    let payout = 0;
    for (const artist of ARTISTS) {
      const owned = p.collection[artist] ?? 0;
      if (owned > 0) payout += owned * cumulativeValue[artist];
    }
    out[id] = payout;
  }
  return out;
}

/** Richest player wins. Ties → split (we still report a single winner: first in seat order among the tied). */
export function pickWealthiest(
  players: Record<string, PlayerData>,
  seatOrder: readonly string[],
): string {
  let best = seatOrder[0]!;
  let bestMoney = players[best]?.money ?? 0;
  for (const id of seatOrder.slice(1)) {
    const m = players[id]?.money ?? 0;
    if (m > bestMoney) {
      best = id;
      bestMoney = m;
    }
  }
  return best;
}
