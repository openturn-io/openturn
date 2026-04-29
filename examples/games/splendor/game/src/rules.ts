import { getCard, getNoble } from "./data";
import {
  CHIP_COLORS,
  GEM_COLORS,
  type Card,
  type ChipColor,
  type GemBag,
  type GemColor,
  type PlayerData,
} from "./state";

export function totalChips(player: PlayerData): number {
  let total = 0;
  for (const color of CHIP_COLORS) total += player.chips[color];
  return total;
}

export function totalGemBag(bag: GemBag): number {
  let total = 0;
  for (const color of GEM_COLORS) total += bag[color] ?? 0;
  return total;
}

/** True iff the player can pay for the card using bonuses + chips + gold. */
export function canAfford(player: PlayerData, card: Card): boolean {
  let goldNeeded = 0;
  for (const color of GEM_COLORS) {
    const required = card.cost[color] ?? 0;
    if (required === 0) continue;
    const fromBonus = player.bonuses[color];
    const remaining = required - fromBonus;
    if (remaining <= 0) continue;
    const fromChips = player.chips[color];
    const shortfall = remaining - fromChips;
    if (shortfall > 0) goldNeeded += shortfall;
  }
  return goldNeeded <= player.chips.gold;
}

/** Compute the per-color (and gold) chip spend to buy `card`. Assumes affordability. */
export function payment(player: PlayerData, card: Card): Record<ChipColor, number> {
  const out: Record<ChipColor, number> = {
    white: 0, blue: 0, green: 0, red: 0, black: 0, gold: 0,
  };
  let goldUsed = 0;
  for (const color of GEM_COLORS) {
    const required = card.cost[color] ?? 0;
    if (required === 0) continue;
    const fromBonus = Math.min(player.bonuses[color], required);
    const remaining = required - fromBonus;
    if (remaining <= 0) continue;
    const fromChips = Math.min(player.chips[color], remaining);
    out[color] = fromChips;
    const shortfall = remaining - fromChips;
    if (shortfall > 0) goldUsed += shortfall;
  }
  out.gold = goldUsed;
  return out;
}

/** Nobles whose bonus requirements are met by the player's current bonuses. */
export function eligibleNobles(player: PlayerData, nobleIDs: readonly string[]): string[] {
  const eligible: string[] = [];
  for (const id of nobleIDs) {
    const noble = getNoble(id);
    let qualifies = true;
    for (const color of GEM_COLORS) {
      const required = noble.requires[color] ?? 0;
      if (required === 0) continue;
      if (player.bonuses[color] < required) {
        qualifies = false;
        break;
      }
    }
    if (qualifies) eligible.push(id);
  }
  return eligible;
}

export function applyBonus(player: PlayerData, card: Card): PlayerData {
  return {
    ...player,
    bonuses: {
      ...player.bonuses,
      [card.bonus]: player.bonuses[card.bonus] + 1,
    },
    score: player.score + card.prestige,
  };
}

export function spendChips(
  player: PlayerData,
  spend: Record<ChipColor, number>,
): PlayerData {
  const next: Record<ChipColor, number> = { ...player.chips };
  for (const color of CHIP_COLORS) {
    next[color] = next[color] - spend[color];
  }
  return { ...player, chips: next };
}

export function takeChips(
  player: PlayerData,
  taken: Partial<Record<ChipColor, number>>,
): PlayerData {
  const next: Record<ChipColor, number> = { ...player.chips };
  for (const color of CHIP_COLORS) {
    next[color] = next[color] + (taken[color] ?? 0);
  }
  return { ...player, chips: next };
}

export function returnChipsToBank(
  bank: Record<ChipColor, number>,
  spend: Record<ChipColor, number>,
): Record<ChipColor, number> {
  const next = { ...bank };
  for (const color of CHIP_COLORS) {
    next[color] = next[color] + spend[color];
  }
  return next;
}

export function takeChipsFromBank(
  bank: Record<ChipColor, number>,
  taken: Partial<Record<ChipColor, number>>,
): Record<ChipColor, number> {
  const next = { ...bank };
  for (const color of CHIP_COLORS) {
    next[color] = next[color] - (taken[color] ?? 0);
  }
  return next;
}

export function describeCardCost(card: Card): string {
  const parts: string[] = [];
  for (const color of GEM_COLORS) {
    const v = card.cost[color] ?? 0;
    if (v > 0) parts.push(`${v}${color[0]!.toUpperCase()}`);
  }
  return parts.join("·");
}

export function describeCard(cardID: string): string {
  const card = getCard(cardID);
  return `${card.bonus} ${card.tier} (${card.prestige}p ${describeCardCost(card)})`;
}

export function describeNoble(nobleID: string): string {
  const noble = getNoble(nobleID);
  return noble.name;
}

/**
 * Rank seated players for the tiebreak when the game ends. Highest score wins;
 * ties go to fewer development cards purchased (= fewer total bonuses).
 */
export function pickWinner<TID extends string>(
  players: Record<TID, PlayerData>,
  seatOrder: readonly TID[],
): TID {
  let best = seatOrder[0]!;
  for (const id of seatOrder.slice(1)) {
    const here = players[id];
    const there = players[best];
    if (here.score > there.score) {
      best = id;
      continue;
    }
    if (here.score === there.score) {
      const hereCards = totalBonuses(here);
      const thereCards = totalBonuses(there);
      if (hereCards < thereCards) best = id;
    }
  }
  return best;
}

export function totalBonuses(player: PlayerData): number {
  let total = 0;
  for (const color of GEM_COLORS) total += player.bonuses[color];
  return total;
}
