import { describe, expect, test } from "bun:test";

import {
  createPersistentWinsSession,
  persistentWinsProfile,
  settlePersistentWinsMatch,
  type PersistentWinsProfile,
} from "./index";

describe("persistent-wins example", () => {
  test("hydrates default profile when none supplied", () => {
    const session = createPersistentWinsSession();
    expect(session.getState().meta.match.profiles).toEqual({
      "0": { wins: 0 },
      "1": { wins: 0 },
    });
  });

  test("parse normalizes malformed stored data", () => {
    const session = createPersistentWinsSession({
      "0": { wins: "nope" as unknown as number },
      "1": { wins: 7 },
    });
    expect(session.getState().meta.match.profiles).toEqual({
      "0": { wins: 0 },
      "1": { wins: 7 },
    });
  });

  test("full hydrate → play → settle loop increments the winner's profile", () => {
    const stored: Record<string, PersistentWinsProfile> = {
      "0": { wins: 2 },
      "1": { wins: 5 },
    };
    const session = createPersistentWinsSession(stored);
    const tap = session.applyEvent("0", "tap", null);
    expect(tap.ok).toBe(true);
    expect(session.getResult()).toBe("0");

    const outcome = settlePersistentWinsMatch(session, stored);
    expect(outcome.profilesAfter).toEqual({ "0": { wins: 3 }, "1": { wins: 5 } });
    expect(outcome.commitDelta).toEqual({
      "0": [{ op: "inc", path: ["wins"], value: 1 }],
    });
    expect(outcome.rejections).toEqual([]);
    // Original map untouched (the helper is pure).
    expect(stored).toEqual({ "0": { wins: 2 }, "1": { wins: 5 } });
  });

  test("commit returns empty map before the match ends", () => {
    const session = createPersistentWinsSession({ "0": { wins: 0 }, "1": { wins: 0 } });
    expect(
      Object.keys(
        persistentWinsProfile.commit?.({
          match: session.getState().meta.match as never,
          profiles: session.getState().meta.match.profiles as never,
          result: null,
        }) ?? {},
      ),
    ).toEqual([]);
  });
});
