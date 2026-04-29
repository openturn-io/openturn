import { describe, expect, test } from "bun:test";
import { attachLocalBots, type Bot } from "@openturn/bot";
import { createLocalSession } from "@openturn/core";
import { splendor } from "@openturn/example-splendor-game";

import { greedyBot } from "./greedy";
import { splendorBotRegistry } from "./index";
import { randomBot } from "./random";
import { strategicBot } from "./strategic";

const splendorMatch = { players: ["0", "1"] as const };

interface ResultLike {
  winner?: string;
  draw?: boolean;
}

async function playToCompletion(
  rawSession: ReturnType<typeof createLocalSession<typeof splendor, typeof splendorMatch>>,
  bots: { "0": Bot<typeof splendor>; "1": Bot<typeof splendor> },
  maxTurns = 600,
): Promise<ResultLike | null> {
  const errors: string[] = [];
  const { session, isBot, whenIdle, detachAll } = attachLocalBots({
    session: rawSession,
    game: splendor,
    bots,
    actionDelayMs: 0,
    onError: (e) => {
      errors.push(`${e.error}: ${e.reason ?? "<no reason>"} (action=${e.action.event})`);
    },
  });

  for (let step = 0; step < maxTurns; step += 1) {
    const snapshot = session.getState();
    const result = snapshot.meta.result;
    if (result !== null && result !== undefined) break;
    const active = snapshot.derived.activePlayers[0];
    if (active === undefined) break;
    if (isBot(active)) await whenIdle(active);
    else break;
  }

  const final = session.getState().meta.result as ResultLike | null;
  detachAll();
  if (errors.length > 0) {
    throw new Error(`bot dispatch errors: ${errors.slice(0, 3).join(" | ")}`);
  }
  return final;
}

describe("splendor integration: bots terminate", () => {
  test("registry exposes the strategic bot", () => {
    const descriptor = splendorBotRegistry.entries.find((entry) => entry.botID === "strategic");
    expect(descriptor?.difficulty).toBe("hard");
    expect(descriptor?.bot).toBe(strategicBot);
  });

  test("strategic vs greedy reaches a winner", async () => {
    const session = createLocalSession(splendor, { match: splendorMatch, seed: "s-vs-g" });
    const result = await playToCompletion(session, { "0": strategicBot, "1": greedyBot });
    expect(result).not.toBeNull();
    expect(typeof result?.winner === "string").toBe(true);
  }, 30_000);

  test("greedy vs greedy reaches a winner", async () => {
    const session = createLocalSession(splendor, { match: splendorMatch, seed: "g-vs-g" });
    const result = await playToCompletion(session, { "0": greedyBot, "1": greedyBot });
    expect(result).not.toBeNull();
    expect(typeof result?.winner === "string").toBe(true);
  }, 30_000);

  test("random vs greedy reaches a winner", async () => {
    const session = createLocalSession(splendor, { match: splendorMatch, seed: "r-vs-g" });
    const result = await playToCompletion(session, { "0": randomBot, "1": greedyBot });
    expect(result).not.toBeNull();
    expect(typeof result?.winner === "string").toBe(true);
  }, 60_000);

  test("random vs random terminates within turn cap (no invalid dispatches)", async () => {
    const session = createLocalSession(splendor, { match: splendorMatch, seed: "r-vs-r" });
    const result = await playToCompletion(session, { "0": randomBot, "1": randomBot }, 2000);
    // Random play in splendor may not always reach the prestige threshold inside
    // the turn cap; the assertion is the negative one — no invalid dispatches.
    expect(typeof result === "object" || result === null).toBe(true);
  }, 60_000);
});
