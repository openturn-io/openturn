import * as React from "react";
import { LayoutGroup } from "framer-motion";

import {
  getNoble,
  type ChipColor,
  type GemColor,
  type SplendorPlayerID,
  type SplendorPlayerView,
  type Tier,
} from "@openturn/example-splendor-game";

import { ChipBank } from "./ChipBank";
import { FlightOverlay, useFlight } from "./FlightOverlay";
import { Market } from "./Market";
import { NobleTile } from "./NobleTile";
import { PlayerTableau } from "./PlayerTableau";
import { TurnBanner } from "./TurnBanner";
import { Tip, TipsProvider, useTipsToggle } from "./ui/tip";
import { nobleTip } from "../lib/tutorialTips";
import { useViewDiff } from "../lib/useViewDiff";

interface TableProps {
  view: SplendorPlayerView;
  onTakeThree: (colors: readonly GemColor[]) => void;
  onTakeTwo: (color: GemColor) => void;
  onReserveMarket: (tier: Tier, slot: number) => void;
  onReserveDeck: (tier: Tier) => void;
  onBuyMarket: (tier: Tier, slot: number) => void;
  onBuyReserved: (cardID: string) => void;
  onDiscard: (chips: Partial<Record<ChipColor, number>>) => void;
}

export function Table({
  view,
  onTakeThree,
  onTakeTwo,
  onReserveMarket,
  onReserveDeck,
  onBuyMarket,
  onBuyReserved,
  onDiscard,
}: TableProps) {
  const me = view.myPlayerID;
  const isMyTurn = me !== null && view.currentTurn === me;
  const finished = view.winner !== null;
  const meData = me === null ? null : view.players[me as SplendorPlayerID] ?? null;
  const mustDiscard = meData?.mustDiscard ?? 0;
  const canAct = isMyTurn && !finished;

  // Take-three composer state — sits in this component since it spans bank
  // chip selection + confirmation in the bank panel.
  const [selection, setSelection] = React.useState<readonly GemColor[]>([]);

  // Reset selection when the turn changes or a discard appears.
  React.useEffect(() => {
    if (!isMyTurn || mustDiscard > 0 || finished) setSelection([]);
  }, [isMyTurn, mustDiscard, finished]);

  const toggle = React.useCallback((c: ChipColor) => {
    if (c === "gold") return;
    setSelection((prev) => {
      const set = new Set<GemColor>(prev);
      if (set.has(c)) set.delete(c); else if (set.size < 3) set.add(c);
      return [...set];
    });
  }, []);

  const meLabel = me === null ? "Spectator" : `Merchant ${Number.parseInt(me, 10) + 1}`;
  const turnLabel = view.currentTurn === null
    ? "—"
    : `Merchant ${Number.parseInt(view.currentTurn, 10) + 1}`;

  const [tipsEnabled, setTipsEnabled] = useTipsToggle();

  return (
    <TipsProvider enabled={tipsEnabled}>
    <LayoutGroup>
      <FlightOverlay>
        <FlightDispatcher view={view} />
        <div className="relative grid h-full min-h-0 w-full grid-rows-[auto_minmax(0,1fr)_minmax(0,auto)] gap-3 overflow-hidden px-3 py-3 lg:gap-4 lg:px-6 lg:py-4 xl:grid-rows-[auto_minmax(0,1fr)]">
          <TurnBanner
            view={view}
            isMe={isMyTurn}
            meLabel={meLabel}
            turnLabel={turnLabel}
            tipsEnabled={tipsEnabled}
            onToggleTips={setTipsEnabled}
          />

          <div className="grid min-h-0 gap-3 overflow-hidden lg:grid-cols-[260px_minmax(0,1fr)] lg:gap-4 xl:grid-cols-[260px_minmax(620px,1fr)_minmax(320px,380px)]">
            {/* Left rail: bank */}
            <div className="flex min-h-0 flex-col gap-3 overflow-y-auto pr-1">
              <ChipBank
                view={view}
                isMyTurn={canAct}
                selection={selection}
                mustDiscard={mustDiscard}
                onToggle={toggle}
                onTakeTwo={(c) => {
                  setSelection([]);
                  onTakeTwo(c as GemColor);
                }}
                onConfirmTake={() => {
                  if (selection.length === 0) return;
                  onTakeThree(selection);
                  setSelection([]);
                }}
                onClearSelection={() => setSelection([])}
              />
              {mustDiscard > 0 && me !== null ? (
                <DiscardComposer view={view} myID={me} mustDiscard={mustDiscard} onDiscard={onDiscard} />
              ) : null}
            </div>

            {/* Center: nobles + market */}
            <div className="flex min-h-0 flex-col gap-3 overflow-y-auto pr-1">
              <div className="felt-panel flex flex-wrap items-center gap-2 p-3">
                <span className="mr-1 text-[11px] uppercase tracking-[0.22em] text-amber-100/70">
                  Nobles
                </span>
                {view.nobles.map((id) => {
                  const noble = getNoble(id);
                  return (
                    <Tip key={id} content={nobleTip({ noble, view })}>
                      <div>
                        <NobleTile noble={noble} size="md" layoutId={`noble-${id}`} />
                      </div>
                    </Tip>
                  );
                })}
                {view.nobles.length === 0 ? (
                  <span className="text-xs text-amber-100/60">All nobles claimed.</span>
                ) : null}
              </div>
              <Market
                view={view}
                isMyTurn={canAct}
                canBuy={canAct && mustDiscard === 0}
                canReserve={
                  canAct &&
                  mustDiscard === 0 &&
                  meData !== null &&
                  meData.reservedCount < 3
                }
                onBuy={(t, s) => onBuyMarket(t, s)}
                onReserve={(t, s) => onReserveMarket(t, s)}
                onReserveTopOfDeck={(t) => onReserveDeck(t)}
              />
            </div>

            {/* Wide screens: use the otherwise empty right side for players. */}
            <div className="hidden min-h-0 flex-col gap-3 overflow-y-auto pr-1 xl:flex">
              {view.seatOrder.map((id) => (
                <PlayerTableau
                  key={id}
                  view={view}
                  playerID={id}
                  isMe={id === me}
                  isCurrentTurn={view.currentTurn === id}
                  canBuyReserved={canAct && id === me && mustDiscard === 0}
                  onBuyReserved={onBuyReserved}
                />
              ))}
            </div>
          </div>

          {/* Smaller screens: keep players below the market where vertical rails are cramped. */}
          <div className="grid max-h-[34svh] min-h-0 gap-3 overflow-y-auto pr-1 lg:grid-cols-2 xl:hidden">
            {view.seatOrder.map((id) => (
              <PlayerTableau
                key={id}
                view={view}
                playerID={id}
                isMe={id === me}
                isCurrentTurn={view.currentTurn === id}
                canBuyReserved={canAct && id === me && mustDiscard === 0}
                onBuyReserved={onBuyReserved}
              />
            ))}
          </div>
        </div>
      </FlightOverlay>
    </LayoutGroup>
    </TipsProvider>
  );
}

function FlightDispatcher({ view }: { view: SplendorPlayerView }) {
  const { flyChip, flyCard } = useFlight();
  useViewDiff(view, {
    onChipsGained: (moves) => {
      for (const m of moves) {
        for (let i = 0; i < m.delta; i += 1) {
          flyChip({
            color: m.color,
            fromAnchor: `bank-chip-${m.color}`,
            toAnchor: `player-chip-${m.playerID}-${m.color}`,
            delay: i * 60,
          });
        }
      }
    },
    onChipsReturned: (moves) => {
      for (const m of moves) {
        for (let i = 0; i < m.delta; i += 1) {
          flyChip({
            color: m.color,
            fromAnchor: `player-chip-${m.playerID}-${m.color}`,
            toAnchor: `bank-chip-${m.color}`,
            delay: i * 60,
          });
        }
      }
    },
    onCardBought: (event) => {
      const fromAnchor =
        event.source === "market"
          ? `market-card-${event.cardID}`
          : `reserved-card-${event.cardID}`;
      flyCard({
        cardID: event.cardID,
        bonus: event.bonus,
        tier: event.tier,
        fromAnchor,
        toAnchor: `player-chip-${event.buyerID}-${event.bonus}`,
      });
    },
  });
  return null;
}

interface DiscardComposerProps {
  view: SplendorPlayerView;
  myID: string;
  mustDiscard: number;
  onDiscard: (chips: Partial<Record<ChipColor, number>>) => void;
}

function DiscardComposer({ view, myID, mustDiscard, onDiscard }: DiscardComposerProps) {
  const me = view.players[myID as SplendorPlayerID];
  if (me === undefined) return null;
  const [selected, setSelected] = React.useState<Record<ChipColor, number>>({
    white: 0, blue: 0, green: 0, red: 0, black: 0, gold: 0,
  });
  const total = Object.values(selected).reduce((a, b) => a + b, 0);
  const overflow = total > mustDiscard;
  const exact = total === mustDiscard;
  return (
    <div className="felt-panel flex flex-col gap-2 p-3 ring-2 ring-inset ring-red-400/50">
      <div>
        <p className="m-0 text-[10px] uppercase tracking-[0.25em] text-red-200">Over the limit</p>
        <p className="m-0 text-sm text-amber-100">
          Return {mustDiscard} chip{mustDiscard === 1 ? "" : "s"} to end your turn.
        </p>
      </div>
      <div className="flex flex-wrap gap-1">
        {(["white", "blue", "green", "red", "black", "gold"] as const).map((c) => {
          const has = me.chips[c];
          const sel = selected[c];
          const more = !overflow && sel < has;
          const less = sel > 0;
          return (
            <div key={c} className="flex items-center gap-1 rounded-full bg-black/30 px-1.5 py-1 ring-1 ring-inset ring-white/10">
              <span className="text-[10px] capitalize text-amber-100/80">{c}</span>
              <span className="text-[10px] text-amber-100/60">{sel}/{has}</span>
              <button
                type="button"
                onClick={() => less && setSelected((s) => ({ ...s, [c]: s[c] - 1 }))}
                disabled={!less}
                className="rounded-md bg-white/10 px-1 text-xs text-amber-100 disabled:opacity-30 hover:bg-white/15 cursor-pointer"
              >−</button>
              <button
                type="button"
                onClick={() => more && setSelected((s) => ({ ...s, [c]: s[c] + 1 }))}
                disabled={!more}
                className="rounded-md bg-white/10 px-1 text-xs text-amber-100 disabled:opacity-30 hover:bg-white/15 cursor-pointer"
              >+</button>
            </div>
          );
        })}
      </div>
      <button
        type="button"
        onClick={() => exact && onDiscard(selected)}
        disabled={!exact}
        className="self-end rounded-md bg-amber-300 px-3 py-1 text-sm font-medium text-stone-900 disabled:opacity-50 hover:bg-amber-200 cursor-pointer"
      >
        Discard {total}
      </button>
    </div>
  );
}
