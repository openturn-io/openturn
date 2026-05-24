import { describe, expect, test } from "bun:test";
import { attachLocalBots, type Bot } from "@openturn/bot";
import { createLocalSession } from "@openturn/core";
import { modernArt } from "@openturn/example-modern-art-game";

import { conservativeBot } from "./conservative";
import { modernArtBotRegistry } from "./index";
import { randomBot } from "./random";
import { speculatorBot } from "./speculator";

const match = { players: ["0", "1", "2"] as const };

async function playSteps(
  bots: Record<string, Bot<typeof modernArt>>,
  seed: string,
  maxSteps = 600,
) {
  const errors: string[] = [];
  const rawSession = createLocalSession(modernArt, { match, seed });
  const { session, isBot, whenIdle, detachAll } = attachLocalBots({
    actionDelayMs: 0,
    bots,
    game: modernArt,
    onError: (error) => errors.push(`${error.error}:${error.reason ?? "unknown"}`),
    session: rawSession,
  });

  for (let i = 0; i < maxSteps; i += 1) {
    const snapshot = session.getState();
    if (snapshot.meta.result !== null) break;
    const active = snapshot.derived.activePlayers[0];
    if (active === undefined) break;
    if (isBot(active)) await whenIdle(active);
  }
  const result = session.getState().meta.result;
  detachAll();
  if (errors.length > 0) throw new Error(errors.join(" | "));
  return result;
}

describe("modern art bots", () => {
  test("registry exposes multiplayer lobby bots", () => {
    expect(modernArtBotRegistry.entries.map((entry) => entry.botID)).toEqual([
      "random",
      "conservative",
      "speculator",
    ]);
  });

  test("heuristic bots dispatch legal actions", async () => {
    const result = await playSteps({
      "0": conservativeBot,
      "1": speculatorBot,
      "2": randomBot,
    }, "bot-smoke");
    expect(typeof result === "object" || result === null).toBe(true);
  }, 30_000);
});
