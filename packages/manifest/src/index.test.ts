import { describe, expect, test } from "bun:test";

import {
  OpenturnAvailableBotSchema,
  OpenturnDeploymentManifestSchema,
  OpenturnMultiplayerManifestSchema,
  OpenturnShellControlsConfigSchema,
  parseDeploymentManifest,
  SHELL_CONTROL_IDS,
} from "./index";

const baseMultiplayerManifest = {
  gameKey: "test-game",
  deploymentVersion: "abc123",
  schemaVersion: "1",
  players: ["0", "1"],
  minPlayers: 2,
  maxPlayers: 2,
  serverBundleDigest: "deadbeef",
};

describe("OpenturnAvailableBotSchema", () => {
  test("accepts the minimal { botID, label } shape", () => {
    expect(() =>
      OpenturnAvailableBotSchema.parse({ botID: "random", label: "Random" }),
    ).not.toThrow();
  });

  test("accepts description + difficulty", () => {
    const result = OpenturnAvailableBotSchema.parse({
      botID: "minimax-hard",
      label: "Minimax · hard",
      description: "Optimal play",
      difficulty: "hard",
    });
    expect(result.difficulty).toBe("hard");
  });

  test("rejects invalid difficulty", () => {
    expect(() =>
      OpenturnAvailableBotSchema.parse({
        botID: "x",
        label: "X",
        difficulty: "impossible",
      }),
    ).toThrow();
  });

  test("rejects empty botID", () => {
    expect(() => OpenturnAvailableBotSchema.parse({ botID: "", label: "X" })).toThrow();
  });
});

describe("OpenturnMultiplayerManifestSchema with availableBots", () => {
  test("accepts a manifest without availableBots (back-compat)", () => {
    expect(() =>
      OpenturnMultiplayerManifestSchema.parse(baseMultiplayerManifest),
    ).not.toThrow();
  });

  test("accepts a manifest with availableBots", () => {
    const result = OpenturnMultiplayerManifestSchema.parse({
      ...baseMultiplayerManifest,
      availableBots: [
        { botID: "random", label: "Random", difficulty: "easy" },
        { botID: "minimax", label: "Minimax", difficulty: "hard" },
      ],
    });
    expect(result.availableBots).toHaveLength(2);
  });

  test("rejects more than 32 bot entries", () => {
    expect(() =>
      OpenturnMultiplayerManifestSchema.parse({
        ...baseMultiplayerManifest,
        availableBots: Array.from({ length: 33 }, (_, i) => ({
          botID: `b${i}`,
          label: `Bot ${i}`,
        })),
      }),
    ).toThrow();
  });
});

describe("parseDeploymentManifest round-trips availableBots", () => {
  const baseManifest = {
    runtime: "multiplayer" as const,
    gameName: "Test Game",
    entry: "main.js",
    styles: [],
    assets: ["main.js"],
    build: { at: "2025-01-01T00:00:00Z", openturn: { core: "0.0.1" } },
    multiplayer: {
      ...baseMultiplayerManifest,
      availableBots: [
        { botID: "random", label: "Random" },
        { botID: "minimax", label: "Minimax", description: "Optimal", difficulty: "hard" as const },
      ],
    },
  };

  test("preserves the bot catalog through parse + serialize", () => {
    const parsed = parseDeploymentManifest(baseManifest);
    expect(parsed.multiplayer?.availableBots).toEqual([
      { botID: "random", label: "Random" },
      { botID: "minimax", label: "Minimax", description: "Optimal", difficulty: "hard" },
    ]);
  });

  test("manifest without availableBots stays absent (no empty array injected)", () => {
    const { availableBots: _, ...mp } = baseManifest.multiplayer;
    const parsed = parseDeploymentManifest({ ...baseManifest, multiplayer: mp });
    expect(parsed.multiplayer?.availableBots).toBeUndefined();
  });

  test("schema-level full manifest accepts availableBots", () => {
    expect(() => OpenturnDeploymentManifestSchema.parse(baseManifest)).not.toThrow();
  });
});

describe("OpenturnShellControlsConfigSchema", () => {
  test("accepts an empty config", () => {
    expect(() => OpenturnShellControlsConfigSchema.parse({})).not.toThrow();
  });

  test("accepts every known control id with boolean values", () => {
    const config = Object.fromEntries(
      SHELL_CONTROL_IDS.map((id, i) => [id, i % 2 === 0]),
    );
    const parsed = OpenturnShellControlsConfigSchema.parse(config);
    for (const id of SHELL_CONTROL_IDS) {
      expect(parsed[id]).toBe(config[id]);
    }
  });

  test("rejects unknown control ids (strict mode)", () => {
    expect(() =>
      OpenturnShellControlsConfigSchema.parse({ notAControl: true }),
    ).toThrow();
  });

  test("rejects non-boolean values", () => {
    expect(() =>
      OpenturnShellControlsConfigSchema.parse({ save: "yes" }),
    ).toThrow();
  });
});

describe("parseDeploymentManifest normalizes shellControls", () => {
  const baseManifest = {
    runtime: "local" as const,
    gameName: "Test Game",
    entry: "main.js",
    styles: [],
    assets: ["main.js"],
    build: { at: "2025-01-01T00:00:00Z", openturn: { core: "0.0.1" } },
  };

  test("manifest without shellControls stays absent", () => {
    const parsed = parseDeploymentManifest(baseManifest);
    expect(parsed.shellControls).toBeUndefined();
  });

  test("manifest with shellControls round-trips set keys only", () => {
    const parsed = parseDeploymentManifest({
      ...baseManifest,
      shellControls: { save: false, copyInvite: true },
    });
    expect(parsed.shellControls).toEqual({ save: false, copyInvite: true });
  });

  test("undefined values are dropped from the parsed config", () => {
    const parsed = parseDeploymentManifest({
      ...baseManifest,
      shellControls: { save: false, load: undefined },
    });
    expect(parsed.shellControls).toEqual({ save: false });
    expect("load" in (parsed.shellControls ?? {})).toBe(false);
  });
});
