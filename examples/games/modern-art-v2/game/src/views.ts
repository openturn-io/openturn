import { pickWealthiest } from "./rules";
import {
  type AuctionState,
  type ModernArtPlayerID,
  type ModernArtPlayerView,
  type ModernArtPublicView,
  type PublicAuctionView,
  type PublicPlayerData,
  type ModernArtState,
} from "./state";

/**
 * Build the public projection of the in-flight auction. Sealed bid amounts are
 * stripped — only *who* has submitted is public.
 */
export function projectAuction(a: AuctionState): PublicAuctionView {
  return {
    artist: a.artist,
    type: a.type,
    auctioneer: a.auctioneer,
    paintings: [...a.paintings],
    highBid: a.highBid,
    highBidder: a.highBidder,
    fixedPrice: a.fixedPrice,
    pendingBidders: [...a.pendingBidders],
    passed: [...a.passed],
    sealedSubmitted:
      a.type === "sealed"
        ? Object.entries(a.sealedBids)
            .filter(([, v]) => v !== null)
            .map(([id]) => id as ModernArtPlayerID)
        : [],
  };
}

function projectPlayers(
  G: ModernArtState,
  myID: ModernArtPlayerID | null,
): Record<ModernArtPlayerID, PublicPlayerData> {
  const out = {} as Record<ModernArtPlayerID, PublicPlayerData>;
  for (const id of G.seatOrder) {
    const p = G.players[id];
    out[id] = {
      playerID: id,
      money: p.money,
      collection: { ...p.collection },
      handSize: p.hand.length,
    };
  }
  return out;
}

export function computePlayerView(
  G: ModernArtState,
  currentTurn: ModernArtPlayerID | null,
  isFinished: boolean,
  myID: ModernArtPlayerID | null,
): ModernArtPlayerView {
  const base = computePublicView(G, currentTurn, isFinished);
  const myHand = myID === null ? [] : [...G.players[myID]!.hand];
  const mySealedBid =
    myID !== null &&
    G.currentAuction !== null &&
    G.currentAuction.type === "sealed"
      ? G.currentAuction.sealedBids[myID] ?? null
      : null;
  return { ...base, myPlayerID: myID, myHand, mySealedBid };
}

export function computePublicView(
  G: ModernArtState,
  currentTurn: ModernArtPlayerID | null,
  isFinished: boolean,
): ModernArtPublicView {
  const winner = isFinished
    ? (pickWealthiest(G.players, G.seatOrder) as ModernArtPlayerID)
    : null;
  return {
    myPlayerID: null,
    currentTurn: isFinished ? null : currentTurn,
    winner,
    round: G.round,
    totalRounds: 4,
    deckSize: G.deck.length,
    countsSold: { ...G.countsSold },
    cumulativeValue: { ...G.cumulativeValue },
    auction: G.currentAuction === null ? null : projectAuction(G.currentAuction),
    players: projectPlayers(G, null),
    seatOrder: [...G.seatOrder],
    lastAction: G.lastAction,
    lastPayout: G.payoutHistory.length > 0 ? G.payoutHistory[G.payoutHistory.length - 1]! : null,
  };
}
