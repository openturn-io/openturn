import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { afterAll, describe, expect, test } from "bun:test";

import {
  OpenturnDeployError,
  buildOpenturnProject,
  discoverOpenturnProject,
  validateOpenturnProject,
} from "./index";

const fixtureRoots: string[] = [];

afterAll(() => {
  if (process.env.OPENTURN_KEEP_FIXTURES === "1") {
    return;
  }

  for (const fixtureRoot of fixtureRoots.splice(0)) {
    rmSync(fixtureRoot, { force: true, recursive: true });
  }
});

describe.serial("@openturn/deploy", () => {
  test("discovers and builds a minimal local project", async () => {
    const fixture = createFixture("minimal", {
      "app/game.ts": `
        export const game = { events: {}, setup: () => ({}), playerIDs: ["0", "1"], minPlayers: 2 };
      `,
      "app/openturn.ts": `
        export const metadata = { name: "Fixture Game", runtime: "local" };
      `,
      "app/page.tsx": `
        import "./styles.css";

        export default function Page() {
          return <button className="fixture-card">Play</button>;
        }
      `,
      "app/styles.css": `
        @import "tailwindcss";

        .fixture-card {
          @apply rounded-lg bg-slate-900 px-4 py-2 text-white;
        }
      `,
      "package.json": JSON.stringify({
        dependencies: {
          "@openturn/core": "workspace:*",
          "@openturn/react": "workspace:*",
          react: "^19.2.0",
          "react-dom": "^19.2.0",
        },
      }),
    });
    linkWorkspacePackage(fixture, "@openturn/react", "packages/react");
    linkExampleAppPackage(fixture, "react");
    linkExampleAppPackage(fixture, "react-dom");
    const result = await buildOpenturnProject({
      deploymentID: "dep_fixture",
      outDir: "dist",
      projectDir: fixture,
      projectID: "fixture",
    });

    expect(result.manifest.deploymentID).toBe("dep_fixture");
    expect(result.manifest.gameName).toBe("Fixture Game");
    expect(result.manifest.runtime).toBe("local");
    expect(result.manifest.entry.endsWith(".js")).toBe(true);
    expect(result.manifest.assets.some((asset) => asset.endsWith(".js"))).toBe(true);
    expect(result.manifest.styles.some((asset) => asset.endsWith(".css"))).toBe(true);

    const cssAsset = result.manifest.styles[0];
    expect(cssAsset).toBeDefined();
    const cssText = readFileSync(join(result.outDir, cssAsset!.replace(/^\.\//u, "")), "utf8");
    expect(cssText).toContain("fixture-card");

    const jsAsset = result.manifest.entry.replace(/^\.\//u, "");
    const jsText = readFileSync(join(result.outDir, jsAsset), "utf8");
    expect(jsText).toContain("createOpenturnBindings");
    expect(jsText).toContain("createLocalMatch");
    expect(jsText).not.toContain("openturn.dev.inspector.enabled");
  });

  test("builds multiplayer server metadata without client-side secrets", async () => {
    const fixture = createFixture("multiplayer", {
      "app/game.ts": `
        export const game = { events: {}, setup: () => ({}), playerIDs: ["0", "1"], minPlayers: 2 };
      `,
      "app/openturn.ts": `
        export const metadata = {
          name: "Multiplayer Fixture",
          runtime: "multiplayer",
          multiplayer: {
            gameKey: "fixture-game",
            schemaVersion: "1",
          },
        };
      `,
      "app/page.tsx": `
        export default function Page() {
          return <button>Play</button>;
        }
      `,
      "package.json": JSON.stringify({
        dependencies: {
          "@openturn/core": "workspace:*",
          "@openturn/json": "workspace:*",
          "@openturn/protocol": "workspace:*",
          "@openturn/react": "workspace:*",
          "@openturn/server": "workspace:*",
          react: "^19.2.0",
          "react-dom": "^19.2.0",
        },
      }),
    });
    linkWorkspacePackage(fixture, "@openturn/core", "packages/core");
    linkWorkspacePackage(fixture, "@openturn/json", "packages/json");
    linkWorkspacePackage(fixture, "@openturn/protocol", "packages/protocol");
    linkWorkspacePackage(fixture, "@openturn/react", "packages/react");
    linkWorkspacePackage(fixture, "@openturn/server", "packages/server");
    linkExampleAppPackage(fixture, "react");
    linkExampleAppPackage(fixture, "react-dom");

    const result = await buildOpenturnProject({
      deploymentID: "dep_multiplayer_fixture",
      outDir: "dist",
      projectDir: fixture,
      projectID: "fixture",
    });

    expect(result.manifest.runtime).toBe("multiplayer");
    expect(result.serverBundle).not.toBeNull();
    expect(result.manifest.multiplayer?.gameKey).toBe("fixture-game");
    expect(result.manifest.multiplayer?.schemaVersion).toBe("1");
    expect(result.manifest.multiplayer?.players).toEqual(["0", "1"]);
    expect(result.manifest.multiplayer?.serverBundleDigest).toBe(result.serverBundle?.digest);
    expect(result.manifest.multiplayer?.deploymentVersion).toBe(result.serverBundle?.digest);
    expect(result.serverBundle?.metadata.bindings).toEqual([
      {
        type: "durable_object_namespace",
        name: "GAME_ROOM",
        class_name: "GameRoom",
      },
    ]);

    const serverBundleText = readFileSync(result.serverBundle!.path, "utf8");
    expect(serverBundleText).toContain('playerIDs: ["0", "1"]');
    expect(serverBundleText).not.toContain('gameKey: "fixture-game",\n  match:');

    const metadataText = readFileSync(result.serverBundle!.metadataPath, "utf8");
    expect(metadataText).not.toContain("ROOM_TOKEN_SECRET");
    expect(metadataText).not.toContain("secret_text");
    expect(metadataText).not.toContain("nodejs_compat");
  });

  test("uses optional multiplayer metadata overrides", async () => {
    const fixture = createFixture("multiplayer-overrides", {
      "app/game.ts": `
        export const game = { events: {}, setup: () => ({}), playerIDs: ["a", "b"], minPlayers: 2 };
      `,
      "app/openturn.ts": `
        export const metadata = {
          name: "Override Fixture",
          multiplayer: {
            deploymentVersion: "v-test",
            gameKey: "override-game",
            players: ["red", "blue"],
            schemaVersion: "2",
          },
        };
      `,
      "app/page.tsx": `
        export default function Page() {
          return <button>Play</button>;
        }
      `,
      "package.json": JSON.stringify({
        dependencies: {
          "@openturn/core": "workspace:*",
          "@openturn/json": "workspace:*",
          "@openturn/protocol": "workspace:*",
          "@openturn/react": "workspace:*",
          "@openturn/server": "workspace:*",
          react: "^19.2.0",
          "react-dom": "^19.2.0",
        },
      }),
    });
    linkWorkspacePackage(fixture, "@openturn/core", "packages/core");
    linkWorkspacePackage(fixture, "@openturn/json", "packages/json");
    linkWorkspacePackage(fixture, "@openturn/protocol", "packages/protocol");
    linkWorkspacePackage(fixture, "@openturn/react", "packages/react");
    linkWorkspacePackage(fixture, "@openturn/server", "packages/server");
    linkExampleAppPackage(fixture, "react");
    linkExampleAppPackage(fixture, "react-dom");

    const result = await buildOpenturnProject({
      deploymentID: "dep_multiplayer_override_fixture",
      outDir: "dist",
      projectDir: fixture,
      projectID: "fixture",
    });

    expect(result.manifest.runtime).toBe("multiplayer");
    expect(result.manifest.gameName).toBe("Override Fixture");
    expect(result.manifest.multiplayer).toMatchObject({
      deploymentVersion: "v-test",
      gameKey: "override-game",
      players: ["red", "blue"],
      schemaVersion: "2",
    });
  });

  test("fails when app/game.ts is missing", () => {
    const fixture = createFixture("missing-game", {
      "app/page.tsx": "export default function Page() { return null; }",
    });

    expect(() => discoverOpenturnProject(fixture)).toThrow(OpenturnDeployError);
  });

  test("fails when app/page.tsx is missing", () => {
    const fixture = createFixture("missing-page", {
      "app/game.ts": "export const game = { playerIDs: ['0'], minPlayers: 1 };",
    });

    expect(() => discoverOpenturnProject(fixture)).toThrow(OpenturnDeployError);
  });

  test("fails when app/game.ts does not export game", async () => {
    const fixture = createFixture("invalid-game", {
      "app/game.ts": "export const other = {};",
      "app/page.tsx": "export default function Page() { return null; }",
    });

    const paths = discoverOpenturnProject(fixture);

    await expect(validateOpenturnProject(paths)).rejects.toThrow("app/game.ts must export \"game\"");
  });

  test("fails when app/page.tsx has no default export", async () => {
    const fixture = createFixture("invalid-page", {
      "app/game.ts": "export const game = { playerIDs: ['0'], minPlayers: 1 };",
      "app/page.tsx": "export function Page() { return null; }",
    });

    const paths = discoverOpenturnProject(fixture);

    await expect(validateOpenturnProject(paths)).rejects.toThrow("app/page.tsx must export a default React component");
  });
});

function createFixture(name: string, files: Record<string, string>): string {
  const root = join(import.meta.dir, "..", ".test-fixtures", `${name}-${crypto.randomUUID()}`);
  fixtureRoots.push(root);

  for (const [path, content] of Object.entries(files)) {
    const absolutePath = join(root, path);
    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, content.trimStart());
  }

  return root;
}

function dirname(path: string): string {
  return path.slice(0, path.lastIndexOf("/"));
}

function linkWorkspacePackage(fixture: string, packageName: string, workspacePath: string): void {
  const scopedDirectory = join(fixture, "node_modules", packageName.slice(0, packageName.lastIndexOf("/")));
  mkdirSync(scopedDirectory, { recursive: true });
  symlinkSync(
    resolve(import.meta.dir, "..", "..", "..", workspacePath),
    join(fixture, "node_modules", packageName),
    "dir",
  );
}

function linkExampleAppPackage(fixture: string, packageName: string): void {
  const scopeIndex = packageName.lastIndexOf("/");
  const installDirectory = scopeIndex === -1
    ? join(fixture, "node_modules")
    : join(fixture, "node_modules", packageName.slice(0, scopeIndex));
  mkdirSync(installDirectory, { recursive: true });
  symlinkSync(
    resolve(import.meta.dir, "..", "..", "..", "examples", "tic-tac-toe", "app", "node_modules", packageName),
    join(fixture, "node_modules", packageName),
    "dir",
  );
}
