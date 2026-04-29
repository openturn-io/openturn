import { describe, expect, test } from "bun:test";

import { createLocalSession } from "@openturn/core";

import {
  applyCommitLocally,
  persistentWinsGame,
  type PersistentWinsProfile,
} from "./index";

const persistentWinsMatch = { players: persistentWinsGame.playerIDs };

describe("persistent-wins (gamekit)", () => {
  test("auto-hydrates default profile when none supplied", () => {
    const session = createLocalSession(persistentWinsGame, { match: persistentWinsMatch });
    expect(session.getState().meta.match.profiles).toEqual({
      "0": { wins: 0 },
      "1": { wins: 0 },
    });
  });

  test("parse normalizes malformed stored profile data", () => {
    const session = createLocalSession(persistentWinsGame, {
      match: {
        players: persistentWinsMatch.players,
        profiles: {
          "0": { wins: "nope" as unknown as number },
          "1": { wins: 4 },
        },
      },
    });
    expect(session.getState().meta.match.profiles).toEqual({
      "0": { wins: 0 },
      "1": { wins: 4 },
    });
  });

  test("first tap wins, commit rewards that player", () => {
    const stored: Record<string, PersistentWinsProfile> = {
      "0": { wins: 1 },
      "1": { wins: 9 },
    };
    const session = createLocalSession(persistentWinsGame, {
      match: { players: persistentWinsMatch.players, profiles: stored },
    });

    const tap = session.applyEvent("1", "tap", null);
    expect(tap.ok).toBe(true);

    const result = session.getResult();
    expect(result).toMatchObject({ winner: "1" });

    const outcome = applyCommitLocally(stored, result as { winner?: "0" | "1" } | null);
    expect(outcome.profilesAfter).toEqual({ "0": { wins: 1 }, "1": { wins: 10 } });
    expect(outcome.commitDelta).toEqual({
      "1": [{ op: "inc", path: ["wins"], value: 1 }],
    });
    expect(outcome.rejections).toEqual([]);
    // Caller's original map is untouched (commit is pure).
    expect(stored).toEqual({ "0": { wins: 1 }, "1": { wins: 9 } });
  });
});
