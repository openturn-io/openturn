import { createRng } from "@openturn/core";
import { defineGame, turn } from "@openturn/gamekit";

import { getCard } from "./data";
import {
  applyBonus,
  canAfford,
  describeCard,
  describeNoble,
  eligibleNobles,
  payment,
  returnChipsToBank,
  spendChips,
  takeChips,
  takeChipsFromBank,
  totalChips,
} from "./rules";
import { buildInitialState } from "./setup";
import {
  CHIP_CAP,
  CHIP_COLORS,
  GEM_COLORS,
  MARKET_SLOTS,
  MAX_PLAYERS,
  MIN_PLAYERS,
  RESERVE_LIMIT,
  TAKE_TWO_MIN_PILE,
  WIN_PRESTIGE,
  type ActionLog,
  type ChipColor,
  type GemColor,
  type MarketState,
  type PlayerData,
  type SplendorPlayerID,
  type SplendorPlayerView,
  type SplendorState,
  type Tier,
} from "./state";
import { computePlayerView, computePublicView } from "./views";

export * from "./state";
export {
  ALL_CARDS,
  CARD_BY_ID,
  NOBLE_BY_ID,
  NOBLES,
  TIER_1_CARDS,
  TIER_2_CARDS,
  TIER_3_CARDS,
  getCard,
  getNoble,
} from "./data";
export {
  canAfford,
  describeCard,
  describeNoble,
  eligibleNobles,
  totalBonuses,
  totalChips,
} from "./rules";

// ---------------------------------------------------------------------------
// Move payloads
// ---------------------------------------------------------------------------

export interface TakeThreeArgs {
  colors: readonly GemColor[];
}

export interface TakeTwoArgs {
  color: GemColor;
}

export interface ReserveCardArgs {
  source: "market" | "deck";
  tier: Tier;
  /** Required when source === "market". 0..MARKET_SLOTS-1. */
  slot?: number;
}

export interface BuyCardArgs {
  source: "market" | "reserved";
  /** Required when source === "market". */
  tier?: Tier;
  /** Required when source === "market". 0..MARKET_SLOTS-1. */
  slot?: number;
  /** Required when source === "reserved". */
  cardID?: string;
}

export interface DiscardChipsArgs {
  /** Chips to return to the bank, by color. Sum must equal player's overflow. */
  chips: Partial<Record<ChipColor, number>>;
}

// ---------------------------------------------------------------------------
// Helpers internal to moves
// ---------------------------------------------------------------------------

function recordAction(
  log: ActionLog["kind"],
  player: SplendorPlayerID,
  detail: string,
  turnNumber: number,
): ActionLog {
  return { kind: log, player: player, detail, turn: turnNumber };
}

function chipsAreDistinct(colors: readonly GemColor[]): boolean {
  const seen = new Set<string>();
  for (const c of colors) {
    if (seen.has(c)) return false;
    seen.add(c);
  }
  return true;
}

function refillMarketSlot(G: SplendorState, tier: Tier, slot: number): SplendorState {
  const rowKey = `tier${tier}` as const;
  const deckKey = rowKey;
  const deck = [...G.decks[deckKey]];
  const next = deck.shift() ?? null;
  const row = [...G.market[rowKey]];
  row[slot] = next;
  return {
    ...G,
    decks: { ...G.decks, [deckKey]: deck },
    market: { ...G.market, [rowKey]: row },
  };
}

function updatePlayer(
  players: SplendorState["players"],
  id: SplendorPlayerID,
  next: PlayerData,
): SplendorState["players"] {
  return { ...players, [id]: next };
}

interface PostMoveOutcome {
  state: SplendorState;
  finish: { winner: SplendorPlayerID } | null;
}

/**
 * Common post-move pipeline: noble auto-claim, score check, end-game trigger.
 * Takes the post-move state and returns the final post-pipeline state plus an
 * optional finish marker. The caller passes the full state as the move patch.
 */
function runEndOfTurnPipeline(
  postMoveState: SplendorState,
  player: SplendorPlayerID,
  baseAction: ActionLog,
): PostMoveOutcome {
  let working: SplendorState = postMoveState;

  // Noble auto-claim — phase 1 simplification: if multiple eligible, auto-pick
  // the lowest-ID noble (deterministic). Multi-noble pick is a follow-up PR.
  const me = working.players[player];
  const eligible = eligibleNobles(me, working.nobles);
  let action: ActionLog = baseAction;
  if (eligible.length > 0) {
    const claimed = [...eligible].sort()[0]!;
    const nextNobles = working.nobles.filter((id) => id !== claimed);
    const nextMe: PlayerData = {
      ...me,
      nobles: [...me.nobles, claimed],
      score: me.score + 3,
    };
    working = {
      ...working,
      nobles: nextNobles,
      players: updatePlayer(working.players, player, nextMe),
    };
    action = {
      ...baseAction,
      detail: `${baseAction.detail}; visited by ${describeNoble(claimed)}`,
    };
  }

  // Final-round trigger.
  const updatedMe = working.players[player];
  if (working.lastRoundTrigger === null && updatedMe.score >= WIN_PRESTIGE) {
    working = { ...working, lastRoundTrigger: player };
  }

  // Stamp the final action log.
  working = { ...working, lastAction: action };

  // End-game check: a Splendor "round" is one turn for each seat starting at
  // seat 0, so the round completes after the last seat in seatOrder plays.
  // If the final-round trigger is set and this turn ended the round, finish.
  if (working.lastRoundTrigger !== null) {
    const seats = working.seatOrder;
    const myIdx = seats.indexOf(player);
    const isLastSeat = myIdx === seats.length - 1;
    if (isLastSeat) {
      let winner = seats[0]!;
      for (const id of seats.slice(1)) {
        const here = working.players[id];
        const there = working.players[winner];
        if (here.score > there.score) {
          winner = id;
          continue;
        }
        if (here.score === there.score) {
          let hereCards = 0;
          let thereCards = 0;
          for (const c of GEM_COLORS) {
            hereCards += here.bonuses[c];
            thereCards += there.bonuses[c];
          }
          if (hereCards < thereCards) winner = id;
        }
      }
      return { state: working, finish: { winner } };
    }
  }

  return { state: working, finish: null };
}

// ---------------------------------------------------------------------------
// Legal-action enumeration (consumed by the bot framework via the
// `legalActions` hook on the game definition below)
// ---------------------------------------------------------------------------

export interface SplendorLegalAction {
  event: "takeThreeGems" | "takeTwoGems" | "reserveCard" | "buyCard" | "discardChips";
  payload: TakeThreeArgs | TakeTwoArgs | ReserveCardArgs | BuyCardArgs | DiscardChipsArgs;
  label: string;
}

function chooseDistinctSubsets<T>(items: readonly T[], size: number): T[][] {
  if (size === 0) return [[]];
  if (size > items.length) return [];
  const out: T[][] = [];
  const pick = (start: number, current: T[]) => {
    if (current.length === size) {
      out.push([...current]);
      return;
    }
    for (let i = start; i <= items.length - (size - current.length); i += 1) {
      current.push(items[i]!);
      pick(i + 1, current);
      current.pop();
    }
  };
  pick(0, []);
  return out;
}

/** Greedy "drop from the largest piles first" discard distribution. Deterministic. */
function canonicalDiscard(player: PlayerData, count: number): Partial<Record<ChipColor, number>> {
  const out: Partial<Record<ChipColor, number>> = {};
  let remaining = count;
  // Sort colors by descending pile size, ties broken by CHIP_COLORS order for determinism.
  const ordered = [...CHIP_COLORS].sort((a, b) => player.chips[b] - player.chips[a]);
  for (const color of ordered) {
    if (remaining <= 0) break;
    const available = player.chips[color];
    if (available <= 0) continue;
    const take = Math.min(available, remaining);
    out[color] = take;
    remaining -= take;
  }
  return out;
}

export function enumerateSplendorLegalActions(
  G: SplendorState,
  playerID: SplendorPlayerID,
): SplendorLegalAction[] {
  const me = G.players[playerID];
  if (me === undefined) return [];

  // Discard sub-state takes precedence: only discardChips is legal.
  if (me.mustDiscard > 0) {
    const chips = canonicalDiscard(me, me.mustDiscard);
    const detail = (Object.entries(chips) as [ChipColor, number][])
      .map(([c, n]) => `${n}${c[0]!.toUpperCase()}`)
      .join("·");
    return [{ event: "discardChips", payload: { chips }, label: `discard ${detail}` }];
  }

  const out: SplendorLegalAction[] = [];

  // takeThreeGems: distinct 3/2/1 subsets where each chosen pile has >=1.
  const stockedGems = GEM_COLORS.filter((c) => G.bank[c] > 0);
  for (const size of [3, 2, 1] as const) {
    if (size > stockedGems.length) continue;
    for (const subset of chooseDistinctSubsets(stockedGems, size)) {
      out.push({
        event: "takeThreeGems",
        payload: { colors: subset },
        label: `take ${subset.map((c) => c[0]!.toUpperCase()).join(",")}`,
      });
    }
  }

  // takeTwoGems: any color with bank pile >= TAKE_TWO_MIN_PILE.
  for (const color of GEM_COLORS) {
    if (G.bank[color] >= TAKE_TWO_MIN_PILE) {
      out.push({ event: "takeTwoGems", payload: { color }, label: `take 2x${color}` });
    }
  }

  // reserveCard: market slots and deck tops (only if reserve isn't full).
  if (me.reserved.length < RESERVE_LIMIT) {
    for (const tier of [1, 2, 3] as const) {
      const rowKey = `tier${tier}` as const;
      const row = G.market[rowKey];
      for (let slot = 0; slot < row.length; slot += 1) {
        if (row[slot] !== null) {
          out.push({
            event: "reserveCard",
            payload: { source: "market", tier, slot },
            label: `reserve m${tier}/${slot}`,
          });
        }
      }
      if (G.decks[rowKey].length > 0) {
        out.push({
          event: "reserveCard",
          payload: { source: "deck", tier },
          label: `reserve d${tier}`,
        });
      }
    }
  }

  // buyCard: market slots and reserved cards we can afford.
  for (const tier of [1, 2, 3] as const) {
    const rowKey = `tier${tier}` as const;
    const row = G.market[rowKey];
    for (let slot = 0; slot < row.length; slot += 1) {
      const cardID = row[slot];
      if (cardID === null || cardID === undefined) continue;
      if (canAfford(me, getCard(cardID))) {
        out.push({
          event: "buyCard",
          payload: { source: "market", tier, slot },
          label: `buy m${tier}/${slot}`,
        });
      }
    }
  }
  for (const cardID of me.reserved) {
    if (canAfford(me, getCard(cardID))) {
      out.push({
        event: "buyCard",
        payload: { source: "reserved", cardID },
        label: `buy r/${cardID}`,
      });
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Game definition
// ---------------------------------------------------------------------------

export const splendor = defineGame({
  maxPlayers: MAX_PLAYERS,
  minPlayers: MIN_PLAYERS,
  initialPhase: "play",
  turn: turn.roundRobin(),

  setup: ({ match, seed }): SplendorState => {
    const seatedPlayers = match.players as readonly SplendorPlayerID[];
    const rng = createRng(seed);
    return buildInitialState(seatedPlayers, rng);
  },

  phases: {
    play: {
      label: ({ G, turn: t }) => {
        const seat = G.seatOrder[t.index % G.seatOrder.length];
        return `Player ${seat}'s turn`;
      },
    },
  },

  moves: ({ move }) => ({
    takeThreeGems: move<TakeThreeArgs>({
      phases: ["play"],
      run({ G, args, move: m, player, turn: t }) {
        const me = G.players[player.id];
        if (player.id !== t.currentPlayer) return m.invalid("not_your_turn");
        if (me.mustDiscard > 0) return m.invalid("must_discard_first");
        const colors = args.colors ?? [];
        if (colors.length < 1 || colors.length > 3) return m.invalid("invalid_color_count");
        for (const c of colors) {
          if (!GEM_COLORS.includes(c as GemColor)) return m.invalid("invalid_color", { color: c });
        }
        if (!chipsAreDistinct(colors)) return m.invalid("colors_must_be_distinct");
        for (const c of colors) {
          if (G.bank[c] < 1) return m.invalid("empty_pile", { color: c });
        }
        const taken: Partial<Record<ChipColor, number>> = {};
        for (const c of colors) taken[c] = 1;
        const nextBank = takeChipsFromBank(G.bank, taken);
        const nextMe = takeChips(me, taken);
        const overflow = Math.max(0, totalChips(nextMe) - CHIP_CAP);
        const nextMeWithDiscard: PlayerData = { ...nextMe, mustDiscard: overflow };
        const action = recordAction(
          "takeThree",
          player.id as SplendorPlayerID,
          `took ${colors.join(", ")}`,
          t.turn,
        );
        const working: SplendorState = {
          ...G,
          bank: nextBank,
          players: updatePlayer(G.players, player.id as SplendorPlayerID, nextMeWithDiscard),
        };
        if (overflow > 0) {
          // Stay on turn until discard completes; do not run end-of-turn pipeline.
          return m.stay({ ...working, lastAction: action });
        }
        const post = runEndOfTurnPipeline(working, player.id as SplendorPlayerID, action);
        if (post.finish !== null) return m.finish(post.finish, post.state);
        return m.endTurn(post.state);
      },
    }),

    takeTwoGems: move<TakeTwoArgs>({
      phases: ["play"],
      run({ G, args, move: m, player, turn: t }) {
        const me = G.players[player.id as SplendorPlayerID];
        if (player.id !== t.currentPlayer) return m.invalid("not_your_turn");
        if (me.mustDiscard > 0) return m.invalid("must_discard_first");
        const color = args.color;
        if (!GEM_COLORS.includes(color as GemColor)) return m.invalid("invalid_color", { color });
        if (G.bank[color] < TAKE_TWO_MIN_PILE) {
          return m.invalid("pile_too_low", { color, required: TAKE_TWO_MIN_PILE });
        }
        const taken = { [color]: 2 } as Partial<Record<ChipColor, number>>;
        const nextBank = takeChipsFromBank(G.bank, taken);
        const nextMe = takeChips(me, taken);
        const overflow = Math.max(0, totalChips(nextMe) - CHIP_CAP);
        const nextMeWithDiscard: PlayerData = { ...nextMe, mustDiscard: overflow };
        const action = recordAction(
          "takeTwo",
          player.id as SplendorPlayerID,
          `took 2× ${color}`,
          t.turn,
        );
        const working: SplendorState = {
          ...G,
          bank: nextBank,
          players: updatePlayer(G.players, player.id as SplendorPlayerID, nextMeWithDiscard),
        };
        if (overflow > 0) {
          return m.stay({ ...working, lastAction: action });
        }
        const post = runEndOfTurnPipeline(working, player.id as SplendorPlayerID, action);
        if (post.finish !== null) return m.finish(post.finish, post.state);
        return m.endTurn(post.state);
      },
    }),

    reserveCard: move<ReserveCardArgs>({
      phases: ["play"],
      run({ G, args, move: m, player, turn: t }) {
        const me = G.players[player.id as SplendorPlayerID];
        if (player.id !== t.currentPlayer) return m.invalid("not_your_turn");
        if (me.mustDiscard > 0) return m.invalid("must_discard_first");
        if (me.reserved.length >= RESERVE_LIMIT) return m.invalid("reserve_full");
        if (args.tier !== 1 && args.tier !== 2 && args.tier !== 3) {
          return m.invalid("invalid_tier", { tier: args.tier });
        }
        const tier = args.tier;
        let cardID: string | null = null;
        let working: SplendorState = G;
        if (args.source === "market") {
          if (typeof args.slot !== "number" || args.slot < 0 || args.slot >= MARKET_SLOTS) {
            return m.invalid("invalid_slot");
          }
          const rowKey = `tier${tier}` as const;
          const id = working.market[rowKey][args.slot];
          if (id === null || id === undefined) return m.invalid("empty_market_slot");
          cardID = id;
          working = refillMarketSlot(working, tier, args.slot);
        } else if (args.source === "deck") {
          const deckKey = `tier${tier}` as const;
          const deck = [...working.decks[deckKey]];
          const id = deck.shift();
          if (id === undefined) return m.invalid("empty_deck", { tier });
          cardID = id;
          working = { ...working, decks: { ...working.decks, [deckKey]: deck } };
        } else {
          return m.invalid("invalid_source", { source: args.source });
        }

        // Award gold if available.
        const grantGold = working.bank.gold > 0;
        const nextChips = grantGold
          ? { ...me.chips, gold: me.chips.gold + 1 }
          : { ...me.chips };
        const nextMe: PlayerData = {
          ...me,
          chips: nextChips,
          reserved: [...me.reserved, cardID!],
        };
        const overflow = Math.max(0, totalChips(nextMe) - CHIP_CAP);
        const nextMeWithDiscard: PlayerData = { ...nextMe, mustDiscard: overflow };
        const nextBank = grantGold ? { ...working.bank, gold: working.bank.gold - 1 } : working.bank;
        working = {
          ...working,
          bank: nextBank,
          players: updatePlayer(working.players, player.id as SplendorPlayerID, nextMeWithDiscard),
        };
        const action = recordAction(
          args.source === "market" ? "reserveMarket" : "reserveDeck",
          player.id as SplendorPlayerID,
          `reserved ${describeCard(cardID!)}${grantGold ? " (+1 gold)" : ""}`,
          t.turn,
        );
        if (overflow > 0) {
          return m.stay({ ...working, lastAction: action });
        }
        const post = runEndOfTurnPipeline(working, player.id as SplendorPlayerID, action);
        if (post.finish !== null) return m.finish(post.finish, post.state);
        return m.endTurn(post.state);
      },
    }),

    buyCard: move<BuyCardArgs>({
      phases: ["play"],
      run({ G, args, move: m, player, turn: t }) {
        const me = G.players[player.id as SplendorPlayerID];
        if (player.id !== t.currentPlayer) return m.invalid("not_your_turn");
        if (me.mustDiscard > 0) return m.invalid("must_discard_first");

        let cardID: string;
        let working: SplendorState = G;
        let nextReserved = me.reserved;
        if (args.source === "market") {
          if (args.tier !== 1 && args.tier !== 2 && args.tier !== 3) {
            return m.invalid("invalid_tier");
          }
          if (typeof args.slot !== "number" || args.slot < 0 || args.slot >= MARKET_SLOTS) {
            return m.invalid("invalid_slot");
          }
          const rowKey = `tier${args.tier}` as const;
          const id = working.market[rowKey][args.slot];
          if (id === null || id === undefined) return m.invalid("empty_market_slot");
          cardID = id;
        } else if (args.source === "reserved") {
          if (typeof args.cardID !== "string") return m.invalid("missing_card_id");
          if (!me.reserved.includes(args.cardID)) return m.invalid("card_not_reserved");
          cardID = args.cardID;
          nextReserved = me.reserved.filter((id) => id !== cardID);
        } else {
          return m.invalid("invalid_source", { source: args.source });
        }

        const card = getCard(cardID);
        if (!canAfford(me, card)) return m.invalid("cannot_afford", { cardID });

        const spend = payment(me, card);
        let updatedMe = spendChips(me, spend);
        updatedMe = { ...updatedMe, reserved: nextReserved };
        updatedMe = applyBonus(updatedMe, card);
        const nextBank = returnChipsToBank(working.bank, spend);

        working = {
          ...working,
          bank: nextBank,
          players: updatePlayer(working.players, player.id as SplendorPlayerID, updatedMe),
        };

        if (args.source === "market") {
          working = refillMarketSlot(working, args.tier!, args.slot!);
        }

        const action = recordAction(
          args.source === "market" ? "buyMarket" : "buyReserved",
          player.id as SplendorPlayerID,
          `bought ${describeCard(cardID)}`,
          t.turn,
        );
        const post = runEndOfTurnPipeline(working, player.id as SplendorPlayerID, action);
        if (post.finish !== null) return m.finish(post.finish, post.state);
        return m.endTurn(post.state);
      },
    }),

    discardChips: move<DiscardChipsArgs>({
      phases: ["play"],
      run({ G, args, move: m, player, turn: t }) {
        const me = G.players[player.id as SplendorPlayerID];
        if (player.id !== t.currentPlayer) return m.invalid("not_your_turn");
        if (me.mustDiscard <= 0) return m.invalid("no_discard_required");
        const chips = args.chips ?? {};
        let total = 0;
        for (const color of CHIP_COLORS) {
          const v = chips[color] ?? 0;
          if (v < 0) return m.invalid("invalid_amount", { color, amount: v });
          if (v > me.chips[color]) return m.invalid("not_enough_chips", { color });
          total += v;
        }
        if (total !== me.mustDiscard) {
          return m.invalid("must_discard_exact", { required: me.mustDiscard, supplied: total });
        }
        const nextChips: Record<ChipColor, number> = { ...me.chips };
        const nextBank = { ...G.bank };
        for (const color of CHIP_COLORS) {
          const v = chips[color] ?? 0;
          nextChips[color] -= v;
          nextBank[color] += v;
        }
        const nextMe: PlayerData = { ...me, chips: nextChips, mustDiscard: 0 };
        const working: SplendorState = {
          ...G,
          bank: nextBank,
          players: updatePlayer(G.players, player.id as SplendorPlayerID, nextMe),
        };
        const action = recordAction(
          "discard",
          player.id as SplendorPlayerID,
          `discarded ${total} chip${total === 1 ? "" : "s"}`,
          t.turn,
        );
        const post = runEndOfTurnPipeline(working, player.id as SplendorPlayerID, action);
        if (post.finish !== null) return m.finish(post.finish, post.state);
        return m.endTurn(post.state);
      },
    }),
  }),

  views: {
    player: ({ G, turn: t, phase }, player): SplendorPlayerView => {
      const state = G as SplendorState;
      const isFinished = (phase as string) === "__gamekit_finished";
      const currentPlayer = state.seatOrder[t.index % state.seatOrder.length]!;
      return computePlayerView(state, currentPlayer, isFinished, player.id as SplendorPlayerID);
    },
    public: ({ G, turn: t, phase }): SplendorPlayerView => {
      const state = G as SplendorState;
      const isFinished = (phase as string) === "__gamekit_finished";
      const currentPlayer = state.seatOrder[t.index % state.seatOrder.length]!;
      return computePublicView(state, currentPlayer, isFinished);
    },
  },
});

export type SplendorGame = typeof splendor;

// Hint to the type system about the player view shape, mirroring battleship.
export type { MarketState };
