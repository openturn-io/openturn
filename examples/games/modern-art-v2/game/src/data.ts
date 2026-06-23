import { ARTISTS, ARTIST_TOTAL_CARDS, type Artist, type AuctionType, type Painting } from "./state";

// ---------------------------------------------------------------------------
// 70-painting deck — 5 artists with the official rarity curve:
//   krypto 16, karlGitter 15, cristinP 14, yoko 13, liteMetal 12
//
// Each artist's cards are spread across the five auction symbols. The
// published deck does not publish an exact per-symbol breakdown, so this uses
// a balanced distribution that (a) totals each artist's count exactly and
// (b) gives every auction type meaningful representation. The rarity curve
// and the auction mechanics are what make the game; the per-symbol mix only
// shades strategy.
// ---------------------------------------------------------------------------

// Distribution of auction symbols per artist. Sums to the artist's card count.
// Ordered so that, read left-to-right, every artist has all five symbols
// present.
const SYMBOL_PLAN: Record<Artist, readonly [number, number, number, number, number]> = {
  //                 open sealed once  fixed double
  krypto:            [4,    3,    3,    3,    3], // 16
  karlGitter:        [3,    3,    3,    3,    3], // 15
  cristinP:          [3,    3,    3,    3,    2], // 14
  yoko:              [3,    3,    2,    3,    2], // 13
  liteMetal:         [3,    2,    2,    3,    2], // 12
};

const SYMBOL_ORDER: readonly AuctionType[] = ["open", "sealed", "once", "fixed", "double"];

function buildDeck(): readonly Painting[] {
  const out: Painting[] = [];
  for (const artist of ARTISTS) {
    const plan = SYMBOL_PLAN[artist];
    let serial = 0;
    for (let s = 0; s < SYMBOL_ORDER.length; s += 1) {
      const symbol = SYMBOL_ORDER[s]!;
      const count = plan[s]!;
      for (let i = 0; i < count; i += 1) {
        serial += 1;
        out.push({
          id: `${artist}-${String(serial).padStart(2, "0")}`,
          artist,
          auction: symbol,
        });
      }
    }
  }
  return out;
}

export const ALL_PAINTINGS: readonly Painting[] = buildDeck();

export const PAINTING_BY_ID: Record<string, Painting> = Object.fromEntries(
  ALL_PAINTINGS.map((p) => [p.id, p]),
);

export function getPainting(id: string): Painting {
  const p = PAINTING_BY_ID[id];
  if (p === undefined) {
    throw new Error(`Unknown painting id: ${id}`);
  }
  return p;
}

export const ALL_PAINTING_IDS: readonly string[] = ALL_PAINTINGS.map((p) => p.id);

// Sanity: the deck must total 70 and match each artist's rarity.
let _deckChecked = false;
export function _checkDeck(): void {
  if (_deckChecked) return;
  _deckChecked = true;
  const totals: Record<Artist, number> = { krypto: 0, karlGitter: 0, cristinP: 0, yoko: 0, liteMetal: 0 };
  for (const p of ALL_PAINTINGS) totals[p.artist] += 1;
  for (const artist of ARTISTS) {
    if (totals[artist] !== ARTIST_TOTAL_CARDS[artist]) {
      throw new Error(
        `Deck mismatch for ${artist}: have ${totals[artist]}, expected ${ARTIST_TOTAL_CARDS[artist]}`,
      );
    }
  }
  if (ALL_PAINTINGS.length !== 70) {
    throw new Error(`Deck size ${ALL_PAINTINGS.length} != 70`);
  }
}
_checkDeck();
