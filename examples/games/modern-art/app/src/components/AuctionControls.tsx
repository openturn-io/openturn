import * as React from "react";

import { type ModernArtPlayerView } from "@openturn/example-modern-art-game";

import { PaintingCard } from "./PaintingCard";
import { Tip } from "./ui/tip";
import { curatorName, money } from "../lib/format";
import {
  amountInputTip,
  doubleOptionTip,
  fixedBuyTip,
  fixedPassTip,
  fixedSetTip,
  hiddenBidTip,
  offerDoublePassTip,
  oneOfferBidTip,
  oneOfferPassTip,
  passOpenTip,
  raiseTip,
} from "../lib/tutorialTips";

export interface AuctionHandlers {
  onFixedPrice: (amount: number) => void;
  onHiddenBid: (amount: number) => void;
  onOfferDouble: (cardID: string | null) => void;
  onOneOffer: (amount: number | null) => void;
  onOpenPass: () => void;
  onOpenRaise: (amount: number) => void;
  onRespondFixed: (accept: boolean) => void;
}

interface AuctionControlsProps extends AuctionHandlers {
  view: ModernArtPlayerView;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

interface BidComposerProps {
  amount: number;
  disabled: boolean;
  max: number;
  min: number;
  onAmount: (next: number) => void;
  view: ModernArtPlayerView;
}

function BidComposer({ amount, disabled, max, min, onAmount, view }: BidComposerProps) {
  const set = (value: number) => onAmount(clamp(value, min, Math.max(min, max)));
  return (
    <Tip content={amountInputTip({ view, amount, minBid: min, myMoney: max })}>
      <div className="bid-composer">
        <div className="bid-steppers">
          <button className="bid-step" disabled={disabled || amount - 5 < min} onClick={() => set(amount - 5)} type="button">
            −5
          </button>
          <button className="bid-step" disabled={disabled || amount - 1 < min} onClick={() => set(amount - 1)} type="button">
            −1
          </button>
          <div className="bid-amount" aria-live="polite">
            <span className="bid-currency">$</span>
            <input
              aria-label="Bid amount"
              disabled={disabled}
              inputMode="numeric"
              max={max}
              min={min}
              onChange={(event) => {
                const next = Number(event.target.value);
                if (Number.isFinite(next)) set(Math.round(next));
              }}
              type="number"
              value={amount}
            />
          </div>
          <button className="bid-step" disabled={disabled || amount + 1 > max} onClick={() => set(amount + 1)} type="button">
            +1
          </button>
          <button className="bid-step" disabled={disabled || amount + 5 > max} onClick={() => set(amount + 5)} type="button">
            +5
          </button>
        </div>
        <div className="bid-presets">
          <button className="bid-preset" disabled={disabled} onClick={() => set(min)} type="button">
            Min {money(min)}
          </button>
          <button className="bid-preset" disabled={disabled || amount + 10 > max} onClick={() => set(amount + 10)} type="button">
            +10
          </button>
          <button className="bid-preset" disabled={disabled || max < min} onClick={() => set(max)} type="button">
            All in {money(max)}
          </button>
        </div>
      </div>
    </Tip>
  );
}

export function AuctionControls(props: AuctionControlsProps) {
  const { view } = props;
  const me = view.myPlayerID;
  const isActive = me !== null && view.activePlayers.includes(me);
  const lot = view.lot;
  const myMoney = view.myMoney ?? 0;
  const highBid = lot?.highBid?.amount ?? 0;
  const isBidPhase = view.phase === "openAuction" || view.phase === "oneOfferAuction";
  const minBid = isBidPhase ? highBid + 1 : 0;

  // Amount state resets whenever the decision context changes (new lot,
  // new phase, or the high bid moved underneath us).
  const resetKey = `${view.phase}:${lot?.cards.join(",") ?? ""}:${minBid}`;
  const defaultAmount = isBidPhase
    ? clamp(minBid, minBid, Math.max(minBid, myMoney))
    : clamp(view.phase === "fixedPriceSet" ? 20 : 10, 0, myMoney);
  const [amount, setAmount] = React.useState(defaultAmount);
  const lastKey = React.useRef(resetKey);
  if (lastKey.current !== resetKey) {
    lastKey.current = resetKey;
    setAmount(defaultAmount);
  }

  if (view.revealedMoney !== null) return null;

  // --- Waiting / passive states ------------------------------------------
  if (!isActive) {
    if (view.phase === "hiddenAuction" && me !== null && view.myHiddenBid !== null) {
      return (
        <div className="controls controls-waiting">
          <span className="sealed-note">
            Your bid of <b>{money(view.myHiddenBid)}</b> is sealed
          </span>
          <span className="waiting-note">
            Waiting on {view.activePlayers.map(curatorName).join(", ") || "the reveal"}…
          </span>
        </div>
      );
    }
    const waitingOn = view.activePlayers.map(curatorName).join(", ");
    return (
      <div className="controls controls-waiting">
        <span className="waiting-dot" aria-hidden />
        <span className="waiting-note">{waitingOn === "" ? "Resolving…" : `Waiting on ${waitingOn}…`}</span>
      </div>
    );
  }

  // --- Active states ------------------------------------------------------
  if (view.phase === "selectPainting") {
    return (
      <div className="controls controls-prompt">
        <span className="prompt-text">You hold the gavel — choose a painting from your hand below.</span>
        <span className="prompt-arrow" aria-hidden>
          ↓
        </span>
      </div>
    );
  }

  if (view.phase === "doubleOffer") {
    const firstCard = lot?.cards[0] === undefined ? null : view.cards[lot.cards[0]] ?? null;
    const options =
      firstCard === null || me === null
        ? []
        : view.myHand.filter((cardID) => {
            const card = view.cards[cardID];
            return card?.artist === firstCard.artist && card.type !== "double";
          });
    return (
      <div className="controls">
        <p className="controls-heading">
          {options.length === 0
            ? "No matching painting to pair — pass to the next collector."
            : "Pair a painting onto the double lot and take over as auctioneer:"}
        </p>
        {options.length > 0 ? (
          <div className="double-options">
            {options.map((cardID) => (
              <PaintingCard
                card={view.cards[cardID]!}
                highlight
                key={cardID}
                onClick={() => props.onOfferDouble(cardID)}
                size="sm"
                tip={doubleOptionTip({ card: view.cards[cardID]!, view })}
              />
            ))}
          </div>
        ) : null}
        <Tip content={offerDoublePassTip(view)}>
          <button className="btn btn-ghost" onClick={() => props.onOfferDouble(null)} type="button">
            Pass
          </button>
        </Tip>
      </div>
    );
  }

  if (view.phase === "fixedPriceOffer") {
    const price = lot?.fixedPrice ?? 0;
    const canAfford = myMoney >= price;
    return (
      <div className="controls controls-split">
        <Tip content={fixedBuyTip(view)}>
          <button className="btn btn-gold" disabled={!canAfford} onClick={() => props.onRespondFixed(true)} type="button">
            Buy for {money(price)}
            {canAfford ? "" : " — can't afford"}
          </button>
        </Tip>
        <Tip content={fixedPassTip(view)}>
          <button className="btn btn-ghost" onClick={() => props.onRespondFixed(false)} type="button">
            Pass
          </button>
        </Tip>
      </div>
    );
  }

  const composerMax = Math.max(0, myMoney);
  const composerMin = isBidPhase ? minBid : 0;
  const bidValid = amount >= composerMin && amount <= composerMax;
  const canMeetMin = composerMax >= composerMin;

  return (
    <div className="controls">
      <BidComposer
        amount={amount}
        disabled={!canMeetMin}
        max={composerMax}
        min={composerMin}
        onAmount={setAmount}
        view={view}
      />
      {!canMeetMin && isBidPhase ? (
        <p className="controls-note">You can't beat the current bid of {money(highBid)} — pass.</p>
      ) : null}
      {view.phase === "openAuction" ? (
        <div className="controls-split">
          <Tip content={raiseTip({ view, amount, minBid, myMoney, disabled: !bidValid })}>
            <button className="btn btn-gold" disabled={!bidValid} onClick={() => props.onOpenRaise(amount)} type="button">
              Raise to {money(amount)}
            </button>
          </Tip>
          <Tip content={passOpenTip(view)}>
            <button className="btn btn-ghost" onClick={props.onOpenPass} type="button">
              Pass
            </button>
          </Tip>
        </div>
      ) : null}
      {view.phase === "oneOfferAuction" ? (
        <div className="controls-split">
          <Tip content={oneOfferBidTip({ view, amount, minBid, myMoney, disabled: !bidValid })}>
            <button className="btn btn-gold" disabled={!bidValid} onClick={() => props.onOneOffer(amount)} type="button">
              Bid once — {money(amount)}
            </button>
          </Tip>
          <Tip content={oneOfferPassTip(view)}>
            <button className="btn btn-ghost" onClick={() => props.onOneOffer(null)} type="button">
              Pass
            </button>
          </Tip>
        </div>
      ) : null}
      {view.phase === "hiddenAuction" ? (
        <Tip content={hiddenBidTip({ view, amount, minBid, myMoney, disabled: !bidValid })}>
          <button className="btn btn-gold btn-wide" disabled={!bidValid} onClick={() => props.onHiddenBid(amount)} type="button">
            Seal bid — {money(amount)}
          </button>
        </Tip>
      ) : null}
      {view.phase === "fixedPriceSet" ? (
        <Tip content={fixedSetTip({ view, amount, minBid, myMoney, disabled: !bidValid })}>
          <button className="btn btn-gold btn-wide" disabled={!bidValid} onClick={() => props.onFixedPrice(amount)} type="button">
            Ask {money(amount)}
          </button>
        </Tip>
      ) : null}
    </div>
  );
}
