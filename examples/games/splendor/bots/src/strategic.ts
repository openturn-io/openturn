import { defineBot, type LegalAction } from "@openturn/bot";
import {
  CHIP_CAP,
  CHIP_COLORS,
  GEM_COLORS,
  RESERVE_LIMIT,
  WIN_PRESTIGE,
  canAfford,
  enumerateSplendorLegalActions,
  getCard,
  getNoble,
  splendor,
  totalChips,
  type BuyCardArgs,
  type Card,
  type GemColor,
  type PlayerData,
  type PublicPlayerData,
  type ReserveCardArgs,
  type SplendorPlayerID,
  type SplendorPlayerView,
  type SplendorState,
  type TakeThreeArgs,
  type TakeTwoArgs,
} from "@openturn/example-splendor-game";

type SplendorGame = typeof splendor;

interface CardTarget {
  card: Card;
}

/**
 * Strategic heuristic bot: behaves more like a competent human player than
 * the greedy baseline. It values tempo, noble routes, engine balance, reserved
 * plans, and blocking opponents' near-term point cards.
 */
export const strategicBot = defineBot<SplendorGame>({
  name: "strategic",
  thinkingBudgetMs: 2_000,
  actionDelayMs: 1_500,
  enumerate({ snapshot, playerID }) {
    if (snapshot === null) return [];
    return enumerateSplendorLegalActions(snapshot.G as SplendorState, playerID as SplendorPlayerID);
  },
  decide({ legalActions, view, playerID, snapshot, rng }) {
    if (legalActions.length === 0) {
      throw new Error("strategicBot: no legal actions available");
    }

    const playerView = view as SplendorPlayerView;
    const me = playerView.players[playerID];
    if (me === undefined) return legalActions[0]!;

    const state = snapshot?.G as SplendorState | undefined;
    const buys = legalActions.filter((action) => action.event === "buyCard");
    const candidates = buys.length > 0 ? buys : legalActions;
    const scored = candidates.map((action) => {
      const score = state !== undefined
        ? evaluateStateAction(state, playerID as SplendorPlayerID, action)
        : evaluateViewAction(playerView, playerID as SplendorPlayerID, action);
      return { action, score: score + rng.next() * 0.001 };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored[0]!.action;
  },
});

function evaluateStateAction(
  state: SplendorState,
  playerID: SplendorPlayerID,
  action: LegalAction,
): number {
  const me = state.players[playerID];

  let score = evaluatePlayerPosition(me, state, playerID);
  score -= bestOpponentPosition(state, playerID) * 0.52;
  score += evaluateActionShape(action, state, me, playerID);

  const card = stateActionCard(action, state);
  if (action.event === "buyCard" && card !== null) {
    const postScore = me.score + card.prestige + nobleScoreIfBought(me, state, card);
    if (postScore >= WIN_PRESTIGE) score += 1_000;
    if (state.lastRoundTrigger !== null && postScore >= bestOpponentScore(state, playerID)) score += 180;
  }

  return score;
}

function evaluateViewAction(
  view: SplendorPlayerView,
  playerID: SplendorPlayerID,
  action: LegalAction,
): number {
  const me = view.players[playerID];
  if (me === undefined) return -10_000;

  let score = evaluatePublicPlayerPosition(me, view);
  score += evaluatePublicActionShape(action, view, me);

  const card = actionCard(action, view);
  if (card !== null) {
    if (action.event === "buyCard") {
      score += 260 + card.prestige * 1_000 + card.tier * 10 + bonusDemand(view, me, card.bonus) * 10;
      if (me.score + card.prestige >= WIN_PRESTIGE) score += 1_000;
    } else if (action.event === "reserveCard") {
      score += reserveValue(card, view, me);
    }
  }

  return score;
}

function evaluatePlayerPosition(
  player: PlayerData,
  state: SplendorState,
  playerID: SplendorPlayerID,
): number {
  let score = player.score * 145;
  score += player.nobles.length * 70;
  score += totalBonusValue(player, state) * 18;
  score += totalChips(player) * 3 + player.chips.gold * 15;
  score += evaluateNobleProgress(player, state) * 18;
  score += evaluateCardTargets(player, state, playerID) * 16;
  score += player.reserved.length * 5;
  score -= Math.max(0, totalChips(player) - CHIP_CAP) * 35;
  score -= player.mustDiscard * 80;
  return score;
}

function evaluatePublicPlayerPosition(player: PublicPlayerData, view: SplendorPlayerView): number {
  let score = player.score * 145;
  score += player.nobles.length * 70;
  score += totalPublicBonusValue(player, view) * 18;
  score += publicChipTotal(player) * 3 + player.chips.gold * 15;
  score += evaluatePublicNobleProgress(player, view) * 18;
  score += evaluatePublicTargets(player, view) * 16;
  score += player.reservedCount * 5;
  score -= Math.max(0, publicChipTotal(player) - CHIP_CAP) * 35;
  score -= player.mustDiscard * 80;
  return score;
}

function evaluateActionShape(
  action: LegalAction,
  state: SplendorState,
  player: PlayerData,
  playerID: SplendorPlayerID,
): number {
  if (action.event === "discardChips") return 500;

  const beforeCard = stateActionCard(action, state);
  if (action.event === "buyCard" && beforeCard !== null) {
    let score = 260 + beforeCard.prestige * 1_000 + beforeCard.tier * 10;
    score += nobleScoreIfBought(player, state, beforeCard) * 500;
    score += bonusDemandForState(state, player, beforeCard.bonus) * 10;
    score -= paymentWaste(player, beforeCard) * 8;
    if (player.score >= WIN_PRESTIGE) score += 1_000;
    return score;
  }

  if (action.event === "reserveCard" && beforeCard !== null) {
    return reserveValueForState(beforeCard, state, player, playerID);
  }

  if (action.event === "takeThreeGems") {
    const colors = (action.payload as TakeThreeArgs).colors;
    return colors.reduce((sum, color) => sum + gemNeedForState(state, player, color, playerID), 0);
  }

  if (action.event === "takeTwoGems") {
    const color = (action.payload as TakeTwoArgs).color;
    return gemNeedForState(state, player, color, playerID) * 1.85 + 4;
  }

  return 0;
}

function evaluatePublicActionShape(
  action: LegalAction,
  view: SplendorPlayerView,
  player: PublicPlayerData,
): number {
  if (action.event === "discardChips") return 500;
  if (action.event === "takeThreeGems") {
    return (action.payload as TakeThreeArgs).colors.reduce(
      (sum, color) => sum + gemNeed(view, player, color),
      0,
    );
  }
  if (action.event === "takeTwoGems") {
    return gemNeed(view, player, (action.payload as TakeTwoArgs).color) * 1.85 + 4;
  }
  return 0;
}

function bestOpponentPosition(state: SplendorState, playerID: SplendorPlayerID): number {
  let best = 0;
  for (const id of state.seatOrder) {
    if (id === playerID) continue;
    best = Math.max(best, evaluateOpponentPosition(state.players[id], state));
  }
  return best;
}

function evaluateOpponentPosition(player: PlayerData, state: SplendorState): number {
  let score = player.score * 145;
  score += player.nobles.length * 70;
  score += totalBonusValue(player, state) * 18;
  score += totalChips(player) * 3 + player.chips.gold * 15;
  score += evaluateNobleProgress(player, state) * 18;
  score -= Math.max(0, totalChips(player) - CHIP_CAP) * 35;
  score -= player.mustDiscard * 80;
  return score;
}

function bestOpponentScore(state: SplendorState, playerID: SplendorPlayerID): number {
  let best = 0;
  for (const id of state.seatOrder) {
    if (id !== playerID) best = Math.max(best, state.players[id].score);
  }
  return best;
}

function nobleScoreIfBought(player: PlayerData, state: SplendorState, card: Card): number {
  const nextBonuses = { ...player.bonuses, [card.bonus]: player.bonuses[card.bonus] + 1 };
  for (const nobleID of state.nobles) {
    const noble = getNoble(nobleID);
    let qualifies = true;
    for (const color of GEM_COLORS) {
      if (nextBonuses[color] < (noble.requires[color] ?? 0)) {
        qualifies = false;
        break;
      }
    }
    if (qualifies) return 3;
  }
  return 0;
}

function evaluateCardTargets(player: PlayerData, state: SplendorState, playerID: SplendorPlayerID): number {
  const targets = collectStateTargets(state, playerID);
  let total = 0;
  for (const target of targets) {
    const distance = cardDistance(player, target.card);
    const value = target.card.prestige * 8 + target.card.tier * 2 + bonusDemandForState(state, player, target.card.bonus);
    total += Math.max(0, value - distance * 2.4);
  }
  return total;
}

function evaluatePublicTargets(player: PublicPlayerData, view: SplendorPlayerView): number {
  let total = 0;
  for (const target of collectViewTargets(view, player)) {
    const distance = publicCardDistance(player, target.card);
    const value = target.card.prestige * 8 + target.card.tier * 2 + bonusDemand(view, player, target.card.bonus);
    total += Math.max(0, value - distance * 2.4);
  }
  return total;
}

function evaluateNobleProgress(player: PlayerData, state: SplendorState): number {
  let best = 0;
  for (const nobleID of state.nobles) {
    const noble = getNoble(nobleID);
    let progress = 0;
    let missing = 0;
    for (const color of GEM_COLORS) {
      const required = noble.requires[color] ?? 0;
      progress += Math.min(player.bonuses[color], required);
      missing += Math.max(0, required - player.bonuses[color]);
    }
    best = Math.max(best, progress * 2 - missing * 1.5);
  }
  return best;
}

function evaluatePublicNobleProgress(player: PublicPlayerData, view: SplendorPlayerView): number {
  let best = 0;
  for (const nobleID of view.nobles) {
    const noble = getNoble(nobleID);
    let progress = 0;
    let missing = 0;
    for (const color of GEM_COLORS) {
      const required = noble.requires[color] ?? 0;
      progress += Math.min(player.bonuses[color], required);
      missing += Math.max(0, required - player.bonuses[color]);
    }
    best = Math.max(best, progress * 2 - missing * 1.5);
  }
  return best;
}

function totalBonusValue(player: PlayerData, state: SplendorState): number {
  let total = 0;
  for (const color of GEM_COLORS) {
    total += player.bonuses[color] * (2 + bonusDemandForState(state, player, color));
  }
  return total;
}

function totalPublicBonusValue(player: PublicPlayerData, view: SplendorPlayerView): number {
  let total = 0;
  for (const color of GEM_COLORS) {
    total += player.bonuses[color] * (2 + bonusDemand(view, player, color));
  }
  return total;
}

function reserveValueForState(
  card: Card,
  state: SplendorState,
  player: PlayerData,
  playerID: SplendorPlayerID,
): number {
  if (player.reserved.length >= RESERVE_LIMIT) return -200;
  const distance = cardDistance(player, card);
  let score = card.prestige * 36 + card.tier * 6 - distance * 10;
  score += bonusDemandForState(state, player, card.bonus) * 6;
  if (state.bank.gold > 0) score += 24;
  if (opponentCanUseSoon(state, playerID, card)) score += 60 + card.prestige * 12;
  if (card.tier === 3 && card.prestige >= 4) score += 18;
  if (distance > 9 && card.prestige < 4) score -= 35;
  return score;
}

function reserveValue(card: Card, view: SplendorPlayerView, player: PublicPlayerData): number {
  if (player.reservedCount >= RESERVE_LIMIT) return -200;
  const distance = publicCardDistance(player, card);
  let score = card.prestige * 36 + card.tier * 6 - distance * 10;
  score += bonusDemand(view, player, card.bonus) * 6;
  if (view.bank.gold > 0) score += 24;
  if (publicOpponentCanUseSoon(view, player.playerID, card)) score += 60 + card.prestige * 12;
  if (card.tier === 3 && card.prestige >= 4) score += 18;
  if (distance > 9 && card.prestige < 4) score -= 35;
  return score;
}

function gemNeedForState(
  state: SplendorState,
  player: PlayerData,
  color: GemColor,
  playerID: SplendorPlayerID,
): number {
  let best = -3 - player.bonuses[color] * 1.5;
  for (const target of collectStateTargets(state, playerID)) {
    const before = cardDistance(player, target.card);
    const withChip = cardDistance({ ...player, chips: { ...player.chips, [color]: player.chips[color] + 1 } }, target.card);
    const improvement = before - withChip;
    if (improvement > 0) {
      best = Math.max(best, improvement * (18 + target.card.prestige * 5 + target.card.tier * 2));
    }
  }
  best += nobleColorDemand(state, player, color) * 7;
  return best;
}

function gemNeed(view: SplendorPlayerView, player: PublicPlayerData, color: GemColor): number {
  let best = -3 - player.bonuses[color] * 1.5;
  for (const target of collectViewTargets(view, player)) {
    const before = publicCardDistance(player, target.card);
    const withChip = publicCardDistance(
      { ...player, chips: { ...player.chips, [color]: player.chips[color] + 1 } },
      target.card,
    );
    const improvement = before - withChip;
    if (improvement > 0) {
      best = Math.max(best, improvement * (18 + target.card.prestige * 5 + target.card.tier * 2));
    }
  }
  best += publicNobleColorDemand(view, player, color) * 7;
  return best;
}

function bonusDemandForState(state: SplendorState, player: PlayerData, color: GemColor): number {
  let demand = nobleColorDemand(state, player, color);
  for (const target of collectVisibleCards(state)) {
    demand += Math.max(0, (target.cost[color] ?? 0) - player.bonuses[color]) * (target.tier + target.prestige);
  }
  return demand;
}

function bonusDemand(view: SplendorPlayerView, player: PublicPlayerData, color: GemColor): number {
  let demand = publicNobleColorDemand(view, player, color);
  for (const target of collectVisibleViewCards(view)) {
    demand += Math.max(0, (target.cost[color] ?? 0) - player.bonuses[color]) * (target.tier + target.prestige);
  }
  return demand;
}

function nobleColorDemand(state: SplendorState, player: PlayerData, color: GemColor): number {
  let demand = 0;
  for (const nobleID of state.nobles) {
    const required = getNoble(nobleID).requires[color] ?? 0;
    if (required > player.bonuses[color]) demand += required - player.bonuses[color];
  }
  return demand;
}

function publicNobleColorDemand(view: SplendorPlayerView, player: PublicPlayerData, color: GemColor): number {
  let demand = 0;
  for (const nobleID of view.nobles) {
    const required = getNoble(nobleID).requires[color] ?? 0;
    if (required > player.bonuses[color]) demand += required - player.bonuses[color];
  }
  return demand;
}

function collectStateTargets(state: SplendorState, playerID: SplendorPlayerID): CardTarget[] {
  const player = state.players[playerID];
  const targets: CardTarget[] = [];
  for (const cardID of player.reserved) {
    targets.push({ card: getCard(cardID) });
  }
  for (const tier of [1, 2, 3] as const) {
    const rowKey = `tier${tier}` as const;
    for (let slot = 0; slot < state.market[rowKey].length; slot += 1) {
      const cardID = state.market[rowKey][slot];
      if (cardID === null || cardID === undefined) continue;
      targets.push({ card: getCard(cardID) });
    }
  }
  return targets;
}

function collectViewTargets(view: SplendorPlayerView, player: PublicPlayerData): CardTarget[] {
  const targets: CardTarget[] = [];
  for (const cardID of player.reservedCards) {
    targets.push({ card: getCard(cardID) });
  }
  for (const tier of [1, 2, 3] as const) {
    const rowKey = `tier${tier}` as const;
    for (let slot = 0; slot < view.market[rowKey].length; slot += 1) {
      const cardID = view.market[rowKey][slot];
      if (cardID === null || cardID === undefined) continue;
      targets.push({ card: getCard(cardID) });
    }
  }
  return targets;
}

function collectVisibleCards(state: SplendorState): Card[] {
  const cards: Card[] = [];
  for (const tier of [1, 2, 3] as const) {
    const rowKey = `tier${tier}` as const;
    for (const cardID of state.market[rowKey]) {
      if (cardID !== null) cards.push(getCard(cardID));
    }
  }
  return cards;
}

function collectVisibleViewCards(view: SplendorPlayerView): Card[] {
  const cards: Card[] = [];
  for (const tier of [1, 2, 3] as const) {
    const rowKey = `tier${tier}` as const;
    for (const cardID of view.market[rowKey]) {
      if (cardID !== null) cards.push(getCard(cardID));
    }
  }
  return cards;
}

function cardDistance(player: PlayerData, card: Card): number {
  if (canAfford(player, card)) return 0;
  let missing = 0;
  let gold = player.chips.gold;
  for (const color of GEM_COLORS) {
    const needed = Math.max(0, (card.cost[color] ?? 0) - player.bonuses[color] - player.chips[color]);
    const goldUsed = Math.min(gold, needed);
    gold -= goldUsed;
    missing += needed - goldUsed;
  }
  return missing;
}

function publicCardDistance(player: PublicPlayerData, card: Card): number {
  let missing = 0;
  let gold = player.chips.gold;
  for (const color of GEM_COLORS) {
    const needed = Math.max(0, (card.cost[color] ?? 0) - player.bonuses[color] - player.chips[color]);
    const goldUsed = Math.min(gold, needed);
    gold -= goldUsed;
    missing += needed - goldUsed;
  }
  return missing;
}

function paymentWaste(player: PlayerData, card: Card): number {
  let waste = 0;
  for (const color of GEM_COLORS) {
    const required = card.cost[color] ?? 0;
    waste += Math.max(0, player.bonuses[color] - required);
  }
  return waste;
}

function opponentCanUseSoon(state: SplendorState, playerID: SplendorPlayerID, card: Card): boolean {
  for (const id of state.seatOrder) {
    if (id === playerID) continue;
    const opponent = state.players[id];
    if (cardDistance(opponent, card) <= 2 || opponent.score + card.prestige >= WIN_PRESTIGE) return true;
  }
  return false;
}

function publicOpponentCanUseSoon(view: SplendorPlayerView, playerID: SplendorPlayerID, card: Card): boolean {
  for (const id of view.seatOrder) {
    if (id === playerID) continue;
    const opponent = view.players[id];
    if (opponent !== undefined && publicCardDistance(opponent, card) <= 2) return true;
  }
  return false;
}

function stateActionCard(action: LegalAction, state: SplendorState): Card | null {
  if (action.event === "buyCard") {
    const payload = action.payload as BuyCardArgs;
    if (payload.source === "reserved" && payload.cardID !== undefined) return getCard(payload.cardID);
    if (payload.source === "market" && payload.tier !== undefined && payload.slot !== undefined) {
      const cardID = state.market[`tier${payload.tier}` as const][payload.slot];
      return cardID === null || cardID === undefined ? null : getCard(cardID);
    }
  }
  if (action.event === "reserveCard") {
    const payload = action.payload as ReserveCardArgs;
    if (payload.source !== "market" || payload.slot === undefined) return null;
    const cardID = state.market[`tier${payload.tier}` as const][payload.slot];
    return cardID === null || cardID === undefined ? null : getCard(cardID);
  }
  return null;
}

function actionCard(action: LegalAction, view: SplendorPlayerView): Card | null {
  if (action.event === "buyCard") {
    const payload = action.payload as BuyCardArgs;
    if (payload.source === "reserved" && payload.cardID !== undefined) return getCard(payload.cardID);
    if (payload.source === "market" && payload.tier !== undefined && payload.slot !== undefined) {
      const cardID = view.market[`tier${payload.tier}` as const][payload.slot];
      return cardID === null || cardID === undefined ? null : getCard(cardID);
    }
  }
  if (action.event === "reserveCard") {
    const payload = action.payload as ReserveCardArgs;
    if (payload.source !== "market" || payload.slot === undefined) return null;
    const cardID = view.market[`tier${payload.tier}` as const][payload.slot];
    return cardID === null || cardID === undefined ? null : getCard(cardID);
  }
  return null;
}

function publicChipTotal(player: PublicPlayerData): number {
  let total = 0;
  for (const color of CHIP_COLORS) total += player.chips[color];
  return total;
}
