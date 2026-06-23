import { describe, expect, test } from "bun:test";

import { attachLocalBots, type Bot } from "@openturn/bot";
import { createLocalSession, type MatchInput } from "@openturn/core";
import {
  modernArt,
  type ModernArtPlayerID,
} from "@openturn/example-modern-art-v2-game";

import { collectorBot } from "./collector";
import { randomBot } from "./random";
import { speculatorBot } from "./speculator";

type ModernArtMatch = MatchInput<typeof modernArt.playerIDs>;
type Session = ReturnType<typeof createLocalSession<typeof modernArt, ModernArtMatch>>;

function seats(n: 3 | 4 | 5): readonly [ModernArtPlayerID, ...ModernArtPlayerID[]] {
  return modernArt.playerIDs.slice(0, n) as readonly [ModernArtPlayerID, ...ModernArtPlayerID[]];
}

async function playToCompletion(
  rawSession: Session,
  bots: Record<string, Bot<typeof modernArt>>,
): Promise<{ winner: unknown } | null> {
  const errors: string[] = [];
  const { session, isBot, whenIdle, detachAll } = attachLocalBots({
    session: rawSession,
    game: modernArt,
    bots,
    actionDelayMs: 0,
    onError: (e) => {
      errors.push(`${e.error}: ${e.reason ?? "<no reason>"} (action=${e.action.event})`);
    },
  });
  for (let i = 0; i < 4000; i += 1) {
    const snap = session.getState();
    if (snap.meta.result !== null) break;
    const active = snap.derived.activePlayers[0];
    if (active === undefined) break;
    if (isBot(active)) {
      await whenIdle(active);
    } else {
      break;
    }
  }
  const final = session.getState().meta.result;
  detachAll();
  if (errors.length > 0) {
    throw new Error(`bot dispatch errors: ${errors.slice(0, 3).join(" | ")}`);
  }
  return final;
}

describe("modern art bots terminate", () => {
  test("random vs random vs random (3p) completes", async () => {
    const session = createLocalSession(modernArt, {
      match: { players: seats(3) },
      seed: "rrr-1",
    });
    const result = await playToCompletion(session, {
      "0": randomBot,
      "1": randomBot,
      "2": randomBot,
    });
    expect(result).not.toBeNull();
  }, 30_000);

  test("random vs collector vs speculator (3p) completes", async () => {
    const session = createLocalSession(modernArt, {
      match: { players: seats(3) },
      seed: "rcs-1",
    });
    const result = await playToCompletion(session, {
      "0": randomBot,
      "1": collectorBot,
      "2": speculatorBot,
    });
    expect(result).not.toBeNull();
  }, 30_000);

  test("4-player mixed bots complete", async () => {
    const session = createLocalSession(modernArt, {
      match: { players: seats(4) },
      seed: "4p-1",
    });
    const result = await playToCompletion(session, {
      "0": collectorBot,
      "1": randomBot,
      "2": speculatorBot,
      "3": collectorBot,
    });
    expect(result).not.toBeNull();
  }, 30_000);

  test("5-player all-speculator completes", async () => {
    const session = createLocalSession(modernArt, {
      match: { players: seats(5) },
      seed: "5s-1",
    });
    const result = await playToCompletion(session, {
      "0": speculatorBot,
      "1": speculatorBot,
      "2": speculatorBot,
      "3": speculatorBot,
      "4": speculatorBot,
    });
    expect(result).not.toBeNull();
  }, 30_000);

  test("10 random matches all terminate (regression sweep)", async () => {
    for (let i = 0; i < 10; i += 1) {
      const session = createLocalSession(modernArt, {
        match: { players: seats(3) },
        seed: `sweep-${i}`,
      });
      const result = await playToCompletion(session, {
        "0": randomBot,
        "1": collectorBot,
        "2": speculatorBot,
      });
      expect(result).not.toBeNull();
    }
  }, 120_000);
});
