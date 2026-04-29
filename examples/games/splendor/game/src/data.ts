import type { Card, GemBag, GemColor, Noble } from "./state";

// ---------------------------------------------------------------------------
// Splendor-faithful card distribution: 40 / 30 / 20 development cards across
// 5 colors + 10 nobles. Costs and prestige follow the published patterns:
//   tier 1 — prestige 0–1, total cost 3–5
//   tier 2 — prestige 1–3, total cost 5–10
//   tier 3 — prestige 3–5, total cost 9–14
// ---------------------------------------------------------------------------

const COLORS: readonly GemColor[] = ["white", "blue", "green", "red", "black"];

interface CardSpec {
  prestige: number;
  cost: GemBag;
}

// 8 unique specs per tier-1 color (40 total).
const TIER_1_SPECS_BY_COLOR: Record<GemColor, readonly CardSpec[]> = {
  // Cards yielding +1 white bonus: pay other colors.
  white: [
    { prestige: 0, cost: { blue: 1, green: 1, red: 1, black: 1 } },
    { prestige: 0, cost: { blue: 1, green: 2, red: 1, black: 1 } },
    { prestige: 0, cost: { blue: 2, green: 2, black: 1 } },
    { prestige: 0, cost: { red: 2, black: 1 } },
    { prestige: 0, cost: { green: 1, red: 2, black: 2 } },
    { prestige: 0, cost: { white: 0, blue: 0, green: 0, red: 0, black: 3 } },
    { prestige: 0, cost: { blue: 1, black: 2 } },
    { prestige: 1, cost: { blue: 4 } },
  ],
  blue: [
    { prestige: 0, cost: { white: 1, green: 1, red: 1, black: 1 } },
    { prestige: 0, cost: { white: 1, green: 1, red: 2, black: 1 } },
    { prestige: 0, cost: { white: 1, green: 2, black: 2 } },
    { prestige: 0, cost: { green: 2, black: 2 } },
    { prestige: 0, cost: { white: 0, green: 0, red: 1, black: 2 } },
    { prestige: 0, cost: { black: 3 } },
    { prestige: 0, cost: { white: 1, black: 1 } },
    { prestige: 1, cost: { red: 4 } },
  ],
  green: [
    { prestige: 0, cost: { white: 1, blue: 1, red: 1, black: 1 } },
    { prestige: 0, cost: { white: 1, blue: 1, red: 1, black: 2 } },
    { prestige: 0, cost: { blue: 1, red: 2, black: 2 } },
    { prestige: 0, cost: { blue: 2, red: 2 } },
    { prestige: 0, cost: { white: 2, blue: 1 } },
    { prestige: 0, cost: { blue: 3 } },
    { prestige: 0, cost: { red: 2, black: 1 } },
    { prestige: 1, cost: { black: 4 } },
  ],
  red: [
    { prestige: 0, cost: { white: 1, blue: 1, green: 1, black: 1 } },
    { prestige: 0, cost: { white: 2, blue: 1, green: 1, black: 1 } },
    { prestige: 0, cost: { white: 2, blue: 2, green: 1 } },
    { prestige: 0, cost: { white: 2, green: 2 } },
    { prestige: 0, cost: { white: 1, black: 2 } },
    { prestige: 0, cost: { white: 3 } },
    { prestige: 0, cost: { white: 1, blue: 2 } },
    { prestige: 1, cost: { white: 4 } },
  ],
  black: [
    { prestige: 0, cost: { white: 1, blue: 1, green: 1, red: 1 } },
    { prestige: 0, cost: { white: 1, blue: 2, green: 1, red: 1 } },
    { prestige: 0, cost: { white: 2, blue: 2, red: 1 } },
    { prestige: 0, cost: { green: 2, red: 1 } },
    { prestige: 0, cost: { blue: 1, green: 2 } },
    { prestige: 0, cost: { green: 3 } },
    { prestige: 0, cost: { green: 1, red: 2 } },
    { prestige: 1, cost: { green: 4 } },
  ],
};

// 6 unique specs per tier-2 color (30 total).
const TIER_2_SPECS_BY_COLOR: Record<GemColor, readonly CardSpec[]> = {
  white: [
    { prestige: 1, cost: { green: 3, red: 2, black: 2 } },
    { prestige: 1, cost: { white: 2, blue: 3, red: 3 } },
    { prestige: 2, cost: { green: 1, red: 4, black: 2 } },
    { prestige: 2, cost: { red: 5, black: 3 } },
    { prestige: 2, cost: { red: 5 } },
    { prestige: 3, cost: { white: 6 } },
  ],
  blue: [
    { prestige: 1, cost: { blue: 2, green: 2, red: 3 } },
    { prestige: 1, cost: { blue: 2, green: 3, black: 3 } },
    { prestige: 2, cost: { white: 5, blue: 3 } },
    { prestige: 2, cost: { white: 2, red: 1, black: 4 } },
    { prestige: 2, cost: { blue: 5 } },
    { prestige: 3, cost: { blue: 6 } },
  ],
  green: [
    { prestige: 1, cost: { white: 3, green: 2, red: 3 } },
    { prestige: 1, cost: { white: 2, blue: 3, black: 2 } },
    { prestige: 2, cost: { white: 4, blue: 2, black: 1 } },
    { prestige: 2, cost: { blue: 5, green: 3 } },
    { prestige: 2, cost: { green: 5 } },
    { prestige: 3, cost: { green: 6 } },
  ],
  red: [
    { prestige: 1, cost: { white: 2, red: 2, black: 3 } },
    { prestige: 1, cost: { blue: 3, red: 2, black: 3 } },
    { prestige: 2, cost: { white: 1, blue: 4, green: 2 } },
    { prestige: 2, cost: { black: 5, red: 3 } },
    { prestige: 2, cost: { black: 5 } },
    { prestige: 3, cost: { red: 6 } },
  ],
  black: [
    { prestige: 1, cost: { white: 3, green: 3, blue: 2 } },
    { prestige: 1, cost: { white: 3, green: 2, black: 2 } },
    { prestige: 2, cost: { green: 5, red: 3 } },
    { prestige: 2, cost: { white: 1, green: 4, blue: 2 } },
    { prestige: 2, cost: { white: 5 } },
    { prestige: 3, cost: { black: 6 } },
  ],
};

// 4 unique specs per tier-3 color (20 total).
const TIER_3_SPECS_BY_COLOR: Record<GemColor, readonly CardSpec[]> = {
  white: [
    { prestige: 3, cost: { blue: 3, green: 3, red: 5, black: 3 } },
    { prestige: 4, cost: { black: 7 } },
    { prestige: 4, cost: { white: 3, black: 6, red: 3 } },
    { prestige: 5, cost: { white: 3, black: 7 } },
  ],
  blue: [
    { prestige: 3, cost: { white: 3, green: 3, red: 3, black: 5 } },
    { prestige: 4, cost: { white: 7 } },
    { prestige: 4, cost: { white: 6, blue: 3, black: 3 } },
    { prestige: 5, cost: { white: 7, blue: 3 } },
  ],
  green: [
    { prestige: 3, cost: { white: 5, blue: 3, red: 3, black: 3 } },
    { prestige: 4, cost: { blue: 7 } },
    { prestige: 4, cost: { white: 3, blue: 6, green: 3 } },
    { prestige: 5, cost: { blue: 7, green: 3 } },
  ],
  red: [
    { prestige: 3, cost: { white: 3, blue: 5, green: 3, black: 3 } },
    { prestige: 4, cost: { green: 7 } },
    { prestige: 4, cost: { blue: 3, green: 6, red: 3 } },
    { prestige: 5, cost: { green: 7, red: 3 } },
  ],
  black: [
    { prestige: 3, cost: { white: 3, blue: 3, green: 5, red: 3 } },
    { prestige: 4, cost: { red: 7 } },
    { prestige: 4, cost: { green: 3, red: 6, black: 3 } },
    { prestige: 5, cost: { red: 7, black: 3 } },
  ],
};

function buildCards(
  tier: 1 | 2 | 3,
  byColor: Record<GemColor, readonly CardSpec[]>,
): Card[] {
  const cards: Card[] = [];
  for (const color of COLORS) {
    const specs = byColor[color];
    for (let i = 0; i < specs.length; i++) {
      const spec = specs[i]!;
      const cost: GemBag = {};
      for (const [k, v] of Object.entries(spec.cost) as [GemColor, number][]) {
        if (v > 0) cost[k] = v;
      }
      cards.push({
        id: `t${tier}-${color}-${(i + 1).toString().padStart(2, "0")}`,
        tier,
        bonus: color,
        prestige: spec.prestige,
        cost,
      });
    }
  }
  return cards;
}

export const TIER_1_CARDS: readonly Card[] = buildCards(1, TIER_1_SPECS_BY_COLOR);
export const TIER_2_CARDS: readonly Card[] = buildCards(2, TIER_2_SPECS_BY_COLOR);
export const TIER_3_CARDS: readonly Card[] = buildCards(3, TIER_3_SPECS_BY_COLOR);

export const ALL_CARDS: readonly Card[] = [
  ...TIER_1_CARDS,
  ...TIER_2_CARDS,
  ...TIER_3_CARDS,
];

export const CARD_BY_ID: ReadonlyMap<string, Card> = new Map(
  ALL_CARDS.map((card) => [card.id, card]),
);

export function getCard(id: string): Card {
  const card = CARD_BY_ID.get(id);
  if (card === undefined) {
    throw new Error(`unknown card id: ${id}`);
  }
  return card;
}

// 10 noble tiles, all prestige 3, with two- or three-color bonus requirements.
export const NOBLES: readonly Noble[] = [
  { id: "n-machiavelli", name: "Niccolò Machiavelli", prestige: 3, requires: { white: 4, blue: 4 } },
  { id: "n-elizabeth", name: "Queen Elizabeth", prestige: 3, requires: { blue: 4, green: 4 } },
  { id: "n-suleiman", name: "Suleiman the Magnificent", prestige: 3, requires: { green: 4, red: 4 } },
  { id: "n-charles", name: "Charles V", prestige: 3, requires: { red: 4, black: 4 } },
  { id: "n-anne", name: "Anne of Brittany", prestige: 3, requires: { white: 4, black: 4 } },
  { id: "n-henry", name: "Henry VIII", prestige: 3, requires: { white: 3, blue: 3, green: 3 } },
  { id: "n-catherine", name: "Catherine de Medici", prestige: 3, requires: { blue: 3, green: 3, red: 3 } },
  { id: "n-isabella", name: "Isabella of Castile", prestige: 3, requires: { green: 3, red: 3, black: 3 } },
  { id: "n-francis", name: "Francis I", prestige: 3, requires: { white: 3, red: 3, black: 3 } },
  { id: "n-mary", name: "Mary Stuart", prestige: 3, requires: { white: 3, blue: 3, black: 3 } },
];

export const NOBLE_BY_ID: ReadonlyMap<string, Noble> = new Map(
  NOBLES.map((noble) => [noble.id, noble]),
);

export function getNoble(id: string): Noble {
  const noble = NOBLE_BY_ID.get(id);
  if (noble === undefined) {
    throw new Error(`unknown noble id: ${id}`);
  }
  return noble;
}
