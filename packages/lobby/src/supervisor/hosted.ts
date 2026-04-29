import { attachHostedBot, type BotRunner } from "@openturn/bot";
import {
  createHostedClient,
  type HostedClient,
  type HostedTransport,
} from "@openturn/client";
import type { AnyGame, GamePlayers } from "@openturn/core";
import type { MatchID } from "@openturn/protocol";

import { findBot, type BotRegistry } from "../registry";
import type { BotSeatAssignment, BotSupervisor } from "./index";

export interface CreateHostedBotSupervisorOptions<TGame extends AnyGame> {
  /** Game definition the bots play. Read for `legalActions` and types. */
  game: TGame;
  /** Lookup table for `botID → Bot<TGame>`. */
  registry: BotRegistry<TGame>;
  /**
   * `roomID` of the room the bots will connect to. Same value as the human
   * clients use; the server tracks bot users by their per-seat token.
   */
  roomID: MatchID;
  /**
   * Transport for the in-process WebSocket connection. Cloud Durable Objects
   * inject a self-loop transport (so bot sockets never leave the DO);
   * the OSS dev server uses a real `WebSocket` transport against `localhost`.
   * Falls back to the global `WebSocket` if omitted.
   */
  transport?: HostedTransport;
  /**
   * Optional override for how each per-bot-seat socket URL is built. Most
   * hosts can leave this to the default (the supervisor passes the assigned
   * `websocketURL` straight through).
   */
  createSocketURL?: (context: {
    playerID: string;
    roomID: MatchID;
    token: string;
  }) => string;
}

/**
 * Hosted bot supervisor — opens one `HostedClient` per bot seat assignment,
 * authenticated with the per-seat token the host minted at lobby start.
 * Inside a Cloudflare Durable Object this becomes a self-loop (bot sockets
 * never traverse the network); for OSS dev it's a real localhost WebSocket.
 *
 * Failure modes degrade gracefully: if a bot's `decide` throws or the
 * socket drops, that seat goes silent — same recovery path the engine
 * already has for a disconnected human (turn timeout, etc.).
 */
export function createHostedBotSupervisor<TGame extends AnyGame>(
  options: CreateHostedBotSupervisorOptions<TGame>,
): BotSupervisor {
  const runners = new Map<number, BotRunner>();
  const clients = new Map<number, HostedClient>();

  return {
    async start(assignments: ReadonlyArray<BotSeatAssignment>): Promise<void> {
      for (const assignment of assignments) {
        const transition = assignment.hostedTransition;
        if (transition === undefined) {
          throw new Error(
            `createHostedBotSupervisor: bot seat ${assignment.seatIndex} `
              + `is missing a hostedTransition (roomToken/websocketURL)`,
          );
        }
        const descriptor = findBot(options.registry, assignment.botID);
        if (descriptor === null) {
          throw new Error(
            `createHostedBotSupervisor: unknown botID "${assignment.botID}"`,
          );
        }

        const client = createHostedClient({
          roomID: options.roomID,
          playerID: assignment.playerID,
          getRoomToken: () => Promise.resolve(transition.roomToken),
          ...(options.transport === undefined ? {} : { transport: options.transport }),
          ...(options.createSocketURL === undefined
            ? {}
            : { createSocketURL: options.createSocketURL }),
        });
        await client.connect();
        clients.set(assignment.seatIndex, client);

        const runner = attachHostedBot<TGame>({
          client,
          playerID: assignment.playerID as GamePlayers<TGame>[number],
          bot: descriptor.bot,
          game: options.game,
        });
        runners.set(assignment.seatIndex, runner);
      }
    },

    stop(): void {
      for (const runner of runners.values()) runner.detach();
      for (const client of clients.values()) {
        try {
          client.disconnect();
        } catch {}
      }
      runners.clear();
      clients.clear();
    },
  };
}
