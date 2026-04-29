import { attachLocalBots, type AttachLocalBotsResult, type Bot } from "@openturn/bot";
import type {
  AnyGame,
  GamePlayers,
  LocalGameSession,
  MatchInput,
} from "@openturn/core";

import { findBot, type BotRegistry } from "../registry";
import type { BotSeatAssignment, BotSupervisor } from "./index";

export interface CreateLocalBotSupervisorOptions<TGame extends AnyGame> {
  /** The freshly-created session that the bots will dispatch into. */
  session: LocalGameSession<TGame, MatchInput<GamePlayers<TGame>>>;
  /** The game definition the bots play; used by `attachLocalBots` for `simulate`. */
  game: TGame;
  /** Lookup table for `botID → Bot<TGame>`. Same registry the lobby UI uses. */
  registry: BotRegistry<TGame>;
}

export interface LocalBotSupervisor<TGame extends AnyGame> extends BotSupervisor {
  /**
   * Bot-aware session facade — use this in your game loop instead of the
   * raw session you passed to `createLocalBotSupervisor`. Human dispatches
   * through this facade notify the bot runners; dispatches against the raw
   * session are invisible to the bots. Throws if `start()` has not run yet.
   */
  getSession(): LocalGameSession<TGame, MatchInput<GamePlayers<TGame>>>;
}

/**
 * In-process bot supervisor for local matches. Calls `attachLocalBots` once
 * per bot-seat assignment when `start(...)` is invoked. After start, the
 * supervisor's `getSession()` returns a session-shaped facade — drive your
 * game loop with that, NOT the raw session.
 *
 * Use this when the host (CLI dev shell, single-device React app) holds the
 * `LocalGameSession` directly. For network-attached bots that connect via
 * `HostedClient`, use `createHostedBotSupervisor` instead.
 */
export function createLocalBotSupervisor<TGame extends AnyGame>(
  options: CreateLocalBotSupervisorOptions<TGame>,
): LocalBotSupervisor<TGame> {
  let attachment: AttachLocalBotsResult<TGame> | null = null;

  return {
    async start(assignments: ReadonlyArray<BotSeatAssignment>): Promise<void> {
      if (attachment !== null) {
        throw new Error("createLocalBotSupervisor: start() already called");
      }
      const bots: Partial<Record<string, Bot<TGame>>> = {};
      for (const assignment of assignments) {
        const descriptor = findBot(options.registry, assignment.botID);
        if (descriptor === null) {
          throw new Error(
            `createLocalBotSupervisor: unknown botID "${assignment.botID}" — `
              + `not present in the supplied BotRegistry`,
          );
        }
        bots[assignment.playerID] = descriptor.bot;
      }

      attachment = attachLocalBots<TGame>({
        session: options.session,
        game: options.game,
        bots: bots as Partial<Record<GamePlayers<TGame>[number], Bot<TGame>>>,
      });
    },

    stop(): void {
      if (attachment === null) return;
      attachment.detachAll();
      attachment = null;
    },

    getSession(): LocalGameSession<TGame, MatchInput<GamePlayers<TGame>>> {
      if (attachment === null) {
        throw new Error(
          "createLocalBotSupervisor: call start() before getSession()",
        );
      }
      return attachment.session;
    },
  };
}
