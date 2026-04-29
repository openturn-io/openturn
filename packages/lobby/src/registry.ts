import type { Bot } from "@openturn/bot";
import type { AnyGame } from "@openturn/core";

export type BotDifficulty = "easy" | "medium" | "hard" | "expert";

export interface BotDescriptor<TGame extends AnyGame = AnyGame> {
  /** Stable, registry-unique identifier. Used as the wire `botID`. */
  readonly botID: string;
  /** Human-readable label shown in the lobby UI. */
  readonly label: string;
  readonly description?: string;
  readonly difficulty?: BotDifficulty;
  /**
   * Pre-built bot. Different difficulties are distinct `Bot` instances,
   * each with its own `botID` in the registry.
   */
  readonly bot: Bot<TGame>;
}

export interface BotRegistry<TGame extends AnyGame = AnyGame> {
  readonly entries: ReadonlyArray<BotDescriptor<TGame>>;
}

/**
 * Build a bot registry from an entry list. Validates that every `botID` is
 * unique; throws on duplicates so misconfiguration fails at game-definition
 * time rather than at lobby-render time.
 */
export function defineBotRegistry<TGame extends AnyGame>(
  entries: ReadonlyArray<BotDescriptor<TGame>>,
): BotRegistry<TGame> {
  const seen = new Set<string>();
  for (const entry of entries) {
    if (entry.botID.length === 0) {
      throw new Error("defineBotRegistry: botID must be a non-empty string");
    }
    if (seen.has(entry.botID)) {
      throw new Error(`defineBotRegistry: duplicate botID "${entry.botID}"`);
    }
    seen.add(entry.botID);
  }
  return { entries };
}

/**
 * Look up a descriptor by `botID`. Returns `null` when absent. Used by the
 * lobby UI to render the chosen bot's label and by the supervisor to wire
 * the corresponding `Bot` instance into the freshly-started session.
 */
export function findBot<TGame extends AnyGame>(
  registry: BotRegistry<TGame> | undefined,
  botID: string,
): BotDescriptor<TGame> | null {
  if (registry === undefined) return null;
  for (const entry of registry.entries) {
    if (entry.botID === botID) return entry;
  }
  return null;
}

/**
 * Return a copy of `game` with the bot registry attached at `game.bots`. The
 * engine ignores this field; the lobby runtime + bot supervisor read it as a
 * single source of truth for "what bots can occupy a seat in this game".
 *
 * Why a helper instead of inlining `defineGame({ bots })`: registries usually
 * live in a sibling package that imports the game's types, which would create
 * a circular package dep if the game also imported the registry. Keep the
 * cycle one-way — the game stays bot-free, and the bots package re-exports a
 * `gameWithBots` value built via this helper.
 */
export function attachBots<TGame extends AnyGame>(
  game: TGame,
  registry: BotRegistry<TGame>,
): TGame {
  return { ...game, bots: registry };
}

/**
 * Build a `LobbyEnv.knownBots` map from a registry. The lobby runtime
 * accepts this map at construction time and uses it to validate
 * `lobby:assign_bot` requests + populate `lobby:state.availableBots`.
 */
export function buildKnownBots<TGame extends AnyGame>(
  registry: BotRegistry<TGame> | undefined,
): ReadonlyMap<string, { label: string; description?: string; difficulty?: BotDifficulty }> {
  const out = new Map<string, { label: string; description?: string; difficulty?: BotDifficulty }>();
  if (registry === undefined) return out;
  for (const entry of registry.entries) {
    out.set(entry.botID, {
      label: entry.label,
      ...(entry.description === undefined ? {} : { description: entry.description }),
      ...(entry.difficulty === undefined ? {} : { difficulty: entry.difficulty }),
    });
  }
  return out;
}
