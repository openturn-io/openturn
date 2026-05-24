// @ts-nocheck
import { createRng, type ConfigSchema, type LegalAction } from "@openturn/core";
import { defineGame } from "@openturn/gamekit";

import { CARD_BY_ID, CARDS, getCard } from "./data";
import {
  activeOpenPlayers,
  allSeatedHandsEmpty,
  artistHitsRoundEnd,
  buildDoubleLot,
  buildLot,
  describeCards,
  endRound,
  hiddenWinner,
  openAuctionShouldResolve,
  phaseForLot,
  playerCanBid,
  playerLabel,
  removeCardFromHand,
  resolveOpenWinner,
  seatAfter,
  settleAuction,
} from "./rules";
import { buildInitialState } from "./setup";
import {
  ARTISTS,
  MAX_PLAYERS,
  MIN_PLAYERS,
  PLAYER_IDS,
  type ArtistID,
  type ModernArtPlayerID,
  type ModernArtPlayerView,
  type ModernArtState,
  type PhaseName,
} from "./state";
import { activePlayersForPhase, computePlayerView } from "./views";

export * from "./data";
export * from "./rules";
export * from "./setup";
export * from "./state";
export { activePlayersForPhase, computePlayerView } from "./views";

export interface PlayPaintingArgs {
  cardID: string;
}

export interface OfferDoubleArgs {
  cardID: string | null;
}

export interface BidAmountArgs {
  amount: number;
}

export interface OptionalBidArgs {
  amount: number | null;
}

export interface FixedResponseArgs {
  accept: boolean;
}

export type ModernArtLegalAction =
  | { event: "passOpenBid"; label: string; payload: undefined }
  | { event: "playPainting"; label: string; payload: PlayPaintingArgs }
  | { event: "offerDouble"; label: string; payload: OfferDoubleArgs }
  | { event: "raiseOpenBid"; label: string; payload: BidAmountArgs }
  | { event: "submitOneOffer"; label: string; payload: OptionalBidArgs }
  | { event: "submitHiddenBid"; label: string; payload: BidAmountArgs }
  | { event: "setFixedPrice"; label: string; payload: BidAmountArgs }
  | { event: "respondFixedPrice"; label: string; payload: FixedResponseArgs };

function finishOrGoto(
  outcome: ReturnType<typeof endRound>,
  phase: PhaseName,
  move: {
    finish: (result: { winner: ModernArtPlayerID; winners: readonly ModernArtPlayerID[] }, patch: Partial<ModernArtState>) => unknown;
    goto: (phase: PhaseName, patch: Partial<ModernArtState>) => unknown;
  },
) {
  if (outcome.result !== null) {
    return move.finish(outcome.result, outcome.state);
  }
  return move.goto(phase, outcome.state);
}

function isWholeMoney(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}

function auctionPhaseFromState(G: ModernArtState): PhaseName {
  const lot = G.lot;
  if (lot === null) return "selectPainting";
  if (lot.cards.length === 1 && getCard(lot.cards[0]!).type === "double") return "doubleOffer";
  if (lot.type === "fixed") return lot.fixedPrice === null ? "fixedPriceSet" : "fixedPriceOffer";
  if (lot.type === "hidden") return "hiddenAuction";
  if (lot.type === "oneOffer") return "oneOfferAuction";
  return "openAuction";
}

function bidChoices(G: ModernArtState, playerID: ModernArtPlayerID, minimum: number): number[] {
  const max = G.players[playerID].money;
  const candidates = [minimum, minimum + 1, minimum + 5, minimum + 10, 10, 20, 30, 40, 50, max]
    .filter((value) => value >= minimum && value <= max);
  return [...new Set(candidates)].sort((a, b) => a - b);
}

export function enumerateModernArtLegalActions(
  G: ModernArtState,
  playerID: ModernArtPlayerID,
  phase: PhaseName = auctionPhaseFromState(G),
): ModernArtLegalAction[] {
  if (!G.seatOrder.includes(playerID)) return [];
  if (!activePlayersForPhase(G, phase).includes(playerID)) return [];
  const lot = G.lot;

  if (phase === "selectPainting") {
    return G.players[playerID].hand.map((cardID) => ({
      event: "playPainting",
      label: `auction ${getCard(cardID).title}`,
      payload: { cardID },
    }));
  }

  if (lot === null) return [];

  if (phase === "doubleOffer") {
    const first = getCard(lot.cards[0]!);
    const matching = G.players[playerID].hand.filter((cardID) => {
      const card = getCard(cardID);
      return card.artist === first.artist && card.type !== "double";
    });
    return [
      ...matching.map((cardID) => ({
        event: "offerDouble" as const,
        label: `add ${getCard(cardID).title}`,
        payload: { cardID },
      })),
      { event: "offerDouble", label: "pass double", payload: { cardID: null } },
    ];
  }

  if (phase === "openAuction") {
    const current = lot.highBid?.amount ?? 0;
    return [
      ...bidChoices(G, playerID, current + 1).map((amount) => ({
        event: "raiseOpenBid" as const,
        label: `raise to ${amount}`,
        payload: { amount },
      })),
      { event: "passOpenBid", label: "pass", payload: undefined },
    ];
  }

  if (phase === "oneOfferAuction") {
    const current = lot.highBid?.amount ?? 0;
    return [
      ...bidChoices(G, playerID, current + 1).map((amount) => ({
        event: "submitOneOffer" as const,
        label: `bid ${amount}`,
        payload: { amount },
      })),
      { event: "submitOneOffer", label: "pass", payload: { amount: null } },
    ];
  }

  if (phase === "hiddenAuction") {
    return [0, ...bidChoices(G, playerID, 1)].map((amount) => ({
      event: "submitHiddenBid",
      label: amount === 0 ? "bid 0" : `bid ${amount}`,
      payload: { amount },
    }));
  }

  if (phase === "fixedPriceSet") {
    return bidChoices(G, playerID, 0).map((amount) => ({
      event: "setFixedPrice",
      label: `price ${amount}`,
      payload: { amount },
    }));
  }

  if (phase === "fixedPriceOffer") {
    return [
      { event: "respondFixedPrice", label: "buy", payload: { accept: true } },
      { event: "respondFixedPrice", label: "pass", payload: { accept: false } },
    ];
  }

  return [];
}

function selectPhaseActive(phase: PhaseName) {
  return ({ G }: { G: unknown }) => activePlayersForPhase(G as ModernArtState, phase);
}

export const modernArt = defineGame({
  config: {
    turnTimeoutMs: {
      default: 45_000,
      description: "Per-decision deadline for hosted multiplayer rooms.",
      format: (ms: number) => `${Math.round(ms / 1000)}s`,
      label: "Decision time",
      max: 300_000,
      min: 10_000,
      step: 5_000,
      type: "number",
    },
  } as const satisfies ConfigSchema,
  initialPhase: "selectPainting",
  legalActions: ({ G }, playerID): readonly LegalAction[] =>
    enumerateModernArtLegalActions(
      G as ModernArtState,
      playerID as ModernArtPlayerID,
      auctionPhaseFromState(G as ModernArtState),
    ),
  maxPlayers: MAX_PLAYERS,
  minPlayers: MIN_PLAYERS,
  phases: {
    doubleOffer: {
      activePlayers: selectPhaseActive("doubleOffer"),
      label: ({ G }) => `${playerLabel(G.lot?.originalAuctioneer ?? G.hammer)} opened a double auction`,
    },
    fixedPriceOffer: {
      activePlayers: selectPhaseActive("fixedPriceOffer"),
      label: ({ G }) => `Fixed price: ${G.lot?.fixedPrice ?? 0}`,
    },
    fixedPriceSet: {
      activePlayers: selectPhaseActive("fixedPriceSet"),
      label: ({ G }) => `${playerLabel(G.lot?.auctioneer ?? G.hammer)} sets the price`,
    },
    hiddenAuction: {
      activePlayers: selectPhaseActive("hiddenAuction"),
      label: ({ G }) => `${G.lot === null ? "Hidden" : describeCards(G.lot.cards)} hidden auction`,
    },
    oneOfferAuction: {
      activePlayers: selectPhaseActive("oneOfferAuction"),
      label: ({ G }) => `${G.lot === null ? "One offer" : describeCards(G.lot.cards)} one-offer auction`,
    },
    openAuction: {
      activePlayers: selectPhaseActive("openAuction"),
      label: ({ G }) => `${G.lot === null ? "Open" : describeCards(G.lot.cards)} open auction`,
    },
    selectPainting: {
      activePlayers: selectPhaseActive("selectPainting"),
      label: ({ G }) => `${playerLabel(G.hammer)} selects a painting`,
    },
  },
  playerIDs: PLAYER_IDS,
  setup: ({ match, seed }): ModernArtState => {
    const seats = match.players as readonly ModernArtPlayerID[];
    return buildInitialState(seats, createRng(seed));
  },
  moves: ({ move }) => ({
    offerDouble: move<OfferDoubleArgs>({
      phases: ["doubleOffer"],
      run({ G, args, move: m, player }) {
        const actor = player.id as ModernArtPlayerID;
        const lot = G.lot;
        if (lot === null || lot.cards.length !== 1) return m.invalid("no_double_offer");
        const expected = lot.doubleOfferIndex < 0
          ? lot.originalAuctioneer
          : lot.doubleOfferOrder[lot.doubleOfferIndex];
        if (actor !== expected) return m.invalid("not_your_double_offer");

        if (args.cardID === null) {
          const nextIndex = lot.doubleOfferIndex + 1;
          if (nextIndex >= lot.doubleOfferOrder.length) {
            const settled = settleAuction(
              G,
              null,
              lot.originalAuctioneer,
              `${playerLabel(lot.originalAuctioneer)} keeps ${getCard(lot.cards[0]!).title} for free`,
            );
            return finishOrGoto(settled, "selectPainting", m);
          }
          return m.stay({
            lastAction: {
              detail: `${playerLabel(actor)} passes on the double offer`,
              kind: "double",
              player: actor,
              round: G.round,
            },
            lot: { ...lot, doubleOfferIndex: nextIndex },
          });
        }

        const first = getCard(lot.cards[0]!);
        const second = getCard(args.cardID);
        if (second.artist !== first.artist) return m.invalid("double_artist_mismatch");
        if (second.type === "double") return m.invalid("double_cannot_follow_double");
        const removed = removeCardFromHand(G, actor, args.cardID);
        if (removed === null) return m.invalid("card_not_in_hand");
        const counted = {
          ...removed,
          offeredCounts: {
            ...removed.offeredCounts,
            [second.artist]: removed.offeredCounts[second.artist] + 1,
          },
        };
        if (artistHitsRoundEnd(counted, args.cardID) || allSeatedHandsEmpty(counted)) {
          const ended = endRound(
            { ...counted, lot: null },
            actor,
            `${playerLabel(actor)} adds ${second.title}; the lot is unsold and the round closes`,
          );
          return finishOrGoto(ended, "selectPainting", m);
        }
        const nextLot = buildLot(counted, [lot.cards[0]!, args.cardID], lot.originalAuctioneer, actor);
        return m.goto(phaseForLot(nextLot), {
          lastAction: {
            detail: `${playerLabel(actor)} adds ${second.title} to ${first.title}`,
            kind: "double",
            player: actor,
            round: G.round,
          },
          lot: nextLot,
          offeredCounts: counted.offeredCounts,
          players: counted.players,
        });
      },
    }),
    passOpenBid: move({
      phases: ["openAuction"],
      run({ G, move: m, player }) {
        const actor = player.id as ModernArtPlayerID;
        const lot = G.lot;
        if (lot === null) return m.invalid("no_open_auction");
        if (!activeOpenPlayers(G).includes(actor)) return m.invalid("cannot_pass_now");
        const nextLot = {
          ...lot,
          passed: { ...lot.passed, [actor]: true },
        };
        const next = {
          ...G,
          lastAction: {
            detail: `${playerLabel(actor)} passes`,
            kind: "pass" as const,
            player: actor,
            round: G.round,
          },
          lot: nextLot,
        };
        if (openAuctionShouldResolve(next)) {
          const winningBid = resolveOpenWinner(next);
          const settled = settleAuction(
            next,
            winningBid,
            null,
            winningBid === null
              ? `${playerLabel(lot.auctioneer)} receives ${describeCards(lot.cards)} for free`
              : `${playerLabel(winningBid.player)} buys ${describeCards(lot.cards)} for ${winningBid.amount}`,
          );
          return finishOrGoto(settled, "selectPainting", m);
        }
        return m.stay(next);
      },
    }),
    playPainting: move<PlayPaintingArgs>({
      phases: ["selectPainting"],
      run({ G, args, move: m, player }) {
        const actor = player.id as ModernArtPlayerID;
        if (actor !== G.hammer) return m.invalid("not_hammer");
        const card = CARD_BY_ID[args.cardID];
        if (card === undefined) return m.invalid("unknown_card");
        const removed = removeCardFromHand(G, actor, args.cardID);
        if (removed === null) return m.invalid("card_not_in_hand");
        const counted = {
          ...removed,
          offeredCounts: {
            ...removed.offeredCounts,
            [card.artist]: removed.offeredCounts[card.artist] + 1,
          },
        };
        if (artistHitsRoundEnd(counted, args.cardID) || allSeatedHandsEmpty(counted)) {
          const ended = endRound(
            { ...counted, lot: null },
            actor,
            `${playerLabel(actor)} plays ${card.title}; it is unsold and closes the round`,
          );
          return finishOrGoto(ended, "selectPainting", m);
        }
        if (card.type === "double") {
          return m.goto("doubleOffer", {
            lastAction: {
              detail: `${playerLabel(actor)} opens a double auction with ${card.title}`,
              kind: "play",
              player: actor,
              round: G.round,
            },
            lot: buildDoubleLot(counted, args.cardID, actor),
            offeredCounts: counted.offeredCounts,
            players: counted.players,
          });
        }
        const lot = buildLot(counted, [args.cardID], actor, actor);
        return m.goto(phaseForLot(lot), {
          lastAction: {
            detail: `${playerLabel(actor)} offers ${card.title}`,
            kind: "play",
            player: actor,
            round: G.round,
          },
          lot,
          offeredCounts: counted.offeredCounts,
          players: counted.players,
        });
      },
    }),
    raiseOpenBid: move<BidAmountArgs>({
      phases: ["openAuction"],
      run({ G, args, move: m, player }) {
        const actor = player.id as ModernArtPlayerID;
        const lot = G.lot;
        if (lot === null) return m.invalid("no_open_auction");
        const current = lot.highBid?.amount ?? 0;
        if (!isWholeMoney(args.amount) || args.amount <= current) return m.invalid("bid_too_low");
        if (!playerCanBid(G, actor, current)) return m.invalid("cannot_bid_now");
        if (args.amount > G.players[actor].money) return m.invalid("insufficient_money");
        const nextLot = {
          ...lot,
          highBid: { amount: args.amount, player: actor },
          passed: {},
        };
        return m.stay({
          lastAction: {
            detail: `${playerLabel(actor)} bids ${args.amount}`,
            kind: "bid",
            player: actor,
            round: G.round,
          },
          lot: nextLot,
        });
      },
    }),
    respondFixedPrice: move<FixedResponseArgs>({
      phases: ["fixedPriceOffer"],
      run({ G, args, move: m, player }) {
        const actor = player.id as ModernArtPlayerID;
        const lot = G.lot;
        if (lot === null || lot.fixedPrice === null) return m.invalid("no_fixed_price");
        const expected = lot.fixedOfferOrder[lot.fixedOfferIndex];
        if (actor !== expected) return m.invalid("not_your_offer");
        const price = lot.fixedPrice;
        if (args.accept) {
          if (G.players[actor].money < price) return m.invalid("insufficient_money");
          const settled = settleAuction(
            G,
            { amount: price, player: actor },
            null,
            `${playerLabel(actor)} accepts ${price} for ${describeCards(lot.cards)}`,
          );
          return finishOrGoto(settled, "selectPainting", m);
        }
        const nextIndex = lot.fixedOfferIndex + 1;
        if (nextIndex >= lot.fixedOfferOrder.length) {
          const settled = settleAuction(
            G,
            { amount: price, player: lot.auctioneer },
            null,
            `${playerLabel(lot.auctioneer)} buys ${describeCards(lot.cards)} for ${price}`,
          );
          return finishOrGoto(settled, "selectPainting", m);
        }
        return m.stay({
          lastAction: {
            detail: `${playerLabel(actor)} declines ${price}`,
            kind: "fixed",
            player: actor,
            round: G.round,
          },
          lot: { ...lot, fixedOfferIndex: nextIndex },
        });
      },
    }),
    setFixedPrice: move<BidAmountArgs>({
      phases: ["fixedPriceSet"],
      run({ G, args, move: m, player }) {
        const actor = player.id as ModernArtPlayerID;
        const lot = G.lot;
        if (lot === null) return m.invalid("no_fixed_auction");
        if (actor !== lot.auctioneer) return m.invalid("not_auctioneer");
        if (!isWholeMoney(args.amount)) return m.invalid("invalid_price");
        if (args.amount > G.players[actor].money) return m.invalid("price_above_money");
        return m.goto("fixedPriceOffer", {
          lastAction: {
            detail: `${playerLabel(actor)} sets ${args.amount} for ${describeCards(lot.cards)}`,
            kind: "fixed",
            player: actor,
            round: G.round,
          },
          lot: { ...lot, fixedPrice: args.amount },
        });
      },
    }),
    submitHiddenBid: move<BidAmountArgs>({
      phases: ["hiddenAuction"],
      run({ G, args, move: m, player }) {
        const actor = player.id as ModernArtPlayerID;
        const lot = G.lot;
        if (lot === null) return m.invalid("no_hidden_auction");
        if (lot.hiddenBids[actor] !== undefined) return m.invalid("already_bid");
        if (!isWholeMoney(args.amount)) return m.invalid("invalid_bid");
        if (args.amount > G.players[actor].money) return m.invalid("insufficient_money");
        const nextLot = {
          ...lot,
          hiddenBids: { ...lot.hiddenBids, [actor]: args.amount },
        };
        const next = {
          ...G,
          lastAction: {
            detail: `${playerLabel(actor)} submits a hidden bid`,
            kind: "hidden" as const,
            player: actor,
            round: G.round,
          },
          lot: nextLot,
        };
        if (activePlayersForPhase(next, "hiddenAuction").length === 0) {
          const winningBid = hiddenWinner(next);
          const settled = settleAuction(
            next,
            winningBid,
            null,
            winningBid === null
              ? `${playerLabel(lot.auctioneer)} receives ${describeCards(lot.cards)} for free`
              : `${playerLabel(winningBid.player)} wins the hidden auction for ${winningBid.amount}`,
          );
          return finishOrGoto(settled, "selectPainting", m);
        }
        return m.stay(next);
      },
    }),
    submitOneOffer: move<OptionalBidArgs>({
      phases: ["oneOfferAuction"],
      run({ G, args, move: m, player }) {
        const actor = player.id as ModernArtPlayerID;
        const lot = G.lot;
        if (lot === null) return m.invalid("no_one_offer_auction");
        const expected = lot.oneOfferOrder[lot.oneOfferIndex];
        if (actor !== expected) return m.invalid("not_your_offer");
        const current = lot.highBid?.amount ?? 0;
        let highBid = lot.highBid;
        let detail = `${playerLabel(actor)} passes`;
        if (args.amount !== null) {
          if (!isWholeMoney(args.amount) || args.amount <= current) return m.invalid("bid_too_low");
          if (args.amount > G.players[actor].money) return m.invalid("insufficient_money");
          highBid = { amount: args.amount, player: actor };
          detail = `${playerLabel(actor)} offers ${args.amount}`;
        }
        const nextLot = {
          ...lot,
          highBid,
          oneOfferIndex: lot.oneOfferIndex + 1,
        };
        const next = {
          ...G,
          lastAction: {
            detail,
            kind: args.amount === null ? "pass" as const : "bid" as const,
            player: actor,
            round: G.round,
          },
          lot: nextLot,
        };
        if (nextLot.oneOfferIndex >= nextLot.oneOfferOrder.length) {
          const settled = settleAuction(
            next,
            nextLot.highBid,
            null,
            nextLot.highBid === null
              ? `${playerLabel(lot.auctioneer)} receives ${describeCards(lot.cards)} for free`
              : `${playerLabel(nextLot.highBid.player)} buys ${describeCards(lot.cards)} for ${nextLot.highBid.amount}`,
          );
          return finishOrGoto(settled, "selectPainting", m);
        }
        return m.stay(next);
      },
    }),
  }),
  views: {
    player: ({ G, phase }, player): ModernArtPlayerView =>
      computePlayerView(G as ModernArtState, phase as PhaseName, player.id as ModernArtPlayerID),
    public: ({ G, phase }): ModernArtPlayerView =>
      computePlayerView(G as ModernArtState, phase as PhaseName, null),
  },
});

void ARTISTS;
void CARDS;
void seatAfter;
