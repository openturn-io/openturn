import { pickWinner } from "./rules";
import {
  type PublicPlayerData,
  type SplendorPlayerID,
  type SplendorPlayerView,
  type SplendorState,
} from "./state";

export function computePlayerView(
  G: SplendorState,
  currentPlayer: SplendorPlayerID,
  isFinished: boolean,
  myID: SplendorPlayerID | null,
): SplendorPlayerView {
  const players = {} as Record<SplendorPlayerID, PublicPlayerData>;
  for (const id of G.seatOrder) {
    const p = G.players[id];
    players[id] = {
      playerID: id,
      chips: { ...p.chips },
      bonuses: { ...p.bonuses },
      reservedCount: p.reserved.length,
      nobles: [...p.nobles],
      score: p.score,
      mustDiscard: p.mustDiscard,
      reservedCards: id === myID ? [...p.reserved] : [],
    };
  }
  const winner = isFinished ? pickWinner(G.players, G.seatOrder) : null;
  return {
    myPlayerID: myID,
    currentTurn: isFinished ? null : currentPlayer,
    winner,
    isFinalRound: G.lastRoundTrigger !== null,
    bank: { ...G.bank },
    market: {
      tier1: [...G.market.tier1],
      tier2: [...G.market.tier2],
      tier3: [...G.market.tier3],
    },
    deckCounts: {
      tier1: G.decks.tier1.length,
      tier2: G.decks.tier2.length,
      tier3: G.decks.tier3.length,
    },
    nobles: [...G.nobles],
    players,
    seatOrder: [...G.seatOrder],
    lastAction: G.lastAction,
  };
}

export function computePublicView(
  G: SplendorState,
  currentPlayer: SplendorPlayerID,
  isFinished: boolean,
): SplendorPlayerView {
  return computePlayerView(G, currentPlayer, isFinished, null);
}
