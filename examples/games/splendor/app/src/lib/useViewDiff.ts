import * as React from "react";

import {
  CHIP_COLORS,
  GEM_COLORS,
  getCard,
  type ChipColor,
  type GemColor,
  type SplendorPlayerID,
  type SplendorPlayerView,
  type Tier,
} from "@openturn/example-splendor-game";

export interface ChipMove {
  playerID: SplendorPlayerID;
  color: ChipColor;
  delta: number;
}

export interface CardBought {
  cardID: string;
  buyerID: SplendorPlayerID;
  source: "market" | "reserved";
  tier: Tier;
  bonus: GemColor;
  fromSlot: { tier: Tier; slot: number } | "reserved";
}

export interface ViewDiffEvents {
  onChipsGained?: (moves: readonly ChipMove[]) => void;
  onChipsReturned?: (moves: readonly ChipMove[]) => void;
  onCardBought?: (event: CardBought) => void;
}

/**
 * Diff successive `SplendorPlayerView` snapshots and emit higher-level events
 * (chip flow, card purchase) for the FlightOverlay to render.
 */
export function useViewDiff(view: SplendorPlayerView, events: ViewDiffEvents): void {
  const prevRef = React.useRef<SplendorPlayerView | null>(null);
  const eventsRef = React.useRef(events);
  eventsRef.current = events;

  React.useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = view;
    if (prev === null) return;

    const gained: ChipMove[] = [];
    const returned: ChipMove[] = [];

    for (const playerID of view.seatOrder) {
      const before = prev.players[playerID];
      const after = view.players[playerID];
      if (before === undefined || after === undefined) continue;

      for (const color of CHIP_COLORS) {
        const delta = after.chips[color] - before.chips[color];
        if (delta > 0) gained.push({ playerID, color, delta });
        else if (delta < 0) returned.push({ playerID, color, delta: -delta });
      }

      for (const color of GEM_COLORS) {
        const bDelta = after.bonuses[color] - before.bonuses[color];
        if (bDelta <= 0) continue;
        const fromMarket = findRemovedMarketCard(prev, view, color);
        if (fromMarket !== null) {
          eventsRef.current.onCardBought?.({
            cardID: fromMarket.cardID,
            buyerID: playerID,
            source: "market",
            tier: fromMarket.tier,
            bonus: color,
            fromSlot: { tier: fromMarket.tier, slot: fromMarket.slot },
          });
          continue;
        }
        const fromReserved = findRemovedReservedCard(before.reservedCards, after.reservedCards);
        if (fromReserved !== null) {
          eventsRef.current.onCardBought?.({
            cardID: fromReserved.cardID,
            buyerID: playerID,
            source: "reserved",
            tier: fromReserved.tier,
            bonus: color,
            fromSlot: "reserved",
          });
        }
      }
    }

    if (gained.length > 0) eventsRef.current.onChipsGained?.(gained);
    if (returned.length > 0) eventsRef.current.onChipsReturned?.(returned);
  }, [view]);
}

function findRemovedMarketCard(
  prev: SplendorPlayerView,
  curr: SplendorPlayerView,
  bonus: GemColor,
): { cardID: string; tier: Tier; slot: number } | null {
  for (const tier of [1, 2, 3] as const) {
    const rowKey = `tier${tier}` as const;
    const before = prev.market[rowKey];
    const after = curr.market[rowKey];
    for (let slot = 0; slot < before.length; slot += 1) {
      const beforeID = before[slot];
      const afterID = after[slot];
      if (beforeID === null || beforeID === undefined) continue;
      if (afterID === beforeID) continue;
      if (getCard(beforeID).bonus === bonus) return { cardID: beforeID, tier, slot };
    }
  }
  return null;
}

function findRemovedReservedCard(
  before: readonly string[],
  after: readonly string[],
): { cardID: string; tier: Tier } | null {
  const afterSet = new Set(after);
  for (const id of before) {
    if (!afterSet.has(id)) return { cardID: id, tier: getCard(id).tier };
  }
  return null;
}
