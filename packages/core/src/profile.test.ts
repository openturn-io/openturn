import { describe, expect, test } from "bun:test";

import {
  applyProfileDelta,
  computeProfileCommit,
  createLocalSession,
  defineGame,
  defineProfile,
  profile,
  restrictDeltaMapToPlayers,
  validateProfileDelta,
  type ProfileDelta,
} from "./index";

describe("profile delta grammar", () => {
  test("set replaces the root when path is empty", () => {
    const result = applyProfileDelta({ a: 1 }, [
      { op: "set", path: [], value: { b: 2 } },
    ]);
    expect(result).toEqual({ ok: true, data: { b: 2 } });
  });

  test("set, inc, push, remove compose", () => {
    const delta: ProfileDelta = [
      { op: "set", path: ["meta", "name"], value: "alice" },
      { op: "inc", path: ["gold"], value: 5 },
      { op: "push", path: ["cards"], value: { id: "dragon" } },
      { op: "remove", path: ["cards", 0] },
    ];
    const result = applyProfileDelta(
      { meta: { name: null }, gold: 10, cards: [{ id: "slime" }] },
      delta,
    );
    expect(result).toEqual({
      ok: true,
      data: { meta: { name: "alice" }, gold: 15, cards: [{ id: "dragon" }] },
    });
  });

  test("inc rejects type mismatch and reports the offending index", () => {
    const result = applyProfileDelta({ gold: "ten" as unknown as number }, [
      { op: "inc", path: ["gold"], value: 1 },
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("type_mismatch");
    expect(result.at).toBe(0);
  });

  test("inc on missing field treats target as 0", () => {
    const result = applyProfileDelta({ gold: 0 } as { gold: number }, [
      { op: "inc", path: ["gold"], value: 3 },
    ]);
    expect(result).toEqual({ ok: true, data: { gold: 3 } });
  });

  test("push on non-array rejects", () => {
    const result = applyProfileDelta({ cards: null as unknown as [] }, [
      { op: "push", path: ["cards"], value: "x" },
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("type_mismatch");
  });

  test("remove on array index out of range rejects", () => {
    const result = applyProfileDelta({ items: [] as number[] }, [
      { op: "remove", path: ["items", 0] },
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("out_of_range");
  });

  test("validateProfileDelta rejects unknown ops", () => {
    expect(validateProfileDelta([{ op: "nuke", path: [] }])).toBe(false);
    expect(validateProfileDelta([{ op: "inc", path: ["x"], value: "1" }])).toBe(false);
    expect(validateProfileDelta([{ op: "set", path: ["x"], value: 1 }])).toBe(true);
  });

  test("applyProfileDelta does not mutate the input", () => {
    const original = { gold: 1 };
    applyProfileDelta(original, [{ op: "inc", path: ["gold"], value: 5 }]);
    expect(original).toEqual({ gold: 1 });
  });
});

describe("restrictDeltaMapToPlayers", () => {
  test("drops keys that are not seated", () => {
    const match = { players: ["alice", "bob"] as const };
    const restricted = restrictDeltaMapToPlayers(match, {
      alice: [{ op: "inc", path: ["gold"], value: 5 }],
      mallory: [{ op: "inc", path: ["gold"], value: 999 }],
    } as Parameters<typeof restrictDeltaMapToPlayers<typeof match.players>>[1]);
    expect(Object.keys(restricted).sort()).toEqual(["alice"]);
  });
});

describe("defineProfile + setup hydration", () => {
  const profile = defineProfile<{ gold: number }>({
    schemaVersion: "1",
    default: { gold: 0 },
  });

  const game = defineGame({
    playerIDs: ["p1", "p2"] as const,
    events: { noop: undefined },
    initial: "idle",
    profile,
    setup: ({ match }) => ({
      goldByPlayer: Object.fromEntries(
        match.players.map((p) => [p, (match.profiles?.[p] as { gold: number }).gold]),
      ),
    }),
    states: {
      idle: {
        activePlayers: ({ match }) => [match.players[0]],
      },
    },
    transitions: [],
  });

  test("fills default profile when none provided", () => {
    const session = createLocalSession(game, {
      match: { players: ["p1", "p2"] },
    });
    expect(session.getState().G).toEqual({ goldByPlayer: { p1: 0, p2: 0 } });
  });

  test("passes supplied profiles through to setup", () => {
    const session = createLocalSession(game, {
      match: {
        players: ["p1", "p2"],
        profiles: { p1: { gold: 10 }, p2: { gold: 20 } },
      },
    });
    expect(session.getState().G).toEqual({ goldByPlayer: { p1: 10, p2: 20 } });
  });

  test("parse() runs on every player's profile", () => {
    const strictGame = defineGame({
      playerIDs: ["p1"] as const,
      events: { noop: undefined },
      initial: "idle",
      profile: defineProfile<{ gold: number }>({
        schemaVersion: "1",
        default: { gold: 0 },
        parse: (data) => {
          const obj = data as { gold?: unknown };
          if (typeof obj?.gold !== "number") throw new Error("invalid profile");
          return { gold: obj.gold };
        },
      }),
      setup: () => ({}),
      states: { idle: { activePlayers: () => [] } },
      transitions: [],
    });

    expect(() =>
      createLocalSession(strictGame, {
        match: {
          players: ["p1"],
          profiles: { p1: { gold: "nope" as unknown as number } },
        },
      }),
    ).toThrow(/invalid profile/);
  });
});

describe("mid-match profile deltas", () => {
  const game = defineGame({
    playerIDs: ["p1", "p2"] as const,
    events: { discover: undefined, bogus: undefined },
    initial: "play",
    profile: defineProfile<{ seen: readonly string[] }>({
      schemaVersion: "1",
      default: { seen: [] },
    }),
    setup: () => ({}),
    states: {
      play: {
        activePlayers: ({ match }) => [...match.players],
      },
    },
    transitions: [
      {
        event: "discover",
        from: "play",
        resolve: ({ playerID }) => ({
          profile: { [playerID!]: [{ op: "push" as const, path: ["seen"], value: "dragon" }] },
        }),
        to: "play",
      },
      {
        event: "bogus",
        from: "play",
        resolve: ({ playerID }) => ({
          profile: { [playerID!]: [{ op: "inc" as const, path: ["seen"], value: 1 }] },
        }),
        to: "play",
      },
    ],
  });

  test("applies per-transition profile delta to match.profiles", () => {
    const session = createLocalSession(game, {
      match: { players: ["p1", "p2"] as const },
    });
    const before = session.getState().meta.match.profiles;
    expect(before).toEqual({ p1: { seen: [] }, p2: { seen: [] } });

    const result = session.applyEvent("p1", "discover");
    expect(result.ok).toBe(true);

    const after = session.getState().meta.match.profiles;
    expect(after).toEqual({ p1: { seen: ["dragon"] }, p2: { seen: [] } });
  });

  test("embeds the applied delta in the observed transition", () => {
    const session = createLocalSession(game, {
      match: { players: ["p1", "p2"] as const },
    });
    const result = session.applyEvent("p1", "discover");
    if (!result.ok) throw new Error("expected ok");
    expect(result.batch.steps[0]!.transition.profile).toEqual({
      p1: [{ op: "push", path: ["seen"], value: "dragon" }],
    });
  });

  test("rejects the transition if the delta fails to apply (type_mismatch)", () => {
    const session = createLocalSession(game, {
      match: { players: ["p1", "p2"] as const },
    });
    const result = session.applyEvent("p1", "bogus");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("invalid_transition_result");

    // Profile state is unchanged on rejection.
    expect(session.getState().meta.match.profiles).toEqual({
      p1: { seen: [] },
      p2: { seen: [] },
    });
  });
});

describe("computeProfileCommit", () => {
  test("returns empty map for games without a profile.commit", () => {
    const config = defineProfile<{ gold: number }>({
      schemaVersion: "1",
      default: { gold: 0 },
    });
    const delta = computeProfileCommit(config, {
      match: { players: ["p1", "p2"] },
      profile: profile.bind({ p1: { gold: 0 }, p2: { gold: 0 } }),
      profiles: { p1: { gold: 0 }, p2: { gold: 0 } },
      result: null,
    });
    expect(delta).toEqual({});
  });

  test("restricts commit output to seated players", () => {
    const config = defineProfile<{ gold: number }, readonly ["p1", "p2"]>({
      schemaVersion: "1",
      default: { gold: 0 },
      commit: () => ({
        p1: [{ op: "inc", path: ["gold"], value: 5 }],
        // @ts-expect-error - not seated
        mallory: [{ op: "inc", path: ["gold"], value: 999 }],
      }),
    });
    const result = computeProfileCommit(config, {
      match: { players: ["p1", "p2"] as const },
      profile: profile.bind({ p1: { gold: 0 }, p2: { gold: 0 } }),
      profiles: { p1: { gold: 0 }, p2: { gold: 0 } },
      result: null,
    });
    expect(Object.keys(result).sort()).toEqual(["p1"]);
  });
});
