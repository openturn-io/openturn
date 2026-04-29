import { useEffect, useRef, useState } from "react";

import { attachLocalBots, type AttachLocalBotsResult, type Bot } from "@openturn/bot";
import type {
  AnyGame,
  GamePlayers,
  LocalGameSession,
  MatchInput,
} from "@openturn/core";

import { findBot, type BotRegistry } from "../registry";
import type { LobbyChannelHandle } from "./lobby";

export interface UseBotAttachOnTransitionOptions<TGame extends AnyGame> {
  /** The bot-aware lobby channel (local or hosted). */
  channel: LobbyChannelHandle;
  /** Game definition the bots play. */
  game: TGame;
  /** Lookup for `botID → Bot<TGame>` instances. */
  registry: BotRegistry<TGame>;
  /**
   * The freshly-created session bots will dispatch into. The consumer
   * typically creates this lazily when `channel.transition` arrives.
   */
  session: LocalGameSession<TGame, MatchInput<GamePlayers<TGame>>> | null;
}

/**
 * Bot-aware session facade returned after attachment. **Use this in your
 * game loop instead of the raw session passed to the hook** — human
 * dispatches against the raw session are invisible to the bot runners.
 *
 * `null` until the transition fires and at least one bot seat is found.
 */
export type BotAttachedSession<TGame extends AnyGame> =
  | LocalGameSession<TGame, MatchInput<GamePlayers<TGame>>>
  | null;

/**
 * After a `lobby:transition_to_game` arrives on the channel, attach every
 * bot seat (according to `transition.playerAssignments`) to the session via
 * `attachLocalBots`. Returns the bot-aware session facade — drive your
 * game UI with that, NOT the raw session you passed in. Cleans up on
 * unmount or when the transition resets.
 */
export function useBotAttachOnTransition<TGame extends AnyGame>(
  options: UseBotAttachOnTransitionOptions<TGame>,
): BotAttachedSession<TGame> {
  const { channel, game, registry, session } = options;
  const attachmentRef = useRef<AttachLocalBotsResult<TGame> | null>(null);
  const [facade, setFacade] = useState<BotAttachedSession<TGame>>(null);

  useEffect(() => {
    if (channel.transition === null || session === null) {
      setFacade(null);
      return;
    }

    const bots: Partial<Record<string, Bot<TGame>>> = {};
    for (const assignment of channel.transition.playerAssignments) {
      if (assignment.kind !== "bot" || assignment.botID === undefined) continue;
      const descriptor = findBot(registry, assignment.botID);
      if (descriptor === null) continue;
      bots[assignment.playerID] = descriptor.bot;
    }
    if (Object.keys(bots).length === 0) {
      setFacade(null);
      return;
    }

    const attachment = attachLocalBots<TGame>({
      session,
      game,
      bots: bots as Partial<Record<GamePlayers<TGame>[number], Bot<TGame>>>,
    });
    attachmentRef.current = attachment;
    setFacade(attachment.session);

    return () => {
      attachment.detachAll();
      if (attachmentRef.current === attachment) {
        attachmentRef.current = null;
        setFacade(null);
      }
    };
  }, [channel.transition, game, registry, session]);

  return facade;
}
