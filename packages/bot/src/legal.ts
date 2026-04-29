import type {
  AnyGame,
  GamePlayerView,
  GamePlayers,
  GameSnapshotOf,
  LegalAction,
} from "@openturn/core";

import type { Bot } from "./define";

/**
 * Returns the candidate legal moves for a given seat. Resolution order:
 *
 *  1. The game's own `legalActions` hook (preferred — defined on the game
 *     definition by the author).
 *  2. The bot's `enumerate` fallback.
 *  3. Empty array (the bot will have to refuse, or rely entirely on
 *     `simulate` exploration).
 */
export function enumerateLegalActions<TGame extends AnyGame>(
  game: TGame,
  snapshot: GameSnapshotOf<TGame>,
  view: GamePlayerView<TGame>,
  playerID: GamePlayers<TGame>[number],
  bot: Bot<TGame>,
): ReadonlyArray<LegalAction> {
  const gameHook = (game as { legalActions?: Function }).legalActions;
  if (typeof gameHook === "function") {
    const context = {
      G: snapshot.G,
      derived: snapshot.derived,
      match: snapshot.meta.match,
      now: snapshot.meta.now,
      position: snapshot.position,
    };
    const result = gameHook(context, playerID) as ReadonlyArray<LegalAction>;
    return result;
  }

  if (bot.enumerate !== undefined) {
    return bot.enumerate({ view, snapshot, playerID });
  }

  return [];
}
