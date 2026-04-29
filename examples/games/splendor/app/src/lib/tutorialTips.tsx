import * as React from "react";

import {
  GEM_COLORS,
  TAKE_TWO_MIN_PILE,
  type Card,
  type ChipColor,
  type GemColor,
  type Noble,
  type SplendorPlayerView,
  type Tier,
} from "@openturn/example-splendor-game";

const COLOR_LABEL: Record<ChipColor, string> = {
  white: "white",
  blue: "blue",
  green: "green",
  red: "red",
  black: "black",
  gold: "gold",
};

function TipTitle({ children }: { children: React.ReactNode }) {
  return (
    <p className="m-0 mb-0.5 text-[10px] uppercase tracking-[0.2em] text-amber-200/90">
      {children}
    </p>
  );
}

function TipBody({ children }: { children: React.ReactNode }) {
  return <p className="m-0 text-[11px] text-amber-50/95">{children}</p>;
}

interface BankChipTipArgs {
  color: ChipColor;
  pileCount: number;
  isMyTurn: boolean;
  mustDiscard: number;
  finished: boolean;
  selected: boolean;
  selectionLength: number;
}

/** Tip shown when hovering the chip token in the bank well. */
export function bankChipTip({
  color,
  pileCount,
  isMyTurn,
  mustDiscard,
  finished,
  selected,
  selectionLength,
}: BankChipTipArgs): React.ReactNode {
  if (color === "gold") {
    return (
      <>
        <TipTitle>Gold (wild)</TipTitle>
        <TipBody>
          Wildcards used like any color when buying cards. You earn one gold each time you reserve a card (if any remain in the bank).
        </TipBody>
      </>
    );
  }
  if (finished) {
    return (
      <>
        <TipTitle>Game over</TipTitle>
        <TipBody>The match has ended.</TipBody>
      </>
    );
  }
  if (!isMyTurn) {
    return (
      <>
        <TipTitle>Wait your turn</TipTitle>
        <TipBody>Taking chips is a turn action — it isn't your turn yet.</TipBody>
      </>
    );
  }
  if (mustDiscard > 0) {
    return (
      <>
        <TipTitle>Over the chip cap</TipTitle>
        <TipBody>
          You're carrying more than 10 chips. Return {mustDiscard} chip{mustDiscard === 1 ? "" : "s"} below before taking more.
        </TipBody>
      </>
    );
  }
  if (pileCount === 0) {
    return (
      <>
        <TipTitle>Empty pile</TipTitle>
        <TipBody>No {COLOR_LABEL[color]} chips left in the bank.</TipBody>
      </>
    );
  }
  if (selected) {
    return (
      <>
        <TipTitle>Selected</TipTitle>
        <TipBody>Click to deselect, or pick another color and confirm “Take”.</TipBody>
      </>
    );
  }
  if (selectionLength >= 3) {
    return (
      <>
        <TipTitle>Three already chosen</TipTitle>
        <TipBody>A Take 3 may include at most three different colors. Confirm or clear to change.</TipBody>
      </>
    );
  }
  return (
    <>
      <TipTitle>Take 3 different</TipTitle>
      <TipBody>
        Add {COLOR_LABEL[color]} to your selection. Pick up to 3 distinct colors, then press Take to confirm.
      </TipBody>
    </>
  );
}

interface TakeTwoTipArgs {
  color: ChipColor;
  pileCount: number;
  isMyTurn: boolean;
  mustDiscard: number;
  finished: boolean;
  selectionLength: number;
}

export function takeTwoTip({
  color,
  pileCount,
  isMyTurn,
  mustDiscard,
  finished,
  selectionLength,
}: TakeTwoTipArgs): React.ReactNode {
  if (finished) return null;
  if (!isMyTurn) {
    return (
      <>
        <TipTitle>Wait your turn</TipTitle>
        <TipBody>Take 2 of one color is a turn action.</TipBody>
      </>
    );
  }
  if (mustDiscard > 0) {
    return (
      <>
        <TipTitle>Over the chip cap</TipTitle>
        <TipBody>Return chips first before taking more.</TipBody>
      </>
    );
  }
  if (selectionLength > 0) {
    return (
      <>
        <TipTitle>Clear selection first</TipTitle>
        <TipBody>You're mid–Take 3. Clear those picks to switch to Take 2.</TipBody>
      </>
    );
  }
  if (pileCount < TAKE_TWO_MIN_PILE) {
    return (
      <>
        <TipTitle>Pile too small</TipTitle>
        <TipBody>
          You can only take 2 of a color when its pile has at least {TAKE_TWO_MIN_PILE} chips (this pile has {pileCount}).
        </TipBody>
      </>
    );
  }
  return (
    <>
      <TipTitle>Take 2 of one color</TipTitle>
      <TipBody>
        Take both {COLOR_LABEL[color]} chips as your turn. Use this instead of Take 3 different when one color is plentiful.
      </TipBody>
    </>
  );
}

interface ConfirmTakeTipArgs {
  selectionLength: number;
  isMyTurn: boolean;
  mustDiscard: number;
}

export function confirmTakeTip({
  selectionLength,
  isMyTurn,
  mustDiscard,
}: ConfirmTakeTipArgs): React.ReactNode {
  if (!isMyTurn) return "Not your turn yet.";
  if (mustDiscard > 0) return "Resolve your discard first.";
  if (selectionLength === 0) return null;
  return (
    <>
      <TipTitle>Confirm</TipTitle>
      <TipBody>
        Take {selectionLength} chip{selectionLength === 1 ? "" : "s"} of different colors. Ends your turn.
      </TipBody>
    </>
  );
}

interface MarketCardTipArgs {
  card: Card;
  view: SplendorPlayerView;
  isMyTurn: boolean;
  mustDiscard: number;
  finished: boolean;
}

/** Tip shown when hovering a face-up market card. */
export function marketCardTip({
  card,
  view,
  isMyTurn,
  mustDiscard,
  finished,
}: MarketCardTipArgs): React.ReactNode {
  const me = view.myPlayerID === null ? null : view.players[view.myPlayerID] ?? null;
  const tierLabel = card.tier === 1 ? "I" : card.tier === 2 ? "II" : "III";

  if (finished) {
    return (
      <>
        <TipTitle>Game over</TipTitle>
        <CardSummary card={card} tierLabel={tierLabel} />
      </>
    );
  }
  if (me === null) {
    return (
      <>
        <TipTitle>Spectating</TipTitle>
        <CardSummary card={card} tierLabel={tierLabel} />
      </>
    );
  }
  if (!isMyTurn) {
    return (
      <>
        <TipTitle>Card preview</TipTitle>
        <CardSummary card={card} tierLabel={tierLabel} />
        <TipBody>Wait for your turn to buy or reserve.</TipBody>
      </>
    );
  }
  if (mustDiscard > 0) {
    return (
      <>
        <TipTitle>Discard first</TipTitle>
        <TipBody>You're over the 10-chip cap. Return chips before buying.</TipBody>
      </>
    );
  }

  const shortfall = computeShortfall(me.chips, me.bonuses, card.cost);
  if (shortfall.totalShort > 0) {
    return (
      <>
        <TipTitle>Can't afford yet</TipTitle>
        <CardSummary card={card} tierLabel={tierLabel} />
        <ShortfallSummary shortfall={shortfall} />
      </>
    );
  }
  return (
    <>
      <TipTitle>Click to buy</TipTitle>
      <CardSummary card={card} tierLabel={tierLabel} />
      <TipBody>
        Adds a permanent +1 {COLOR_LABEL[card.bonus]} bonus
        {card.prestige > 0 ? ` and ${card.prestige} prestige` : ""}.
      </TipBody>
    </>
  );
}

interface ReserveButtonTipArgs {
  reserveCount: number;
  bankGold: number;
  isMyTurn: boolean;
  mustDiscard: number;
  finished: boolean;
}

export function reserveButtonTip({
  reserveCount,
  bankGold,
  isMyTurn,
  mustDiscard,
  finished,
}: ReserveButtonTipArgs): React.ReactNode {
  if (finished) return null;
  if (!isMyTurn) {
    return (
      <>
        <TipTitle>Wait your turn</TipTitle>
        <TipBody>Reserving is a turn action.</TipBody>
      </>
    );
  }
  if (mustDiscard > 0) {
    return (
      <>
        <TipTitle>Discard first</TipTitle>
        <TipBody>Return chips before reserving.</TipBody>
      </>
    );
  }
  if (reserveCount >= 3) {
    return (
      <>
        <TipTitle>Reserve full</TipTitle>
        <TipBody>You can hold at most 3 reserved cards. Buy one to free a slot.</TipBody>
      </>
    );
  }
  return (
    <>
      <TipTitle>Reserve card</TipTitle>
      <TipBody>
        Move it to your private reserve so no one else can buy it
        {bankGold > 0 ? ", and gain 1 gold (wild) chip" : " (no gold left in the bank)"}
        . Counts as your turn.
      </TipBody>
    </>
  );
}

interface DeckStubTipArgs {
  tier: Tier;
  deckCount: number;
  reserveCount: number;
  bankGold: number;
  isMyTurn: boolean;
  mustDiscard: number;
  finished: boolean;
}

export function deckStubTip({
  tier,
  deckCount,
  reserveCount,
  bankGold,
  isMyTurn,
  mustDiscard,
  finished,
}: DeckStubTipArgs): React.ReactNode {
  const tierLabel = tier === 1 ? "I" : tier === 2 ? "II" : "III";
  if (deckCount === 0) {
    return (
      <>
        <TipTitle>Deck empty</TipTitle>
        <TipBody>No tier {tierLabel} cards remain to draw.</TipBody>
      </>
    );
  }
  if (finished) return null;
  if (!isMyTurn) {
    return (
      <>
        <TipTitle>Tier {tierLabel} deck — {deckCount} cards</TipTitle>
        <TipBody>On your turn you may reserve the top card sight unseen.</TipBody>
      </>
    );
  }
  if (mustDiscard > 0) {
    return (
      <>
        <TipTitle>Discard first</TipTitle>
        <TipBody>Return chips before reserving.</TipBody>
      </>
    );
  }
  if (reserveCount >= 3) {
    return (
      <>
        <TipTitle>Reserve full</TipTitle>
        <TipBody>You already hold 3 reserved cards.</TipBody>
      </>
    );
  }
  return (
    <>
      <TipTitle>Blind reserve</TipTitle>
      <TipBody>
        Take the top tier {tierLabel} card unseen
        {bankGold > 0 ? " and gain 1 gold (wild) chip" : " (no gold left in the bank)"}
        . Useful when you want a wild without committing to a card.
      </TipBody>
    </>
  );
}

interface NobleTipArgs {
  noble: Noble;
  view: SplendorPlayerView;
}

export function nobleTip({ noble, view }: NobleTipArgs): React.ReactNode {
  const me = view.myPlayerID === null ? null : view.players[view.myPlayerID] ?? null;
  const requirements = (Object.entries(noble.requires) as [GemColor, number][])
    .filter(([, v]) => (v ?? 0) > 0);

  return (
    <>
      <TipTitle>{noble.name} — {noble.prestige} prestige</TipTitle>
      <TipBody>
        Visits the first player whose permanent bonuses meet every requirement. Auto-claimed at the end of your turn.
      </TipBody>
      {me !== null ? (
        <div className="mt-1 grid grid-cols-2 gap-x-2 gap-y-0.5 text-[10px] text-amber-100/90">
          {requirements.map(([color, n]) => {
            const have = me.bonuses[color];
            const ok = have >= n;
            return (
              <span key={color} className={ok ? "text-emerald-300" : ""}>
                <span className="capitalize">{color}</span>: {have}/{n}
              </span>
            );
          })}
        </div>
      ) : null}
    </>
  );
}

interface PlayerChipRowTipArgs {
  color: ChipColor;
  chips: number;
  bonuses: number;
  isMe: boolean;
}

export function playerChipRowTip({
  color,
  chips,
  bonuses,
  isMe,
}: PlayerChipRowTipArgs): React.ReactNode {
  if (color === "gold") {
    return (
      <>
        <TipTitle>{isMe ? "Your gold" : "Gold (wild)"}</TipTitle>
        <TipBody>
          Wildcards. Spend like any color when buying. {chips > 0 ? `Currently holding ${chips}.` : "None on hand."}
        </TipBody>
      </>
    );
  }
  return (
    <>
      <TipTitle>{COLOR_LABEL[color]} — chips & bonuses</TipTitle>
      <TipBody>
        <span className="text-amber-100">Chips ({chips}):</span> spent and returned to the bank when buying.
      </TipBody>
      <TipBody>
        <span className="text-amber-100">Bonuses (+{bonuses}):</span> permanent discounts from owned cards — they reduce future costs but are never spent.
      </TipBody>
    </>
  );
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

interface Shortfall {
  perColor: Partial<Record<GemColor, number>>;
  totalShort: number;
  goldUsable: number;
}

function computeShortfall(
  chips: Record<ChipColor, number>,
  bonuses: Record<GemColor, number>,
  cost: Partial<Record<GemColor, number>>,
): Shortfall {
  const perColor: Partial<Record<GemColor, number>> = {};
  let totalShort = 0;
  for (const color of GEM_COLORS) {
    const required = cost[color] ?? 0;
    if (required === 0) continue;
    const fromBonus = bonuses[color];
    const remaining = required - fromBonus;
    if (remaining <= 0) continue;
    const fromChips = chips[color];
    const short = Math.max(0, remaining - fromChips);
    if (short > 0) {
      perColor[color] = short;
      totalShort += short;
    }
  }
  const usableGold = chips.gold;
  const netShort = Math.max(0, totalShort - usableGold);
  return { perColor, totalShort: netShort, goldUsable: usableGold };
}

function CardSummary({ card, tierLabel }: { card: Card; tierLabel: string }) {
  const costEntries = (Object.entries(card.cost) as [GemColor, number][])
    .filter(([, v]) => (v ?? 0) > 0);
  return (
    <TipBody>
      <span className="text-amber-100">Tier {tierLabel}</span> · +1 {COLOR_LABEL[card.bonus]} bonus
      {card.prestige > 0 ? ` · ${card.prestige}p` : ""}
      <br />
      <span className="text-amber-100/80">Cost:</span>{" "}
      {costEntries.length === 0
        ? "free"
        : costEntries.map(([c, n]) => `${n} ${COLOR_LABEL[c]}`).join(", ")}
    </TipBody>
  );
}

function ShortfallSummary({ shortfall }: { shortfall: Shortfall }) {
  const items = Object.entries(shortfall.perColor) as [GemColor, number][];
  return (
    <TipBody>
      <span className="text-rose-200">Short:</span>{" "}
      {items.map(([c, n]) => `${n} ${COLOR_LABEL[c]}`).join(", ")}
      {shortfall.goldUsable > 0
        ? ` (after using ${shortfall.goldUsable} gold)`
        : ""}
      . Take more chips or reserve a card to gain gold.
    </TipBody>
  );
}
