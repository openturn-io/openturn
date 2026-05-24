import { ARTIST_DATA, CARD_BY_ID } from "./data";
import {
  type ModernArtPlayerID,
  type ModernArtPlayerView,
  type ModernArtState,
  type PhaseName,
  type PublicAuctionLot,
  type PublicPlayerData,
} from "./state";
import { activeOpenPlayers } from "./rules";

export function activePlayersForPhase(
  G: ModernArtState,
  phase: PhaseName,
): readonly ModernArtPlayerID[] {
  const lot = G.lot;
  if (phase === "selectPainting") {
    return G.players[G.hammer]?.hand.length > 0 ? [G.hammer] : [];
  }
  if (lot === null) return [];
  if (phase === "doubleOffer") {
    if (lot.cards.length !== 1) return [];
    if (lot.doubleOfferIndex < 0) return [lot.originalAuctioneer];
    const actor = lot.doubleOfferOrder[lot.doubleOfferIndex];
    if (actor === undefined) return [lot.originalAuctioneer];
    return [actor];
  }
  if (phase === "fixedPriceSet") return [lot.auctioneer];
  if (phase === "fixedPriceOffer") {
    const actor = lot.fixedOfferOrder[lot.fixedOfferIndex];
    return actor === undefined ? [] : [actor];
  }
  if (phase === "hiddenAuction") {
    return G.seatOrder.filter((id) => lot.hiddenBids[id] === undefined);
  }
  if (phase === "oneOfferAuction") {
    const actor = lot.oneOfferOrder[lot.oneOfferIndex];
    return actor === undefined ? [] : [actor];
  }
  if (phase === "openAuction") return activeOpenPlayers(G);
  return [];
}

function publicLot(G: ModernArtState): PublicAuctionLot | null {
  const lot = G.lot;
  if (lot === null) return null;
  return {
    auctioneer: lot.auctioneer,
    cards: [...lot.cards],
    fixedOfferIndex: lot.fixedOfferIndex,
    fixedOfferOrder: [...lot.fixedOfferOrder],
    fixedPrice: lot.fixedPrice,
    hiddenBidPlayers: G.seatOrder.filter((id) => lot.hiddenBids[id] !== undefined),
    highBid: lot.highBid === null ? null : { ...lot.highBid },
    oneOfferIndex: lot.oneOfferIndex,
    oneOfferOrder: [...lot.oneOfferOrder],
    originalAuctioneer: lot.originalAuctioneer,
    passed: { ...lot.passed },
    type: lot.type,
  };
}

export function computePlayerView(
  G: ModernArtState,
  phase: PhaseName,
  myID: ModernArtPlayerID | null,
): ModernArtPlayerView {
  const players = {} as Record<ModernArtPlayerID, PublicPlayerData>;
  const finalMoney = G.revealedMoney;
  for (const id of G.seatOrder) {
    const player = G.players[id];
    players[id] = {
      gallery: [...player.gallery],
      handCount: player.hand.length,
      money: finalMoney?.[id] ?? (id === myID ? player.money : null),
      playerID: id,
    };
  }

  const myHiddenBid = myID === null || G.lot === null ? null : G.lot.hiddenBids[myID] ?? null;
  const myMoney = myID === null ? null : G.players[myID]?.money ?? null;
  return {
    activePlayers: activePlayersForPhase(G, phase),
    artists: ARTIST_DATA,
    cards: CARD_BY_ID,
    deckCount: G.deck.length,
    hammer: G.hammer,
    lastAction: G.lastAction,
    lot: publicLot(G),
    myHand: myID === null ? [] : [...(G.players[myID]?.hand ?? [])],
    myHiddenBid,
    myMoney: finalMoney?.[myID ?? "0"] ?? myMoney,
    myPlayerID: myID,
    offeredCounts: { ...G.offeredCounts },
    phase,
    players,
    revealedMoney: finalMoney === null ? null : { ...finalMoney },
    round: G.round,
    roundSummary: G.roundSummary,
    seatOrder: [...G.seatOrder],
    valueTiles: {
      christinP: [...G.valueTiles.christinP],
      karlGitter: [...G.valueTiles.karlGitter],
      krypto: [...G.valueTiles.krypto],
      liteMetal: [...G.valueTiles.liteMetal],
      yoko: [...G.valueTiles.yoko],
    },
    winners: [...G.winners],
  };
}
