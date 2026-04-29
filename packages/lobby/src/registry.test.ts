import type { AnyGame, BotRegistryShape } from "@openturn/core";
import { describe, expect, test } from "vitest";
import { defineBot } from "@openturn/bot";

import { attachBots, buildKnownBots, defineBotRegistry, findBot } from "./registry";

const dummyBot = defineBot({
  name: "dummy",
  decide: ({ legalActions }) => legalActions[0]!,
});

describe("defineBotRegistry()", () => {
  test("returns a registry with the provided entries", () => {
    const registry = defineBotRegistry([
      { botID: "a", label: "A", bot: dummyBot },
      { botID: "b", label: "B", bot: dummyBot, difficulty: "hard" },
    ]);
    expect(registry.entries).toHaveLength(2);
    expect(registry.entries[0]!.botID).toBe("a");
    expect(registry.entries[1]!.difficulty).toBe("hard");
  });

  test("rejects duplicate botIDs", () => {
    expect(() =>
      defineBotRegistry([
        { botID: "a", label: "A", bot: dummyBot },
        { botID: "a", label: "Duplicate", bot: dummyBot },
      ]),
    ).toThrow(/duplicate botID "a"/);
  });

  test("rejects empty botID", () => {
    expect(() =>
      defineBotRegistry([{ botID: "", label: "Anon", bot: dummyBot }]),
    ).toThrow(/non-empty/);
  });
});

describe("findBot()", () => {
  const registry = defineBotRegistry([
    { botID: "random", label: "Random", bot: dummyBot },
    { botID: "minimax", label: "Minimax", bot: dummyBot, difficulty: "hard" },
  ]);

  test("returns the matching descriptor", () => {
    const found = findBot(registry, "minimax");
    expect(found).not.toBeNull();
    expect(found!.label).toBe("Minimax");
  });

  test("returns null when missing", () => {
    expect(findBot(registry, "nope")).toBeNull();
  });

  test("returns null when registry is undefined", () => {
    expect(findBot(undefined, "random")).toBeNull();
  });
});

describe("attachBots()", () => {
  test("returns a copy of the game with `bots` set", () => {
    const game = {
      events: {},
      initial: "x",
      setup: () => ({}),
      states: {},
      transitions: [],
    } as unknown as AnyGame;
    const registry = defineBotRegistry([{ botID: "x", label: "X", bot: dummyBot }]);
    const wrapped = attachBots(game, registry);
    expect(wrapped).not.toBe(game);
    expect((wrapped as AnyGame & { bots?: BotRegistryShape }).bots).toBe(registry);
    expect((game as AnyGame & { bots?: BotRegistryShape }).bots).toBeUndefined();
  });
});

describe("buildKnownBots()", () => {
  test("flattens a registry into a knownBots map for LobbyEnv", () => {
    const registry = defineBotRegistry([
      { botID: "a", label: "A", bot: dummyBot },
      { botID: "b", label: "B", description: "B desc", difficulty: "expert", bot: dummyBot },
    ]);
    const map = buildKnownBots(registry);
    expect(map.size).toBe(2);
    expect(map.get("a")).toEqual({ label: "A" });
    expect(map.get("b")).toEqual({ label: "B", description: "B desc", difficulty: "expert" });
  });

  test("returns an empty map for undefined registry", () => {
    expect(buildKnownBots(undefined).size).toBe(0);
  });
});
