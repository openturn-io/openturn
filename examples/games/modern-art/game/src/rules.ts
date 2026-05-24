import { CARD_BY_ID, getCard } from "./data";
import {
  ARTISTS,
  type ArtistID,
  type AuctionLot,
  type Bid,
  type ModernArtPlayerID,
  type ModernArtState,
  type PlayerState,
  type RoundSummary,
  emptyArtistRecord,
} from "./state";
import { ROUND_DEALS } from "./setup";

export interface RoundTransition {
  result: { winner: ModernArtPlayerID; winners: readonly ModernArtPlayerID[] } | null;
  state: ModernArtState;
}

export function playerLabel(playerID: ModernArtPlayerID): string {
  return `Curator ${Number.parseInt(playerID, 10) + 1}`;
}

export function seatAfter(
  seats: readonly ModernArtPlayerID[],
  playerID: ModernArtPlayerID,
): ModernArtPlayerID {
  const index = seats.indexOf(playerID);
  return seats[(index + 1) % seats.length]!;
}

export function seatsFromLeft(
  seats: readonly ModernArtPlayerID[],
  playerID: ModernArtPlayerID,
  includePlayer: boolean,
): ModernArtPlayerID[] {
  const out: ModernArtPlayerID[] = [];
  let current = seatAfter(seats, playerID);
  while (current !== playerID) {
    out.push(current);
    current = seatAfter(seats, current);
  }
  if (includePlayer) out.push(playerID);
  return out;
}

export function playerCanBid(G: ModernArtState, playerID: ModernArtPlayerID, currentBid: number): boolean {
  return G.players[playerID].money > currentBid;
}

export function updatePlayer(
  players: ModernArtState["players"],
  playerID: ModernArtPlayerID,
  next: PlayerState,
): ModernArtState["players"] {
  return { ...players, [playerID]: next };
}

export function removeCardFromHand(
  G: ModernArtState,
  playerID: ModernArtPlayerID,
  cardID: string,
): ModernArtState | null {
  const player = G.players[playerID];
  if (!player.hand.includes(cardID)) return null;
  const hand = player.hand.filter((id) => id !== cardID);
  return {
    ...G,
    players: updatePlayer(G.players, playerID, { ...player, hand }),
  };
}

export function incrementOfferedCount(G: ModernArtState, cardID: string): ModernArtState {
  const card = getCard(cardID);
  return {
    ...G,
    offeredCounts: {
      ...G.offeredCounts,
      [card.artist]: G.offeredCounts[card.artist] + 1,
    },
  };
}

export function anySeatedPlayerHasCards(G: ModernArtState): boolean {
  return G.seatOrder.some((id) => G.players[id].hand.length > 0);
}

export function allSeatedHandsEmpty(G: ModernArtState): boolean {
  return G.seatOrder.every((id) => G.players[id].hand.length === 0);
}

export function nextHammerWithCards(
  G: ModernArtState,
  afterPlayer: ModernArtPlayerID,
): ModernArtPlayerID | null {
  let current = seatAfter(G.seatOrder, afterPlayer);
  for (let i = 0; i < G.seatOrder.length; i += 1) {
    if (G.players[current].hand.length > 0) return current;
    current = seatAfter(G.seatOrder, current);
  }
  return null;
}

export function artistHitsRoundEnd(G: ModernArtState, cardID: string): boolean {
  const artist = getCard(cardID).artist;
  return G.offeredCounts[artist] >= 5;
}

export function buildLot(
  G: ModernArtState,
  cards: readonly string[],
  originalAuctioneer: ModernArtPlayerID,
  auctioneer: ModernArtPlayerID,
): AuctionLot {
  const type = getCard(cards[cards.length - 1]!).type;
  if (type === "double") {
    throw new Error("double card cannot be the resolving auction type");
  }
  return {
    auctioneer,
    cards,
    doubleOfferIndex: 0,
    doubleOfferOrder: [],
    fixedOfferIndex: 0,
    fixedOfferOrder: seatsFromLeft(G.seatOrder, auctioneer, false),
    fixedPrice: null,
    hiddenBids: {},
    highBid: null,
    oneOfferIndex: 0,
    oneOfferOrder: seatsFromLeft(G.seatOrder, auctioneer, true),
    originalAuctioneer,
    passed: {},
    type,
  };
}

export function buildDoubleLot(
  G: ModernArtState,
  cardID: string,
  auctioneer: ModernArtPlayerID,
): AuctionLot {
  return {
    auctioneer,
    cards: [cardID],
    doubleOfferIndex: -1,
    doubleOfferOrder: seatsFromLeft(G.seatOrder, auctioneer, false),
    fixedOfferIndex: 0,
    fixedOfferOrder: [],
    fixedPrice: null,
    hiddenBids: {},
    highBid: null,
    oneOfferIndex: 0,
    oneOfferOrder: [],
    originalAuctioneer: auctioneer,
    passed: {},
    type: "open",
  };
}

export function activeOpenPlayers(G: ModernArtState): readonly ModernArtPlayerID[] {
  const lot = G.lot;
  if (lot === null) return [];
  const current = lot.highBid?.amount ?? 0;
  return G.seatOrder.filter((id) => {
    if (lot.highBid?.player === id) return false;
    if (lot.passed[id] === true) return false;
    return playerCanBid(G, id, current);
  });
}

export function openAuctionShouldResolve(G: ModernArtState): boolean {
  return activeOpenPlayers(G).length === 0;
}

export function resolveOpenWinner(G: ModernArtState): Bid | null {
  return G.lot?.highBid ?? null;
}

export function hiddenWinner(G: ModernArtState): Bid | null {
  const lot = G.lot;
  if (lot === null) return null;
  let bestAmount = 0;
  for (const id of G.seatOrder) {
    bestAmount = Math.max(bestAmount, lot.hiddenBids[id] ?? 0);
  }
  if (bestAmount <= 0) return null;
  const order = [lot.auctioneer, ...seatsFromLeft(G.seatOrder, lot.auctioneer, false)];
  for (const id of order) {
    if ((lot.hiddenBids[id] ?? 0) === bestAmount) {
      return { amount: bestAmount, player: id };
    }
  }
  return null;
}

export function settleAuction(
  G: ModernArtState,
  winningBid: Bid | null,
  fallbackWinner: ModernArtPlayerID | null,
  detail: string,
): RoundTransition {
  const lot = G.lot;
  if (lot === null) return { result: null, state: G };

  const winner = winningBid?.player ?? fallbackWinner ?? lot.auctioneer;
  const amount = winningBid?.amount ?? 0;
  const winnerState = G.players[winner];
  let players = G.players;
  if (amount > 0) {
    const paidWinner: PlayerState = {
      ...winnerState,
      money: winnerState.money - amount,
    };
    players = updatePlayer(players, winner, paidWinner);
    if (winner !== lot.auctioneer) {
      const auctioneerState = players[lot.auctioneer];
      players = updatePlayer(players, lot.auctioneer, {
        ...auctioneerState,
        money: auctioneerState.money + amount,
      });
    }
  }

  const owner = players[winner];
  players = updatePlayer(players, winner, {
    ...owner,
    gallery: [...owner.gallery, ...lot.cards],
  });

  const soldState: ModernArtState = {
    ...G,
    hammer: nextHammerWithCards({ ...G, players }, lot.auctioneer) ?? lot.auctioneer,
    lastAction: {
      detail,
      kind: "sale",
      player: winner,
      round: G.round,
    },
    lot: null,
    players,
  };

  if (!anySeatedPlayerHasCards(soldState)) {
    return endRound(soldState, lot.auctioneer, "All hands are empty.");
  }

  return { result: null, state: soldState };
}

function roundRankings(G: ModernArtState): readonly ArtistID[] {
  return [...ARTISTS]
    .filter((artist) => G.offeredCounts[artist] > 0)
    .sort((a, b) => {
      const byCount = G.offeredCounts[b] - G.offeredCounts[a];
      if (byCount !== 0) return byCount;
      return ARTISTS.indexOf(a) - ARTISTS.indexOf(b);
    })
    .slice(0, 3);
}

function winnerResult(
  players: ModernArtState["players"],
  seats: readonly ModernArtPlayerID[],
): { winner: ModernArtPlayerID; winners: readonly ModernArtPlayerID[] } {
  let best = -1;
  for (const id of seats) {
    best = Math.max(best, players[id].money);
  }
  const winners = seats.filter((id) => players[id].money === best);
  return { winner: winners[0]!, winners };
}

function dealRound(
  G: ModernArtState,
  round: number,
): { deck: readonly string[]; players: ModernArtState["players"] } {
  let deck = [...G.deck];
  let players = G.players;
  const deal = ROUND_DEALS[G.seatOrder.length]?.[round - 1] ?? 0;
  for (const id of G.seatOrder) {
    const cardIDs = deck.slice(0, deal);
    deck = deck.slice(deal);
    const player = players[id];
    players = updatePlayer(players, id, {
      ...player,
      hand: [...player.hand, ...cardIDs],
    });
  }
  return { deck, players };
}

export function endRound(
  G: ModernArtState,
  lastActor: ModernArtPlayerID,
  detail: string,
): RoundTransition {
  const rankedArtists = roundRankings(G);
  const tileValues = [30, 20, 10] as const;
  const valueTiles = { ...G.valueTiles };
  const values = emptyArtistRecord(0);

  for (let i = 0; i < rankedArtists.length; i += 1) {
    const artist = rankedArtists[i]!;
    const tile = tileValues[i]!;
    const tiles = [...valueTiles[artist], tile];
    valueTiles[artist] = tiles;
    values[artist] = tiles.reduce((sum, n) => sum + n, 0);
  }

  const payouts = G.seatOrder.reduce((acc, id) => {
    acc[id] = 0;
    return acc;
  }, {} as Record<ModernArtPlayerID, number>);

  let players = G.players;
  for (const id of G.seatOrder) {
    const player = players[id];
    const payout = player.gallery.reduce((sum, cardID) => {
      const card = CARD_BY_ID[cardID]!;
      return sum + values[card.artist];
    }, 0);
    payouts[id] = payout;
    players = updatePlayer(players, id, {
      ...player,
      gallery: [],
      money: player.money + payout,
    });
  }

  const summary: RoundSummary = {
    counts: { ...G.offeredCounts },
    payouts,
    rankedArtists,
    round: G.round,
    values,
  };

  if (G.round >= 4) {
    const result = winnerResult(players, G.seatOrder);
    const revealedMoney = G.seatOrder.reduce((acc, id) => {
      acc[id] = players[id].money;
      return acc;
    }, {} as Record<ModernArtPlayerID, number>);
    return {
      result,
      state: {
        ...G,
        lastAction: { detail, kind: "payout", player: lastActor, round: G.round },
        lot: null,
        players,
        revealedMoney,
        roundSummary: summary,
        valueTiles,
        winners: result.winners,
      },
    };
  }

  const nextRound = G.round + 1;
  const dealt = dealRound({ ...G, players }, nextRound);
  const withCards: ModernArtState = {
    ...G,
    deck: dealt.deck,
    lastAction: { detail, kind: "payout", player: lastActor, round: G.round },
    lot: null,
    offeredCounts: emptyArtistRecord(0),
    players: dealt.players,
    round: nextRound,
    roundSummary: summary,
    valueTiles,
  };

  return {
    result: null,
    state: {
      ...withCards,
      hammer: nextHammerWithCards(withCards, lastActor) ?? G.seatOrder[0]!,
    },
  };
}

export function phaseForLot(lot: AuctionLot): "fixedPriceSet" | "hiddenAuction" | "oneOfferAuction" | "openAuction" {
  if (lot.type === "fixed") return "fixedPriceSet";
  if (lot.type === "hidden") return "hiddenAuction";
  if (lot.type === "oneOffer") return "oneOfferAuction";
  return "openAuction";
}

export function describeCards(cardIDs: readonly string[]): string {
  return cardIDs.map((id) => getCard(id).title).join(" + ");
}
