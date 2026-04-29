import { createRng, type DeterministicRng, type RngSnapshot } from "@openturn/core";

/**
 * RNG handed to a bot's `decide`. Forked from the snapshot's `meta.rng`
 * with a salt that includes the bot's name, the player ID, and the turn
 * number, so two bots on the same snapshot get different (but reproducible)
 * streams.
 */
export type BotRng = DeterministicRng;

export function forkRng(
  base: RngSnapshot,
  botName: string,
  playerID: string,
  turn: number,
): BotRng {
  const seed = `bot:${botName}:${playerID}:${turn}:${base.seed}:${base.draws}:${base.state}`;
  return createRng(seed);
}
