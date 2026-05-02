import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { afterAll, describe, expect, test } from "bun:test";

import {
  OpenturnDeployError,
  buildOpenturnProject,
  discoverOpenturnProject,
  findSizeViolation,
  validateBundleSize,
  validateOpenturnProject,
} from "./index";

import { DEPLOY_LIMITS } from "@openturn/manifest";

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

  test("bundles an imported PNG and records its size in the manifest", async () => {
    const fixture = createFixture("imported-image", {
      "app/game.ts": `
        export const game = { events: {}, setup: () => ({}), playerIDs: ["0", "1"], minPlayers: 2 };
      `,
      "app/openturn.ts": `
        export const metadata = { name: "Imported Image", runtime: "local" };
      `,
      "app/page.tsx": `
        import logo from "./logo.png";

        export default function Page() {
          return <img src={logo} alt="logo" />;
        }
      `,
      "app/logo.png": FAKE_PNG_BYTES,
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
      deploymentID: "dep_imported_image",
      outDir: "dist",
      projectDir: fixture,
      projectID: "fixture",
    });

    const pngAssets = result.manifest.assets.filter((asset) => asset.endsWith(".png"));
    expect(pngAssets.length).toBe(1);
    const pngAsset = pngAssets[0]!;
    // Vite content-hashes imported assets.
    expect(pngAsset).toMatch(/logo-[A-Za-z0-9_-]+\.png$/u);
    expect(result.manifest.assetSizes?.[pngAsset]).toBe(FAKE_PNG_BYTES.byteLength);

    const onDisk = readFileSync(join(result.outDir, pngAsset.replace(/^\.\//u, "")));
    expect(onDisk.byteLength).toBe(FAKE_PNG_BYTES.byteLength);
  });

  test("bundles a public/ image without hashing and records its size", async () => {
    const fixture = createFixture("public-image", {
      "app/game.ts": `
        export const game = { events: {}, setup: () => ({}), playerIDs: ["0", "1"], minPlayers: 2 };
      `,
      "app/openturn.ts": `
        export const metadata = { name: "Public Image", runtime: "local" };
      `,
      "app/page.tsx": `
        export default function Page() {
          return <img src="/banner.png" alt="banner" />;
        }
      `,
      "public/banner.png": FAKE_PNG_BYTES,
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
      deploymentID: "dep_public_image",
      outDir: "dist",
      projectDir: fixture,
      projectID: "fixture",
    });

    // Public-folder files keep their original name (un-hashed) and live at the
    // outDir root, not under `assets/`.
    expect(result.manifest.assets).toContain("./banner.png");
    expect(result.manifest.assetSizes?.["./banner.png"]).toBe(FAKE_PNG_BYTES.byteLength);
    const onDisk = readFileSync(join(result.outDir, "banner.png"));
    expect(onDisk.byteLength).toBe(FAKE_PNG_BYTES.byteLength);
  });
});

describe("validateBundleSize", () => {
  test("returns null when assetSizes is absent", () => {
    expect(
      findSizeViolation({
        manifest: {
          runtime: "local",
          gameName: "x",
          entry: "./entry.js",
          styles: [],
          assets: [],
          build: { at: "now", openturn: {} },
        },
        serverBundle: null,
      }),
    ).toBeNull();
  });

  test("flags a per-asset overage", () => {
    const violation = findSizeViolation({
      manifest: {
        runtime: "local",
        gameName: "x",
        entry: "./entry.js",
        styles: [],
        assets: ["./big.png"],
        assetSizes: { "./big.png": DEPLOY_LIMITS.PER_ASSET_BYTES + 1 },
        build: { at: "now", openturn: {} },
      },
      serverBundle: null,
    });
    expect(violation?.kind).toBe("per_asset");
    expect(violation?.asset).toBe("./big.png");
  });

  test("flags an image-budget overage even when no single asset is too large", () => {
    const halfPlusOne = Math.ceil(DEPLOY_LIMITS.TOTAL_IMAGES_BYTES / 2) + 1;
    const violation = findSizeViolation({
      manifest: {
        runtime: "local",
        gameName: "x",
        entry: "./entry.js",
        styles: [],
        assets: ["./a.png", "./b.png"],
        assetSizes: { "./a.png": halfPlusOne, "./b.png": halfPlusOne },
        build: { at: "now", openturn: {} },
      },
      serverBundle: null,
    });
    expect(violation?.kind).toBe("total_images");
  });

  test("flags an oversized worker bundle by gzipped size", () => {
    const violation = findSizeViolation({
      manifest: {
        runtime: "multiplayer",
        gameName: "x",
        entry: "./entry.js",
        styles: [],
        assets: [],
        build: { at: "now", openturn: {} },
      },
      serverBundle: {
        path: "/tmp/server.js",
        digest: "deadbeef",
        size: 0,
        gzippedSize: DEPLOY_LIMITS.WORKER_GZIPPED_BYTES + 1,
        metadataPath: "/tmp/server.metadata.json",
        metadata: {
          main_module: "server.js",
          compatibility_date: "2026-04-17",
          bindings: [],
          migrations: { new_sqlite_classes: [] },
        },
      },
    });
    expect(violation?.kind).toBe("worker_gzipped");
  });

  test("validateBundleSize throws OpenturnDeployError on violation", () => {
    expect(() =>
      validateBundleSize({
        manifest: {
          runtime: "local",
          gameName: "x",
          entry: "./entry.js",
          styles: [],
          assets: ["./big.png"],
          assetSizes: { "./big.png": DEPLOY_LIMITS.PER_ASSET_BYTES + 1 },
          build: { at: "now", openturn: {} },
        },
        serverBundle: null,
      }),
    ).toThrow(OpenturnDeployError);
  });
});

function createFixture(
  name: string,
  files: Record<string, string | Uint8Array>,
): string {
  const root = join(import.meta.dir, "..", ".test-fixtures", `${name}-${crypto.randomUUID()}`);
  fixtureRoots.push(root);

  for (const [path, content] of Object.entries(files)) {
    const absolutePath = join(root, path);
    mkdirSync(dirname(absolutePath), { recursive: true });
    if (typeof content === "string") {
      writeFileSync(absolutePath, content.trimStart());
    } else {
      writeFileSync(absolutePath, content);
    }
  }

  return root;
}

// Synthetic binary fixture that begins with the PNG magic bytes, padded to
// 5 KiB so it exceeds Vite's default `assetsInlineLimit` (4 KiB) — otherwise
// the imported image is inlined as a data URL and we never see it in the
// manifest's emitted assets. The bytes don't need to form a valid image; Vite
// recognizes assets by extension, and the deploy pipeline only hashes/copies.
const FAKE_PNG_BYTES = (() => {
  const bytes = new Uint8Array(5 * 1024);
  // PNG magic
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  return bytes;
})();

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
