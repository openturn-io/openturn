import * as React from "react";

import {
  type ArtistID,
  type AuctionType,
  type ModernArtPlayerID,
  type ModernArtPlayerView,
  type PaintingCard,
  type PhaseName,
  type PublicAuctionLot,
} from "@openturn/example-modern-art-game";

const AUCTION_NAME: Record<AuctionType, string> = {
  open: "Open auction",
  oneOffer: "One-offer auction",
  hidden: "Sealed-bid auction",
  fixed: "Fixed-price auction",
  double: "Double auction",
};

const AUCTION_RULES: Record<AuctionType, string> = {
  open:
    "Ascending bids. Players raise around the table until everyone but the high bidder passes. Highest bidder pays the auctioneer and keeps the painting.",
  oneOffer:
    "Each player in turn (left of auctioneer) makes a single bid or passes; every bid must beat the last. The auctioneer goes last and must outbid the high offer to keep the painting — otherwise it sells to the high bidder.",
  hidden:
    "Everyone (including the auctioneer) secretly chooses a bid amount. Highest sealed bid wins and pays the auctioneer (the auctioneer pays the bank if they win their own lot). Ties go to the player closest to the auctioneer's left.",
  fixed:
    "The auctioneer names a price. Each opponent in turn either buys at that price (and keeps it) or passes. If everyone passes, the auctioneer must buy it themselves — paying the asking price to the bank.",
  double:
    "Pair two paintings of the same artist into a single lot. The auctioneer plays one Double card, then any one player (going around the table) may add a matching painting and become the new auctioneer. The lot is then sold using the second card's auction type.",
};

const ARTIST_NAME: Record<ArtistID, string> = {
  liteMetal: "Lite Metal",
  yoko: "Yoko",
  christinP: "Christin P.",
  karlGitter: "Karl Gitter",
  krypto: "Krypto",
};

// Must match the engine's playerLabel() so tips agree with the action log.
function playerName(id: ModernArtPlayerID): string {
  return `Curator ${Number.parseInt(id, 10) + 1}`;
}

function TipTitle({ children }: { children: React.ReactNode }) {
  return <p className="tip-title">{children}</p>;
}

function TipBody({ children }: { children: React.ReactNode }) {
  return <p className="tip-body">{children}</p>;
}

// ---------------------------------------------------------------------------
// Header / status pills
// ---------------------------------------------------------------------------

export function roundTip(view: ModernArtPlayerView): React.ReactNode {
  return (
    <>
      <TipTitle>Round {view.round} of 4</TipTitle>
      <TipBody>
        A round ends the moment any single artist has 5 paintings offered to the table. Then the three most-offered artists score (30 / 20 / 10), prior values stack, and a new hand is dealt.
      </TipBody>
      <TipBody>
        After 4 rounds the player with the most cash wins.
      </TipBody>
    </>
  );
}

export function hammerTip(view: ModernArtPlayerView): React.ReactNode {
  const me = view.myPlayerID;
  const isMe = me !== null && view.hammer === me;
  return (
    <>
      <TipTitle>Hammer: {playerName(view.hammer)}</TipTitle>
      <TipBody>
        The hammer (auctioneer) plays the next painting from their hand and runs the auction. {isMe ? "It's yours — pick a painting below." : "After they sell, the hammer passes to the next player with cards."}
      </TipBody>
    </>
  );
}

export function phaseTip(view: ModernArtPlayerView): React.ReactNode {
  const { phase, lot } = view;
  if (phase === "selectPainting") {
    return (
      <>
        <TipTitle>Select painting</TipTitle>
        <TipBody>
          The hammer picks a painting from hand to put up for sale. The card's icon (Open, Once, Sealed, Fixed, Double) decides the auction style.
        </TipBody>
      </>
    );
  }
  if (phase === "doubleOffer") {
    return (
      <>
        <TipTitle>Double offer</TipTitle>
        <TipBody>
          A Double card was played. Going around the table from the auctioneer's left, each player may pair a matching-artist painting onto the lot and become the new auctioneer. Or everyone passes and the original auctioneer keeps the role.
        </TipBody>
      </>
    );
  }
  if (phase === "openAuction") {
    return (
      <>
        <TipTitle>Open auction</TipTitle>
        <TipBody>{AUCTION_RULES.open}</TipBody>
        {lot?.highBid !== null && lot?.highBid !== undefined ? (
          <TipBody>
            High bid: <span className="tip-em">${lot.highBid.amount}</span> from {playerName(lot.highBid.player)}.
          </TipBody>
        ) : null}
      </>
    );
  }
  if (phase === "oneOfferAuction") {
    return (
      <>
        <TipTitle>One-offer auction</TipTitle>
        <TipBody>{AUCTION_RULES.oneOffer}</TipBody>
      </>
    );
  }
  if (phase === "hiddenAuction") {
    return (
      <>
        <TipTitle>Sealed-bid auction</TipTitle>
        <TipBody>{AUCTION_RULES.hidden}</TipBody>
      </>
    );
  }
  if (phase === "fixedPriceSet") {
    return (
      <>
        <TipTitle>Set fixed price</TipTitle>
        <TipBody>The auctioneer chooses an asking price.</TipBody>
        <TipBody>{AUCTION_RULES.fixed}</TipBody>
      </>
    );
  }
  if (phase === "fixedPriceOffer") {
    return (
      <>
        <TipTitle>Fixed-price offer</TipTitle>
        <TipBody>
          Buy at <span className="tip-em">${lot?.fixedPrice ?? 0}</span> or pass. Passing lets the next player decide. If everyone passes, the auctioneer keeps it at that price.
        </TipBody>
      </>
    );
  }
  return null;
}

export function moneyTip(view: ModernArtPlayerView): React.ReactNode {
  const me = view.myPlayerID;
  const isFinished = view.revealedMoney !== null;
  if (me === null) {
    return (
      <>
        <TipTitle>Spectator</TipTitle>
        <TipBody>You aren't seated, so private money totals are hidden until the game ends.</TipBody>
      </>
    );
  }
  return (
    <>
      <TipTitle>{isFinished ? "Final cash" : "Your cash"}</TipTitle>
      <TipBody>
        Everyone starts each game with $100. You'll spend it bidding and earn more by selling paintings (the auctioneer pockets the winning bid) and by holding paintings at the end of each round when those artists score.
      </TipBody>
      <TipBody>
        Your money is hidden from opponents until the game ends.
      </TipBody>
    </>
  );
}

// ---------------------------------------------------------------------------
// Tips toggle button
// ---------------------------------------------------------------------------

export function tipsToggleTip(enabled: boolean): React.ReactNode {
  return (
    <>
      <TipTitle>Tutorial tips</TipTitle>
      <TipBody>
        {enabled
          ? "Hover anything on the table for an explanation. Click to switch tips off — your choice is remembered next time."
          : "Tips are off. Click to switch them back on for hover explanations."}
      </TipBody>
    </>
  );
}

// ---------------------------------------------------------------------------
// Artist lane
// ---------------------------------------------------------------------------

interface ArtistLaneTipArgs {
  artist: ArtistID;
  view: ModernArtPlayerView;
}

export function artistLaneTip({ artist, view }: ArtistLaneTipArgs): React.ReactNode {
  const offered = view.offeredCounts[artist];
  const tiles = view.valueTiles[artist];
  const total = tiles.reduce((sum, t) => sum + t, 0);
  const slotsLeft = Math.max(0, 5 - offered);
  return (
    <>
      <TipTitle>{ARTIST_NAME[artist]}</TipTitle>
      <TipBody>
        Each painting offered this round counts toward this artist. When any artist hits <span className="tip-em">5 offered</span>, the round ends immediately.
      </TipBody>
      <TipBody>
        <span className="tip-em">This round:</span> {offered}/5 offered ({slotsLeft} more would end the round).
      </TipBody>
      <TipBody>
        <span className="tip-em">Past value:</span> ${total} per painting. {tiles.length === 0
          ? "Hasn't placed in the top 3 yet."
          : `Past round payouts: ${tiles.join(" + ")}.`}
      </TipBody>
    </>
  );
}

interface OfferedDotsTipArgs {
  artist: ArtistID;
  view: ModernArtPlayerView;
}

export function offeredDotsTip({ artist, view }: OfferedDotsTipArgs): React.ReactNode {
  const offered = view.offeredCounts[artist];
  return (
    <>
      <TipTitle>Sales counter</TipTitle>
      <TipBody>
        {ARTIST_NAME[artist]} has been offered <span className="tip-em">{offered}</span> time{offered === 1 ? "" : "s"} this round. The first artist to reach 5 immediately ends the round and triggers scoring.
      </TipBody>
    </>
  );
}

// ---------------------------------------------------------------------------
// Lot / painting
// ---------------------------------------------------------------------------

interface LotPaintingTipArgs {
  card: PaintingCard;
  view: ModernArtPlayerView;
}

export function lotPaintingTip({ card, view }: LotPaintingTipArgs): React.ReactNode {
  const lot = view.lot;
  return (
    <>
      <TipTitle>{ARTIST_NAME[card.artist]} — {AUCTION_NAME[card.type]}</TipTitle>
      <TipBody>{AUCTION_RULES[card.type]}</TipBody>
      {lot !== null ? (
        <TipBody>
          Auctioneer: <span className="tip-em">{playerName(lot.auctioneer)}</span>
          {lot.originalAuctioneer !== lot.auctioneer
            ? ` (Double card originally played by ${playerName(lot.originalAuctioneer)})`
            : ""}
          {lot.highBid !== null ? ` · High bid $${lot.highBid.amount} from ${playerName(lot.highBid.player)}` : ""}
        </TipBody>
      ) : null}
    </>
  );
}

interface HandPaintingTipArgs {
  card: PaintingCard;
  view: ModernArtPlayerView;
  canPlay: boolean;
}

export function handPaintingTip({ card, view, canPlay }: HandPaintingTipArgs): React.ReactNode {
  const isSelectPhase = view.phase === "selectPainting";
  const myTurn = view.myPlayerID !== null && view.activePlayers.includes(view.myPlayerID);
  return (
    <>
      <TipTitle>{ARTIST_NAME[card.artist]} — {AUCTION_NAME[card.type]}</TipTitle>
      <TipBody>{AUCTION_RULES[card.type]}</TipBody>
      {canPlay ? (
        <TipBody><span className="tip-em">Click to play.</span> You'll run the auction as the hammer.</TipBody>
      ) : isSelectPhase ? (
        myTurn ? null : (
          <TipBody>Waiting on {view.activePlayers.map(playerName).join(", ") || "the hammer"} to play.</TipBody>
        )
      ) : (
        <TipBody>Not in the select-painting phase — finish the current auction first.</TipBody>
      )}
    </>
  );
}

interface DoubleOptionTipArgs {
  card: PaintingCard;
  view: ModernArtPlayerView;
}

export function doubleOptionTip({ card, view: _view }: DoubleOptionTipArgs): React.ReactNode {
  return (
    <>
      <TipTitle>Add to double</TipTitle>
      <TipBody>
        Pair this {ARTIST_NAME[card.artist]} painting onto the Double card. You become the auctioneer and the lot resolves as <span className="tip-em">{AUCTION_NAME[card.type]}</span>.
      </TipBody>
      <TipBody>
        Both paintings count toward {ARTIST_NAME[card.artist]}'s round-end tally, so doubles push that artist closer to the 5-sales cap.
      </TipBody>
    </>
  );
}

// ---------------------------------------------------------------------------
// Auction controls
// ---------------------------------------------------------------------------

interface AmountInputTipArgs {
  view: ModernArtPlayerView;
  amount: number;
  minBid: number;
  myMoney: number;
}

export function amountInputTip({ view, amount, minBid, myMoney }: AmountInputTipArgs): React.ReactNode {
  const { phase } = view;
  const isFloor = phase === "openAuction" || phase === "oneOfferAuction";
  return (
    <>
      <TipTitle>Bid amount</TipTitle>
      <TipBody>
        {isFloor
          ? `Minimum: $${minBid} (must exceed the high bid). `
          : phase === "hiddenAuction"
            ? "Sealed bids may be any amount up to your cash. "
            : phase === "fixedPriceSet"
              ? "Set the asking price for the lot. "
              : ""}
        Cap: <span className="tip-em">${myMoney}</span> (your cash). Currently selected: ${amount}.
      </TipBody>
    </>
  );
}

interface ActionButtonTipArgs {
  view: ModernArtPlayerView;
  amount: number;
  minBid: number;
  myMoney: number;
  disabled: boolean;
}

export function raiseTip({ view, amount, minBid, myMoney, disabled }: ActionButtonTipArgs): React.ReactNode {
  if (disabled && !isMyTurn(view)) {
    return <TipBody>Wait for your turn to raise.</TipBody>;
  }
  if (amount < minBid) {
    return (
      <>
        <TipTitle>Bid is too low</TipTitle>
        <TipBody>Must exceed the current high bid of ${minBid - 1}.</TipBody>
      </>
    );
  }
  if (amount > myMoney) {
    return (
      <>
        <TipTitle>Out of cash</TipTitle>
        <TipBody>You can't bid more than ${myMoney}.</TipBody>
      </>
    );
  }
  return (
    <>
      <TipTitle>Raise to ${amount}</TipTitle>
      <TipBody>{AUCTION_RULES.open}</TipBody>
    </>
  );
}

export function passOpenTip(view: ModernArtPlayerView): React.ReactNode {
  if (!isMyTurn(view)) return null;
  return (
    <>
      <TipTitle>Pass</TipTitle>
      <TipBody>
        Drop out of this open auction. You can't re-enter once the high bid moves past you. If everyone passes, the high bidder wins (or the auctioneer keeps the painting at $0).
      </TipBody>
    </>
  );
}

export function oneOfferBidTip({ view, amount, minBid, myMoney, disabled }: ActionButtonTipArgs): React.ReactNode {
  if (disabled && !isMyTurn(view)) {
    return <TipBody>Each player gets exactly one chance to bid in a One-offer.</TipBody>;
  }
  if (amount < minBid) {
    return (
      <>
        <TipTitle>Bid is too low</TipTitle>
        <TipBody>Must exceed the current high bid of ${minBid - 1}.</TipBody>
      </>
    );
  }
  if (amount > myMoney) {
    return (
      <>
        <TipTitle>Out of cash</TipTitle>
        <TipBody>You can't bid more than ${myMoney}.</TipBody>
      </>
    );
  }
  return (
    <>
      <TipTitle>Bid once at ${amount}</TipTitle>
      <TipBody>
        This is your single shot. The auctioneer goes last and can either match the high bid to keep the painting, or sell to the high bidder.
      </TipBody>
    </>
  );
}

export function oneOfferPassTip(view: ModernArtPlayerView): React.ReactNode {
  if (!isMyTurn(view)) return null;
  return (
    <>
      <TipTitle>Pass</TipTitle>
      <TipBody>Skip your one shot at this auction. You can't come back to it later.</TipBody>
    </>
  );
}

export function hiddenBidTip({ view, amount, myMoney, disabled }: ActionButtonTipArgs): React.ReactNode {
  const myBid = view.myHiddenBid;
  if (myBid !== null) {
    return (
      <>
        <TipTitle>Bid locked in</TipTitle>
        <TipBody>You already sealed ${myBid}. Waiting on the rest of the table to bid.</TipBody>
      </>
    );
  }
  if (disabled && !isMyTurn(view)) {
    return <TipBody>You aren't bidding on this lot.</TipBody>;
  }
  if (amount > myMoney) {
    return (
      <>
        <TipTitle>Out of cash</TipTitle>
        <TipBody>Sealed bids can't exceed your cash.</TipBody>
      </>
    );
  }
  return (
    <>
      <TipTitle>Submit sealed bid (${amount})</TipTitle>
      <TipBody>{AUCTION_RULES.hidden}</TipBody>
      <TipBody>
        Tip: the auctioneer bids too — but if they win their own lot they pay the bank, so overbidding to keep a painting still costs real money.
      </TipBody>
    </>
  );
}

export function fixedSetTip({ view, amount, myMoney, disabled }: ActionButtonTipArgs): React.ReactNode {
  if (disabled && !isMyTurn(view)) return null;
  if (amount > myMoney) {
    return (
      <>
        <TipTitle>Price too high for self-buy</TipTitle>
        <TipBody>If no one buys, you'll have to pay yourself — you only have ${myMoney}.</TipBody>
      </>
    );
  }
  return (
    <>
      <TipTitle>List for ${amount}</TipTitle>
      <TipBody>{AUCTION_RULES.fixed}</TipBody>
      <TipBody>
        Aim high enough that the painting's expected round value justifies it — but low enough that someone bites.
      </TipBody>
    </>
  );
}

export function fixedBuyTip(view: ModernArtPlayerView): React.ReactNode {
  const price = view.lot?.fixedPrice ?? 0;
  const myMoney = view.myMoney ?? 0;
  if (price > myMoney) {
    return (
      <>
        <TipTitle>Can't afford</TipTitle>
        <TipBody>List price ${price}; you have ${myMoney}.</TipBody>
      </>
    );
  }
  return (
    <>
      <TipTitle>Buy at ${price}</TipTitle>
      <TipBody>
        Pay the auctioneer ${price} and take the painting. Worth it if you expect this artist to place top-3 this round (or you want to push their tally toward the 5-sales cap).
      </TipBody>
    </>
  );
}

export function fixedPassTip(view: ModernArtPlayerView): React.ReactNode {
  const lot = view.lot;
  if (lot === null) return null;
  const remaining = Math.max(0, lot.fixedOfferOrder.length - lot.fixedOfferIndex - 1);
  return (
    <>
      <TipTitle>Pass</TipTitle>
      <TipBody>
        Decline the asking price. {remaining > 0
          ? `The next player (${remaining} after them) gets the same offer.`
          : "If everyone passes, the auctioneer must buy it at the asking price (paid to the bank)."}
      </TipBody>
    </>
  );
}

export function offerDoublePassTip(view: ModernArtPlayerView): React.ReactNode {
  if (!isMyTurn(view)) return null;
  return (
    <>
      <TipTitle>Don't double</TipTitle>
      <TipBody>
        Skip — keep your matching painting for later and let the offer pass to the next player. If everyone passes, the original auctioneer keeps the Double card for free (it still counts toward the artist's round tally).
      </TipBody>
    </>
  );
}

// ---------------------------------------------------------------------------
// Players panel
// ---------------------------------------------------------------------------

interface PlayerRowTipArgs {
  view: ModernArtPlayerView;
  playerID: ModernArtPlayerID;
}

export function playerRowTip({ view, playerID }: PlayerRowTipArgs): React.ReactNode {
  const isMe = playerID === view.myPlayerID;
  const isHammer = playerID === view.hammer;
  const player = view.players[playerID];
  const isActive = view.activePlayers.includes(playerID);
  return (
    <>
      <TipTitle>{playerName(playerID)}{isMe ? " (you)" : ""}{isHammer ? " · hammer" : ""}</TipTitle>
      <TipBody>
        <span className="tip-em">Hand:</span> {player.handCount} card{player.handCount === 1 ? "" : "s"} left to sell. <span className="tip-em">Gallery:</span> {player.gallery.length} painting{player.gallery.length === 1 ? "" : "s"} pending payout.
      </TipBody>
      <TipBody>
        {isMe
          ? `Cash: $${player.money ?? view.myMoney ?? 0}.`
          : "Their cash is hidden until the game ends."}
        {isActive ? " Currently acting." : ""}
      </TipBody>
    </>
  );
}

// ---------------------------------------------------------------------------
// Lot stage header
// ---------------------------------------------------------------------------

interface StageHeaderTipArgs {
  view: ModernArtPlayerView;
}

export function lotHeaderTip({ view }: StageHeaderTipArgs): React.ReactNode {
  const lot = view.lot;
  if (lot === null) {
    return (
      <>
        <TipTitle>No lot yet</TipTitle>
        <TipBody>The hammer plays the next painting from their hand to open an auction.</TipBody>
      </>
    );
  }
  return (
    <>
      <TipTitle>Current lot · {AUCTION_NAME[lot.type]}</TipTitle>
      <TipBody>{AUCTION_RULES[lot.type]}</TipBody>
    </>
  );
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function isMyTurn(view: ModernArtPlayerView): boolean {
  const me = view.myPlayerID;
  return me !== null && view.activePlayers.includes(me);
}

// Re-exports for type completeness (consumers won't typically need these).
export type {
  PublicAuctionLot,
  PhaseName,
};
