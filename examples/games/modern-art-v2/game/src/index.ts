import { createRng, deadline, type DeepReadonly } from "@openturn/core";
import { defineGame, turn, type MoveHelpers } from "@openturn/gamekit";

import { getPainting } from "./data";
import { biddingRing, resolveDouble, isValidRaise } from "./auctions";
import { computeCumulativeValues, rankArtists, scoreRound } from "./rules";
import { buildInitialState } from "./setup";
import {
  PAYOUT_TOP_3,
  ROUND_END_THRESHOLD,
  TOTAL_ROUNDS,
  type ActionLog,
  type ActionLogKind,
  type Artist,
  type AuctionState,
  type AuctionType,
  type ModernArtPlayerID,
  type ModernArtPlayerView,
  type ModernArtPublicView,
  type ModernArtState,
  type PaintingID,
  type PayoutRow,
  type PlayerData,
} from "./state";
import { computePlayerView, computePublicView } from "./views";

export * from "./state";
export { ALL_PAINTINGS, ALL_PAINTING_IDS, getPainting, PAINTING_BY_ID } from "./data";
export {
  computeCumulativeValues,
  rankArtists,
  scoreRound,
  pickWealthiest,
} from "./rules";
export { resolveDouble, biddingRing, isValidRaise } from "./auctions";

// ---------------------------------------------------------------------------
// Move payloads
// ---------------------------------------------------------------------------

export interface StartAuctionArgs {
  paintingId: PaintingID;
  /** Required for a double auction when the auctioneer chooses to pair a 2nd card. */
  doublePaintingId?: PaintingID;
}

export interface PlaceBidArgs {
  amount: number;
}

export interface SealBidArgs {
  amount: number;
}

export interface SetFixedPriceArgs {
  price: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function log(
  kind: ActionLogKind,
  player: ModernArtPlayerID,
  detail: string,
  turnNumber: number,
): ActionLog {
  return { kind, player, detail, turn: turnNumber };
}

function withPlayer(
  players: ModernArtState["players"],
  id: ModernArtPlayerID,
  next: PlayerData,
): ModernArtState["players"] {
  return { ...players, [id]: next };
}

function removeFromHand(hand: readonly PaintingID[], id: PaintingID): PaintingID[] {
  const out = [...hand];
  const idx = out.indexOf(id);
  if (idx !== -1) out.splice(idx, 1);
  return out;
}

/**
 * The auctioneer for the current turn. `seatIndex` is the 0-based position in
 * seatOrder (= `t.index` from gamekit turn contexts). For 1-based turn numbers
 * (snapshot.position.turn), convert first: seatIndex = ((turn - 1) % len).
 */
function currentAuctioneer(G: ModernArtState, seatIndex: number): ModernArtPlayerID {
  const len = G.seatOrder.length;
  return G.seatOrder[((seatIndex % len) + len) % len]!;
}

/**
 * Determine whose turn it is to act in the current state.
 * - If an auction is in flight, it's the first pending bidder.
 * - Otherwise it's the auctioneer (whose turn it is per round-robin).
 */
export function activePlayerFor(
  G: ModernArtState,
  turnIndex: number,
): ModernArtPlayerID {
  if (G.currentAuction !== null) {
    return G.currentAuction.pendingBidders[0] ?? G.currentAuction.auctioneer;
  }
  return currentAuctioneer(G, turnIndex);
}

function emptyArtistCounts(): Record<Artist, number> {
  return { krypto: 0, karlGitter: 0, cristinP: 0, yoko: 0, liteMetal: 0 };
}

// ---------------------------------------------------------------------------
// Auction resolution — returns the next state plus an optional finish marker.
// ---------------------------------------------------------------------------

interface Resolution {
  state: ModernArtState;
  finish: { winner: ModernArtPlayerID } | null;
}

/**
 * Auto-pass the stalled seat at the head of `pendingBidders`. Used by the
 * phase `onTimeout` to advance the game when the turn deadline elapses mid-
 * auction: the framework dispatches timeout moves as the round-robin
 * auctioneer (`ctx.player.id`), which is the wrong seat whenever a bid is in
 * flight, so we bypass the player-bound move path and replay the head
 * bidder's "pass" decision directly. Mirrors the per-type branches in
 * `passBid` / `declineFixed` / `continueSealed` — keep them in sync.
 */
function autoPassHeadBidder(G: ModernArtState, turnNumber: number): Resolution {
  const auction = G.currentAuction!;
  const head = auction.pendingBidders[0]!;

  // Fixed-price auction. The auctioneer must set the price before anyone can
  // buy/decline; if the stalled seat is the auctioneer, force the price to 0
  // so the auction resolves with no sale (auctioneer keeps it free). A buyer
  // head simply declines, falling through to runDeclineFixed.
  if (auction.type === "fixed") {
    if (auction.fixedPrice === null) {
      const priced: AuctionState = { ...auction, fixedPrice: 0, pendingBidders: [] };
      const action = log(
        "startAuction",
        head,
        `P${Number.parseInt(head, 10) + 1} fixed ${auction.artist} @ $0 (timeout)`,
        turnNumber,
      );
      const pricedState: ModernArtState = { ...G, currentAuction: priced, lastAction: action };
      return runDeclineFixed(pricedState, priced, auction.auctioneer, turnNumber);
    }
    return runDeclineFixed(G, auction, head, turnNumber);
  }

  // Sealed auction: the head bidder submits a null bid (pass).
  if (auction.type === "sealed") {
    const sealedBids: Record<ModernArtPlayerID, number | null> = {
      ...auction.sealedBids,
      [head]: null,
    };
    const remaining = auction.pendingBidders.slice(1);
    return continueSealedState(G, auction, sealedBids, remaining, head, turnNumber);
  }

  // Open / once-around auction.
  const passed = [...auction.passed, head];
  if (auction.type === "once") {
    const pendingBidders = auction.pendingBidders.slice(1);
    const updatedAuction: AuctionState = { ...auction, pendingBidders, passed };
    if (pendingBidders.length === 0) {
      return resolveOutcomeState(G, updatedAuction, turnNumber);
    }
    const working: ModernArtState = {
      ...G,
      currentAuction: updatedAuction,
      lastAction: log("pass", head, `P${Number.parseInt(head, 10) + 1} passed (timeout)`, turnNumber),
    };
    return { state: working, finish: null };
  }

  // Open: resolve when nobody but the high bidder (or nobody) can still raise.
  const ring = biddingRing(G.seatOrder, auction.auctioneer).filter((id) => !passed.includes(id));
  const canStillRaise = ring.filter((id) => id !== auction.highBidder);
  if (canStillRaise.length === 0) {
    const updatedAuction: AuctionState = { ...auction, pendingBidders: [], passed };
    return resolveOutcomeState(G, updatedAuction, turnNumber);
  }
  const updatedAuction: AuctionState = { ...auction, pendingBidders: canStillRaise, passed };
  const working: ModernArtState = {
    ...G,
    currentAuction: updatedAuction,
    lastAction: log("pass", head, `P${Number.parseInt(head, 10) + 1} passed (timeout)`, turnNumber),
  };
  return { state: working, finish: null };
}

/**
 * Pure variant of `runDecline` that returns a `Resolution` instead of a
 * MoveOutcome, so it can be called from both move handlers and the timeout
 * auto-pass path.
 */
function runDeclineFixed(
  state: ModernArtState,
  auction: AuctionState,
  playerID: ModernArtPlayerID,
  turnNumber: number,
): Resolution {
  const remaining = auction.pendingBidders.slice(1);
  if (remaining.length > 0) {
    const updatedAuction: AuctionState = { ...auction, pendingBidders: remaining };
    const working: ModernArtState = {
      ...state,
      currentAuction: updatedAuction,
      lastAction: log("declineFixed", playerID, `P${Number.parseInt(playerID, 10) + 1} declined (timeout)`, turnNumber),
    };
    return { state: working, finish: null };
  }
  // Nobody bought at the fixed price → auctioneer buys it at the fixed price
  // (or keeps it free if they can't afford their own price).
  const price = auction.fixedPrice ?? 0;
  const seller = state.players[auction.auctioneer]!;
  if (seller.money < price) {
    const action = log(
      "noBids",
      auction.auctioneer,
      `nobody bought ${auction.artist}; auctioneer keeps free`,
      turnNumber,
    );
    const working: ModernArtState = {
      ...state,
      currentAuction: { ...auction, highBid: 0, highBidder: null, pendingBidders: [] },
      lastAction: action,
    };
    return resolveAuction(working, action);
  }
  const action = log(
    "buyFixed",
    auction.auctioneer,
    `nobody bought; auctioneer pays $${price}`,
    turnNumber,
  );
  const working: ModernArtState = {
    ...state,
    currentAuction: { ...auction, highBid: price, highBidder: auction.auctioneer, pendingBidders: [] },
    lastAction: action,
  };
  return resolveAuction(working, action);
}

/**
 * Pure variant of `continueSealed` that returns a `Resolution`.
 */
function continueSealedState(
  state: ModernArtState,
  auction: AuctionState,
  sealedBids: Record<ModernArtPlayerID, number | null>,
  remaining: ModernArtPlayerID[],
  playerID: ModernArtPlayerID,
  turnNumber: number,
): Resolution {
  if (remaining.length > 0) {
    const updatedAuction: AuctionState = { ...auction, sealedBids, pendingBidders: remaining };
    const working: ModernArtState = {
      ...state,
      currentAuction: updatedAuction,
      lastAction: log("seal", playerID, `P${Number.parseInt(playerID, 10) + 1} passed (timeout)`, turnNumber),
    };
    return { state: working, finish: null };
  }
  // All sealed bids in: reveal. Highest wins (ties → first in seat order).
  let winner: ModernArtPlayerID | null = null;
  let best = -1;
  for (const id of biddingRing(state.seatOrder, auction.auctioneer)) {
    const b = sealedBids[id] ?? null;
    if (b !== null && b > best) {
      best = b;
      winner = id;
    }
  }
  const highBid = winner === null ? 0 : best;
  const updatedAuction: AuctionState = {
    ...auction,
    sealedBids,
    highBid,
    highBidder: winner,
    pendingBidders: [],
  };
  const action = log(
    "seal",
    playerID,
    winner === null ? "sealed: all passed" : `sealed: P${Number.parseInt(winner, 10) + 1} wins $${highBid}`,
    turnNumber,
  );
  const working: ModernArtState = { ...state, currentAuction: updatedAuction, lastAction: action };
  return resolveAuction(working, action);
}

/**
 * Pure variant of `resolveOutcome` that returns a `Resolution`.
 */
function resolveOutcomeState(
  state: ModernArtState,
  auction: AuctionState,
  turnNumber: number,
): Resolution {
  const action =
    auction.highBidder === null
      ? log("noBids", auction.auctioneer, `no bids on ${auction.artist}`, turnNumber)
      : log(
          "won",
          auction.highBidder,
          `P${Number.parseInt(auction.highBidder, 10) + 1} wins ${auction.artist} for $${auction.highBid}`,
          turnNumber,
        );
  const working: ModernArtState = { ...state, currentAuction: auction, lastAction: action };
  return resolveAuction(working, action);
}

function resolveAuction(
  preState: ModernArtState,
  action: ActionLog,
): Resolution {
  const auction = preState.currentAuction!;
  const winner: ModernArtPlayerID | null = auction.highBidder;
  const price = auction.highBid;
  const paintings = auction.paintings;
  const artist = auction.artist;

  let players = { ...preState.players };

  if (winner !== null && price > 0) {
    // Winner pays. If winner === auctioneer, they pay the bank (their money
    // just leaves the game). Otherwise the auctioneer is paid.
    const winnerData = { ...players[winner]! };
    winnerData.money = winnerData.money - price;
    if (winner !== auction.auctioneer) {
      const seller = { ...players[auction.auctioneer]! };
      seller.money = seller.money + price;
      players = withPlayer(players, auction.auctioneer, seller);
    }
    // Transfer the painting(s) to the winner's collection.
    winnerData.collection = { ...winnerData.collection };
    for (const _ of paintings) winnerData.collection[artist] += 1;
    players = withPlayer(players, winner, winnerData);
  } else {
    // No bid: auctioneer keeps it free.
    const seller = { ...players[auction.auctioneer]! };
    seller.collection = { ...seller.collection };
    for (const _ of paintings) seller.collection[artist] += 1;
    players = withPlayer(players, auction.auctioneer, seller);
  }

  const working: ModernArtState = {
    ...preState,
    players,
    currentAuction: null,
    countsSold: {
      ...preState.countsSold,
      [artist]: preState.countsSold[artist] + paintings.length,
    },
    lastAction:
      winner === null
        ? { ...action, detail: `${action.detail}; no bids, auctioneer keeps it` }
        : {
            ...action,
            kind: "won",
            detail: `${action.detail}; won by P${Number.parseInt(winner, 10) + 1} for $${price}`,
          },
  };

  return finishPipeline(working);
}

/**
 * After an auction resolves, check round-end. If no artist has hit the
 * threshold, the round continues (next auctioneer = round-robin next seat). If
 * the threshold is hit, score the round; if it was the last round, finish.
 */
function finishPipeline(state: ModernArtState): Resolution {
  let working = state;

  const hitThreshold = (Object.values(working.countsSold) as number[]).some(
    (n) => n >= ROUND_END_THRESHOLD,
  );

  // A round also ends if no one can auction any more paintings (all hands +
  // deck exhausted) — even if no artist hit the 5-up threshold.
  const anyCardsLeft = working.seatOrder.some((id) => working.players[id]!.hand.length > 0);

  if (!hitThreshold && anyCardsLeft) {
    return { state: working, finish: null };
  }
  if (!hitThreshold && !anyCardsLeft) {
    // Round ends early due to card exhaustion; score with whatever sold.
    // Falls through to the scoring pipeline below.
  }

  // Round over: compute cumulative values, pay out, clear collections + counts.
  const cumulativeValue = computeCumulativeValues(working.cumulativeValue, working.countsSold);
  const payouts = scoreRound(working.players, cumulativeValue);

  const players = {} as ModernArtState["players"];
  for (const id of working.seatOrder) {
    const p = working.players[id]!;
    players[id] = {
      ...p,
      money: p.money + (payouts[id] ?? 0),
      collection: emptyArtistCounts(),
    };
  }

  const ranked = rankArtists(working.countsSold);
  const detail =
    ranked
      .filter((r) => r.rank <= PAYOUT_TOP_3.length && r.sold > 0)
      .map((r) => `${r.artist} +$${PAYOUT_TOP_3[r.rank - 1]}`)
      .join(", ") || "no payouts";

  const payoutRow: PayoutRow = { round: working.round, values: { ...cumulativeValue } };

  working = {
    ...working,
    players,
    cumulativeValue,
    countsSold: emptyArtistCounts(),
    payoutHistory: [...working.payoutHistory, payoutRow],
    lastAction: log("roundScored", working.seatOrder[0]!, `Round ${working.round} scored: ${detail}`, 0),
  };

  if (working.round >= TOTAL_ROUNDS) {
    // Game over — pick the wealthiest.
    let best = working.seatOrder[0]!;
    let bestMoney = working.players[best]!.money;
    for (const id of working.seatOrder.slice(1)) {
      const m = working.players[id]!.money;
      if (m > bestMoney) {
        best = id;
        bestMoney = m;
      }
    }
    return { state: working, finish: { winner: best } };
  }

  // Advance to next round.
  working = { ...working, round: working.round + 1 };
  return { state: working, finish: null };
}

// ---------------------------------------------------------------------------
// Legal-action enumeration (for bots + onTimeout)
// ---------------------------------------------------------------------------

export interface ModernArtLegalAction {
  event: string;
  payload: unknown;
  label: string;
}

export function enumerateModernArtLegalActions(
  G: ModernArtState,
  playerID: ModernArtPlayerID,
  turnIndex: number,
): ModernArtLegalAction[] {
  const me = G.players[playerID];
  if (me === undefined) return [];

  // No active auction: the auctioneer must start one (if it's their turn).
  if (G.currentAuction === null) {
    const auctioneer = currentAuctioneer(G, turnIndex);
    if (auctioneer !== playerID) return [];
    if (me.hand.length === 0) {
      // Empty-handed auctioneer: skip the turn.
      return [{ event: "skipTurn", payload: {}, label: "no cards — skip" }];
    }
    const out: ModernArtLegalAction[] = [];
    for (const pid of me.hand) {
      const painting = getPainting(pid);
      out.push({
        event: "startAuction",
        payload: { paintingId: pid },
        label: `auction ${painting.artist} (${painting.auction})`,
      });
      if (painting.auction === "double") {
        // Possible pairings: same-artist, non-double cards in hand.
        for (const pair of me.hand) {
          if (pair === pid) continue;
          const p2 = getPainting(pair);
          if (p2.artist !== painting.artist) continue;
          if (p2.auction === "double") continue; // can't pair two doubles
          out.push({
            event: "startAuction",
            payload: { paintingId: pid, doublePaintingId: pair },
            label: `double ${painting.artist} + ${p2.auction}`,
          });
        }
      }
    }
    return out;
  }

  const auction = G.currentAuction;
  // Only the head of pendingBidders may act.
  if (auction.pendingBidders[0] !== playerID) return [];

  if (auction.type === "sealed") {
    if (auction.sealedBids[playerID] !== null) return [];
    const budget = me.money;
    const steps = [0, 5, 10, 15, 20, 25, 30, 40, 50, 60, 80, budget];
    const seen = new Set<number>();
    const out: ModernArtLegalAction[] = [];
    for (const amt of steps) {
      const v = Math.max(0, Math.min(budget, amt));
      if (seen.has(v)) continue;
      seen.add(v);
      if (v === 0) {
        out.push({ event: "passBid", payload: {}, label: "seal pass" });
      } else {
        out.push({ event: "sealBid", payload: { amount: v }, label: `seal $${v}` });
      }
    }
    out.push({ event: "passBid", payload: {}, label: "seal pass" });
    return out;
  }

  if (auction.type === "fixed") {
    // Auctioneer must set the price first (only legal action until they do).
    if (auction.fixedPrice === null) {
      if (playerID !== auction.auctioneer) return [];
      const steps = [0, 10, 20, 30, 40, 50, 60, 80, me.money];
      const seen = new Set<number>();
      const out: ModernArtLegalAction[] = [];
      for (const amt of steps) {
        const v = Math.max(0, Math.min(me.money, amt));
        if (seen.has(v)) continue;
        seen.add(v);
        out.push({ event: "setFixedPrice", payload: { price: v }, label: `set $${v}` });
      }
      return out;
    }
    // Price is set: non-auctioneers decide buy/decline.
    if (playerID === auction.auctioneer) return [];
    const price = auction.fixedPrice ?? 0;
    const out: ModernArtLegalAction[] = [];
    if (me.money >= price && price > 0) {
      out.push({ event: "buyFixed", payload: {}, label: `buy $${price}` });
    }
    out.push({ event: "declineFixed", payload: {}, label: "decline" });
    return out;
  }

  // open or once-around: either raise or pass.
  const out: ModernArtLegalAction[] = [];
  const minRaise = auction.highBid + 1;
  const canAfford = me.money;
  if (canAfford >= minRaise) {
    const raiseSteps = [minRaise, auction.highBid + 2, auction.highBid + 5, auction.highBid + 10, canAfford];
    const seen = new Set<number>();
    for (const amt of raiseSteps) {
      const v = Math.min(canAfford, amt);
      if (v < minRaise || seen.has(v)) continue;
      seen.add(v);
      out.push({ event: "placeBid", payload: { amount: v }, label: `bid $${v}` });
    }
  }
  out.push({ event: "passBid", payload: {}, label: "pass" });
  return out;
}

// ---------------------------------------------------------------------------
// Game definition
// ---------------------------------------------------------------------------

export const modernArt = defineGame({
  maxPlayers: 5,
  minPlayers: 3,
  initialPhase: "play",
  turn: turn.roundRobin(),

  setup: ({ match, seed }): ModernArtState => {
    const seated = match.players as readonly ModernArtPlayerID[];
    const rng = createRng(seed);
    return buildInitialState(seated, rng);
  },

  phases: {
    play: {
      activePlayers: ({ G, turn: t }) => {
        const state = G as ModernArtState;
        const ap = activePlayerFor(state, t.index);
        return [ap];
      },
      label: ({ G, turn: t }) => {
        const state = G as ModernArtState;
        const ap = activePlayerFor(state, t.index);
        return state.currentAuction === null
          ? `Round ${state.round} — P${Number.parseInt(ap, 10) + 1} to auction`
          : `Auction in progress — P${Number.parseInt(ap, 10) + 1} to act`;
      },
      deadline: (ctx) => deadline.after(ctx, 60_000),
      onTimeout: (ctx, moves) => {
        const G = ctx.G as ModernArtState;
        // The framework binds the timeout-dispatched move to ctx.player.id,
        // which is the round-robin auctioneer (turn.roundRobin()). When an
        // auction is in flight, the seat that actually needs to act is
        // pendingBidders[0] — frequently a *different* seat — so dispatching
        // any move as the auctioneer is guaranteed to hit the
        // `not_your_bid`/`not_your_turn_to_pass` guard and return
        // `invalid_event`, stalling the game (see the warn emitted by core's
        // fireTimeout). In that case we don't go through a player-bound move at
        // all; we auto-pass the stalled bidder directly via a raw MoveOutcome.
        if (G.currentAuction !== null) {
          const resolved = autoPassHeadBidder(G, ctx.turn.turn);
          if (resolved.finish !== null) return { kind: "finish", patch: resolved.state, result: resolved.finish };
          // The auction may still be in flight (other bidders can still raise)
          // or resolved (currentAuction === null). Only advance the turn when
          // the auction actually closed; staying keeps the same auctioneer's
          // turn so the next pending bidder gets the clock.
          return resolved.state.currentAuction === null
            ? { kind: "endTurn", patch: resolved.state }
            : { kind: "stay", patch: resolved.state };
        }

        // No auction: the active seat IS the auctioneer, which matches
        // ctx.player.id. Safe to enumerate + dispatch a real move for them.
        const auctioneer = ctx.player.id as ModernArtPlayerID;
        const legal = enumerateModernArtLegalActions(G, auctioneer, ctx.turn.index);
        if (legal.length === 0) return null;
        const pick = ctx.rng.pick(legal);
        // Inline `phases:` shape can't propagate `TMoves` through to onTimeout
        // — same as splendor; stick with the cast.
        const dispatch = moves as unknown as Record<
          string,
          (args: unknown) => ReturnType<typeof moves[keyof typeof moves]>
        >;
        return dispatch[pick.event]!(pick.payload);
      },
    },
  },

  moves: ({ move }) => ({
    startAuction: move<StartAuctionArgs>({
      phases: ["play"],
      run({ G, args, move: m, player, turn: t }) {
        const state = G as ModernArtState;
        const auctioneer = currentAuctioneer(state, t.index);
        if (player.id !== auctioneer) return m.invalid("not_auctioneer");
        if (state.currentAuction !== null) return m.invalid("auction_in_progress");

        const me = state.players[player.id as ModernArtPlayerID];
        const paintingId = args.paintingId;
        if (!me.hand.includes(paintingId)) return m.invalid("card_not_in_hand", { paintingId });
        const painting = getPainting(paintingId);

        let secondId: PaintingID | null = null;
        let pairedCount = 1;
        const actionKind: ActionLogKind = painting.auction === "double" ? "startDouble" : "startAuction";

        if (painting.auction === "double") {
          const providedSecond = args.doublePaintingId;
          if (providedSecond !== undefined && providedSecond !== paintingId) {
            if (!me.hand.includes(providedSecond)) {
              return m.invalid("second_card_not_in_hand", { paintingId: providedSecond });
            }
            const second = getPainting(providedSecond);
            if (second.artist !== painting.artist) return m.invalid("double_must_match_artist");
            if (second.auction === "double") return m.invalid("double_cannot_pair_with_double");
            secondId = providedSecond;
            pairedCount = 2;
          }
        }

        const resolved = resolveDouble(
          painting.auction,
          secondId === null ? null : getPainting(secondId).auction,
        );

        // Remove the played card(s) from hand.
        let nextHand = removeFromHand(me.hand, paintingId);
        if (secondId !== null) nextHand = removeFromHand(nextHand, secondId);
        const nextMe: PlayerData = { ...me, hand: nextHand };

        let working: ModernArtState = {
          ...state,
          players: withPlayer(state.players, player.id as ModernArtPlayerID, nextMe),
        };

        // Round-end check: putting up the painting(s) may end the round BEFORE
        // the auction is paid. The 5th-up painting is not auctioned off; if
        // this card triggers the end, we discard the auction and score.
        const projectedCounts = { ...state.countsSold };
        projectedCounts[painting.artist] += pairedCount;
        if ((Object.values(projectedCounts) as number[]).some((n) => n >= ROUND_END_THRESHOLD)) {
          working = {
            ...working,
            lastAction: log(
              actionKind,
              player.id as ModernArtPlayerID,
              `P${Number.parseInt(player.id, 10) + 1} put up ${painting.artist}; round ends`,
              t.turn,
            ),
          };
          const resolution = finishPipeline(working);
          if (resolution.finish !== null) return m.finish(resolution.finish, resolution.state);
          return m.endTurn(resolution.state);
        }

        // Build the auction.
        const paintings = secondId === null ? [paintingId] : [paintingId, secondId];
        const ring = biddingRing(state.seatOrder, player.id as ModernArtPlayerID);

        const auction: AuctionState = {
          artist: painting.artist,
          type: resolved.effective,
          auctioneer: player.id as ModernArtPlayerID,
          paintings,
          highBid: 0,
          highBidder: null,
          fixedPrice: null,
          sealedBids:
            resolved.effective === "sealed"
              ? (Object.fromEntries(ring.map((id) => [id, null])) as Record<ModernArtPlayerID, number | null>)
              : ({} as Record<ModernArtPlayerID, number | null>),
          pendingBidders: ring,
          passed: [],
        };

        const detail =
          resolved.effective === "open" && painting.auction === "double" && secondId === null
            ? `P${Number.parseInt(player.id, 10) + 1} double → open ${painting.artist}`
            : pairedCount === 2
              ? `P${Number.parseInt(player.id, 10) + 1} double ${painting.artist} (${resolved.effective})`
              : `P${Number.parseInt(player.id, 10) + 1} ${resolved.effective} ${painting.artist}`;

        working = {
          ...working,
          currentAuction: auction,
          lastAction: log(actionKind, player.id as ModernArtPlayerID, detail, t.turn),
        };

        // Fixed-price auction: the auctioneer must set the price next.
        // (activePlayers will return them because pendingBidders is the full
        // ring but fixedPrice is null — handled by setFixedPrice being the only
        // legal action; if we want strictness, the auctioneer stays pending[0]
        // until price is set. For simplicity, treat the auctioneer as next.)
        if (resolved.effective === "fixed") {
          // Auctioneer sets the price: keep them as pending bidder.
          const fixedAuction: AuctionState = { ...auction, pendingBidders: [player.id as ModernArtPlayerID] };
          working = { ...working, currentAuction: fixedAuction };
        }
        return m.stay(working);
      },
    }),

    placeBid: move<PlaceBidArgs>({
      phases: ["play"],
      run({ G, args, move: m, player, turn: t }) {
        const state = G as ModernArtState;
        const auction = state.currentAuction;
        if (auction === null) return m.invalid("no_active_auction");
        if (auction.type !== "open" && auction.type !== "once") {
          return m.invalid("wrong_auction_type");
        }
        if (auction.pendingBidders[0] !== (player.id as ModernArtPlayerID)) {
          return m.invalid("not_your_bid");
        }
        const amount = args.amount;
        const me = state.players[player.id as ModernArtPlayerID];
        if (!isValidRaise(amount, auction.highBid, me.money)) {
          return m.invalid("invalid_bid", { amount, highBid: auction.highBid, money: me.money });
        }

        const passed = [...auction.passed];
        let pendingBidders: ModernArtPlayerID[];

        if (auction.type === "once") {
          // Once-around: every non-passed seat gets exactly one bid; the
          // auctioneer is the last in the ring. After the last seat bids (or
          // passes), resolve.
          pendingBidders = auction.pendingBidders.slice(1);
          const updatedAuction: AuctionState = {
            ...auction,
            highBid: amount,
            highBidder: player.id as ModernArtPlayerID,
            pendingBidders,
            passed,
          };
          if (pendingBidders.length === 0) {
            return resolveOutcome(m, state, updatedAuction, t.turn);
          }
          const working: ModernArtState = {
            ...state,
            currentAuction: updatedAuction,
            lastAction: log("bid", player.id as ModernArtPlayerID, `P${Number.parseInt(player.id, 10) + 1} bid $${amount}`, t.turn),
          };
          return m.stay(working);
        }

        // Open auction: anyone who hasn't permanently passed may re-enter.
        // The bidder just acted; they're now "safe" — re-add the ring of
        // non-passed opponents so they get another chance to raise.
        const ring = biddingRing(state.seatOrder, auction.auctioneer).filter(
          (id) => id !== (player.id as ModernArtPlayerID) && !passed.includes(id),
        );
        pendingBidders = ring;
        const updatedAuction: AuctionState = {
          ...auction,
          highBid: amount,
          highBidder: player.id as ModernArtPlayerID,
          pendingBidders,
          passed,
        };
        if (pendingBidders.length === 0) {
          return resolveOutcome(m, state, updatedAuction, t.turn);
        }
        const working: ModernArtState = {
          ...state,
          currentAuction: updatedAuction,
          lastAction: log("bid", player.id as ModernArtPlayerID, `P${Number.parseInt(player.id, 10) + 1} bid $${amount}`, t.turn),
        };
        return m.stay(working);
      },
    }),

    passBid: move<unknown | undefined>({
      phases: ["play"],
      run({ G, move: m, player, turn: t }) {
        const state = G as ModernArtState;
        const auction = state.currentAuction;
        if (auction === null) return m.invalid("no_active_auction");
        if (auction.pendingBidders[0] !== (player.id as ModernArtPlayerID)) {
          return m.invalid("not_your_turn_to_pass");
        }

        if (auction.type === "sealed") {
          const sealedBids: Record<ModernArtPlayerID, number | null> = {
            ...auction.sealedBids,
            [player.id as ModernArtPlayerID]: null,
          };
          const remaining = auction.pendingBidders.slice(1);
          return continueSealed(m, state, auction, sealedBids, remaining, player.id as ModernArtPlayerID, t.turn);
        }

        if (auction.type === "fixed") {
          return runDecline(m, state, auction, player.id as ModernArtPlayerID, t.turn);
        }

        const passed = [...auction.passed, player.id as ModernArtPlayerID];

        if (auction.type === "once") {
          const pendingBidders = auction.pendingBidders.slice(1);
          const updatedAuction: AuctionState = { ...auction, pendingBidders, passed };
          if (pendingBidders.length === 0) {
            return resolveOutcome(m, state, updatedAuction, t.turn);
          }
          const working: ModernArtState = {
            ...state,
            currentAuction: updatedAuction,
            lastAction: log("pass", player.id as ModernArtPlayerID, `P${Number.parseInt(player.id, 10) + 1} passed`, t.turn),
          };
          return m.stay(working);
        }

        // Open: resolve when no one but the high bidder (or no one) can still raise.
        const ring = biddingRing(state.seatOrder, auction.auctioneer).filter(
          (id) => !passed.includes(id),
        );
        const canStillRaise = ring.filter((id) => id !== auction.highBidder);
        if (canStillRaise.length === 0) {
          const updatedAuction: AuctionState = { ...auction, pendingBidders: [], passed };
          return resolveOutcome(m, state, updatedAuction, t.turn);
        }
        const updatedAuction: AuctionState = { ...auction, pendingBidders: canStillRaise, passed };
        const working: ModernArtState = {
          ...state,
          currentAuction: updatedAuction,
          lastAction: log("pass", player.id as ModernArtPlayerID, `P${Number.parseInt(player.id, 10) + 1} passed`, t.turn),
        };
        return m.stay(working);
      },
    }),

    sealBid: move<SealBidArgs>({
      phases: ["play"],
      run({ G, args, move: m, player, turn: t }) {
        const state = G as ModernArtState;
        const auction = state.currentAuction;
        if (auction === null) return m.invalid("no_active_auction");
        if (auction.type !== "sealed") return m.invalid("not_sealed_auction");
        if (auction.pendingBidders[0] !== (player.id as ModernArtPlayerID)) {
          return m.invalid("not_your_sealed_bid");
        }
        const amount = args.amount;
        const me = state.players[player.id as ModernArtPlayerID];
        if (!Number.isInteger(amount) || amount < 0 || amount > me.money) {
          return m.invalid("invalid_sealed_bid", { amount, money: me.money });
        }
        const sealedBids: Record<ModernArtPlayerID, number | null> = {
          ...auction.sealedBids,
          [player.id as ModernArtPlayerID]: amount,
        };
        const remaining = auction.pendingBidders.slice(1);
        return continueSealed(m, state, auction, sealedBids, remaining, player.id as ModernArtPlayerID, t.turn);
      },
    }),

    setFixedPrice: move<SetFixedPriceArgs>({
      phases: ["play"],
      run({ G, args, move: m, player, turn: t }) {
        const state = G as ModernArtState;
        const auction = state.currentAuction;
        if (auction === null) return m.invalid("no_active_auction");
        if (auction.type !== "fixed") return m.invalid("not_fixed_auction");
        if (auction.fixedPrice !== null) return m.invalid("price_already_set");
        if (player.id !== auction.auctioneer) return m.invalid("only_auctioneer_sets_price");
        const price = args.price;
        if (!Number.isInteger(price) || price < 0) {
          return m.invalid("invalid_price", { price });
        }
        // Build the buyer ring: everyone except the auctioneer (the seller).
        // The auctioneer only buys as a fallback when nobody else will.
        const ring = biddingRing(state.seatOrder, auction.auctioneer).filter(
          (id) => id !== auction.auctioneer,
        );
        const updatedAuction: AuctionState = {
          ...auction,
          fixedPrice: price,
          pendingBidders: ring,
        };
        const working: ModernArtState = {
          ...state,
          currentAuction: updatedAuction,
          lastAction: log(
            "startAuction",
            player.id as ModernArtPlayerID,
            `P${Number.parseInt(player.id, 10) + 1} fixed ${auction.artist} @ $${price}`,
            t.turn,
          ),
        };
        return m.stay(working);
      },
    }),

    buyFixed: move<unknown | undefined>({
      phases: ["play"],
      run({ G, move: m, player, turn: t }) {
        const state = G as ModernArtState;
        const auction = state.currentAuction;
        if (auction === null) return m.invalid("no_active_auction");
        if (auction.type !== "fixed") return m.invalid("not_fixed_auction");
        if (auction.pendingBidders[0] !== (player.id as ModernArtPlayerID)) {
          return m.invalid("not_your_fixed_turn");
        }
        const price = auction.fixedPrice ?? 0;
        const me = state.players[player.id as ModernArtPlayerID];
        if (me.money < price) return m.invalid("cannot_afford_fixed", { price, money: me.money });

        // First buyer wins immediately at the fixed price.
        const updatedAuction: AuctionState = {
          ...auction,
          highBid: price,
          highBidder: player.id as ModernArtPlayerID,
          pendingBidders: [],
        };
        const action = log(
          "buyFixed",
          player.id as ModernArtPlayerID,
          `P${Number.parseInt(player.id, 10) + 1} buys ${auction.artist} @ $${price}`,
          t.turn,
        );
        const working: ModernArtState = { ...state, currentAuction: updatedAuction, lastAction: action };
        const resolution = resolveAuction(working, action);
        if (resolution.finish !== null) return m.finish(resolution.finish, resolution.state);
        return m.endTurn(resolution.state);
      },
    }),

    declineFixed: move<unknown | undefined>({
      phases: ["play"],
      run({ G, move: m, player, turn: t }) {
        const state = G as ModernArtState;
        const auction = state.currentAuction;
        if (auction === null) return m.invalid("no_active_auction");
        if (auction.type !== "fixed") return m.invalid("not_fixed_auction");
        if (auction.pendingBidders[0] !== (player.id as ModernArtPlayerID)) {
          return m.invalid("not_your_fixed_turn");
        }
        return runDecline(m, state, auction, player.id as ModernArtPlayerID, t.turn);
      },
    }),

    skipTurn: move<unknown | undefined>({
      phases: ["play"],
      run({ G, move: m, player, turn: t }) {
        const state = G as ModernArtState;
        if (state.currentAuction !== null) return m.invalid("auction_in_progress");
        const auctioneer = currentAuctioneer(state, t.index);
        if (player.id !== auctioneer) return m.invalid("not_auctioneer");
        const me = state.players[player.id as ModernArtPlayerID];
        if (me.hand.length > 0) return m.invalid("must_start_auction");
        // Auctioneer has no cards: end the round if no one can auction, else
        // simply pass the turn to the next auctioneer.
        const anyCardsLeft = state.seatOrder.some(
          (id) => state.players[id]!.hand.length > 0,
        );
        const working: ModernArtState = {
          ...state,
          lastAction: log(
            "pass",
            player.id as ModernArtPlayerID,
            `P${Number.parseInt(player.id, 10) + 1} has no cards; skipped`,
            t.turn,
          ),
        };
        if (!anyCardsLeft) {
          const resolution = finishPipeline(working);
          if (resolution.finish !== null) return m.finish(resolution.finish, resolution.state);
          return m.endTurn(resolution.state);
        }
        return m.endTurn(working);
      },
    }),
  }),

  views: {
    player: ({ G, turn: t, phase }, player): ModernArtPlayerView => {
      const state = G as ModernArtState;
      const isFinished = (phase as string) === "__gamekit_finished";
      const currentTurn = activePlayerFor(state, t.index);
      return computePlayerView(state, currentTurn, isFinished, player.id as ModernArtPlayerID);
    },
    public: ({ G, turn: t, phase }): ModernArtPublicView => {
      const state = G as ModernArtState;
      const isFinished = (phase as string) === "__gamekit_finished";
      const currentTurn = activePlayerFor(state, t.index);
      return computePublicView(state, currentTurn, isFinished);
    },
  },
});

export type ModernArtGame = typeof modernArt;

// ---------------------------------------------------------------------------
// Move-local resolution helpers. They take the move-helpers object (`m`) so
// they can return stay/endTurn/finish outcomes. Typed against gamekit's
// MoveHelpers so we avoid self-referencing the `modernArt` const.
// ---------------------------------------------------------------------------

type MoveHelper = MoveHelpers<ModernArtState, "play", ModernArtPlayerID>;

function resolveOutcome(
  m: MoveHelper,
  state: ModernArtState,
  auction: AuctionState,
  turnNumber: number,
) {
  const action =
    auction.highBidder === null
      ? log("noBids", auction.auctioneer, `no bids on ${auction.artist}`, turnNumber)
      : log(
          "won",
          auction.highBidder,
          `P${Number.parseInt(auction.highBidder, 10) + 1} wins ${auction.artist} for $${auction.highBid}`,
          turnNumber,
        );
  const working: ModernArtState = { ...state, currentAuction: auction, lastAction: action };
  const resolution = resolveAuction(working, action);
  if (resolution.finish !== null) return m.finish(resolution.finish, resolution.state);
  return m.endTurn(resolution.state);
}

function runDecline(
  m: MoveHelper,
  state: ModernArtState,
  auction: AuctionState,
  playerID: ModernArtPlayerID,
  turnNumber: number,
) {
  const remaining = auction.pendingBidders.slice(1);
  if (remaining.length > 0) {
    const updatedAuction: AuctionState = { ...auction, pendingBidders: remaining };
    const working: ModernArtState = {
      ...state,
      currentAuction: updatedAuction,
      lastAction: log("declineFixed", playerID, `P${Number.parseInt(playerID, 10) + 1} declined`, turnNumber),
    };
    return m.stay(working);
  }
  // Nobody bought at the fixed price → auctioneer buys it at the fixed price
  // (or keeps it free if they can't afford their own price).
  const price = auction.fixedPrice ?? 0;
  const seller = state.players[auction.auctioneer]!;
  if (seller.money < price) {
    const action = log(
      "noBids",
      auction.auctioneer,
      `nobody bought ${auction.artist}; auctioneer keeps free`,
      turnNumber,
    );
    const working: ModernArtState = {
      ...state,
      currentAuction: { ...auction, highBid: 0, highBidder: null, pendingBidders: [] },
      lastAction: action,
    };
    const resolution = resolveAuction(working, action);
    if (resolution.finish !== null) return m.finish(resolution.finish, resolution.state);
    return m.endTurn(resolution.state);
  }
  const action = log(
    "buyFixed",
    auction.auctioneer,
    `nobody bought; auctioneer pays $${price}`,
    turnNumber,
  );
  const working: ModernArtState = {
    ...state,
    currentAuction: { ...auction, highBid: price, highBidder: auction.auctioneer, pendingBidders: [] },
    lastAction: action,
  };
  const resolution = resolveAuction(working, action);
  if (resolution.finish !== null) return m.finish(resolution.finish, resolution.state);
  return m.endTurn(resolution.state);
}

function continueSealed(
  m: MoveHelper,
  state: ModernArtState,
  auction: AuctionState,
  sealedBids: Record<ModernArtPlayerID, number | null>,
  remaining: ModernArtPlayerID[],
  playerID: ModernArtPlayerID,
  turnNumber: number,
) {
  if (remaining.length > 0) {
    const updatedAuction: AuctionState = { ...auction, sealedBids, pendingBidders: remaining };
    const working: ModernArtState = {
      ...state,
      currentAuction: updatedAuction,
      lastAction: log("seal", playerID, `P${Number.parseInt(playerID, 10) + 1} sealed a bid`, turnNumber),
    };
    return m.stay(working);
  }
  // All sealed bids in: reveal. Highest wins (ties → first in seat order).
  let winner: ModernArtPlayerID | null = null;
  let best = -1;
  for (const id of biddingRing(state.seatOrder, auction.auctioneer)) {
    const b = sealedBids[id] ?? null;
    if (b !== null && b > best) {
      best = b;
      winner = id;
    }
  }
  const highBid = winner === null ? 0 : best;
  const updatedAuction: AuctionState = {
    ...auction,
    sealedBids,
    highBid,
    highBidder: winner,
    pendingBidders: [],
  };
  const action = log(
    "seal",
    playerID,
    winner === null ? "sealed: all passed" : `sealed: P${Number.parseInt(winner, 10) + 1} wins $${highBid}`,
    turnNumber,
  );
  const working: ModernArtState = { ...state, currentAuction: updatedAuction, lastAction: action };
  const resolution = resolveAuction(working, action);
  if (resolution.finish !== null) return m.finish(resolution.finish, resolution.state);
  return m.endTurn(resolution.state);
}

// Keep unused type imports referenced for the type system.
void (null as unknown as DeepReadonly<ModernArtState>);
void (null as unknown as Artist);
void (null as unknown as AuctionType);
