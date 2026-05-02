import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { readdir } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { build as viteBuild } from "vite";

import {
  createDeploymentHTML as createDeploymentHTMLFromManifest,
  DEPLOY_LIMITS,
  describeLimitViolation,
  isImageAsset,
  type DeployLimitViolation,
  type OpenturnDeploymentManifest,
  type OpenturnDeploymentRuntime,
  type OpenturnInspectorPolicy,
  type OpenturnMultiplayerManifest,
  type OpenturnShellControlsConfig,
} from "@openturn/manifest";

export type {
  OpenturnDeploymentManifest,
  OpenturnDeploymentRuntime,
  OpenturnInspectorPolicy,
  OpenturnMultiplayerManifest,
  OpenturnShellControlsConfig,
} from "@openturn/manifest";

export interface OpenturnProjectPaths {
  game: string;
  metadata: string | null;
  page: string;
  projectDir: string;
}

export interface OpenturnDeploymentMetadata {
  name?: string;
  // URL-safe project handle. Forms the `{slug}` segment in `/games/{owner}/{slug}`
  // PDP URLs. Optional; the CLI falls back to the project directory name.
  slug?: string;
  runtime?: OpenturnDeploymentRuntime;
  multiplayer?: {
    gameKey?: string;
    deploymentVersion?: string;
    schemaVersion?: string;
    /**
     * Optional override of the maximal player roster. When omitted, derived
     * from `match.players` in `app/game.ts`. `players.length` is also the
     * declared `maxPlayers` for the lobby.
     */
    players?: readonly string[];
    /**
     * Lower bound for `lobby:start`. Defaults to `players.length` (game
     * requires every seat filled). Set lower to declare a variable-player
     * range, e.g. `minPlayers: 2` with `players.length === 4` declares a
     * 2–4 player game.
     */
    minPlayers?: number;
  };
  inspector?: OpenturnInspectorPolicy;
  [key: string]: unknown;
}

export interface BuildOpenturnProjectOptions {
  deploymentID?: string;
  outDir?: string;
  projectDir?: string;
  projectID?: string;
}

export interface BuildOpenturnProjectServerBundle {
  path: string;
  digest: string;
  size: number;
  // Cloudflare measures the worker script size *after* gzip when applying
  // the platform script-size limit, so the deploy validator compares this
  // against `DEPLOY_LIMITS.WORKER_GZIPPED_BYTES` (the Free-tier ceiling).
  gzippedSize: number;
  metadataPath: string;
  metadata: OpenturnWorkerScriptMetadata;
}

export interface OpenturnWorkerScriptBinding {
  type: "durable_object_namespace" | "plain_text";
  name: string;
  class_name?: string;
  text?: string;
}

export interface OpenturnWorkerScriptMetadata {
  main_module: string;
  compatibility_date: string;
  compatibility_flags?: readonly string[];
  bindings: readonly OpenturnWorkerScriptBinding[];
  migrations: {
    new_sqlite_classes: readonly string[];
  };
}

export interface BuildOpenturnProjectResult {
  manifest: OpenturnDeploymentManifest;
  metadata: OpenturnDeploymentMetadata;
  outDir: string;
  paths: OpenturnProjectPaths;
  serverBundle: BuildOpenturnProjectServerBundle | null;
}

export class OpenturnDeployError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "OpenturnDeployError";
  }
}

/**
 * Enforce the shared `DEPLOY_LIMITS` against a built deployment. Called by
 * `cloudDeploy` *before* requesting presigned upload URLs so we never start a
 * deploy we can't finish — and never leave dangling pending records on the
 * cloud side.
 *
 * Local `openturn dev` deliberately does not call this: the limits only apply
 * to cloud deploys (the worker-script ceiling is a Cloudflare constraint, the
 * asset budget is about R2/iframe load time).
 */
export function validateBundleSize(input: {
  manifest: OpenturnDeploymentManifest;
  serverBundle: BuildOpenturnProjectServerBundle | null;
}): void {
  const violation = findSizeViolation(input);
  if (violation === null) return;
  throw new OpenturnDeployError(
    `bundle_too_large_${violation.kind}`,
    describeLimitViolation(violation),
  );
}

export function findSizeViolation(input: {
  manifest: OpenturnDeploymentManifest;
  serverBundle: BuildOpenturnProjectServerBundle | null;
}): DeployLimitViolation | null {
  const sizes = input.manifest.assetSizes;

  if (sizes !== undefined) {
    let total = 0;
    let totalImages = 0;

    for (const [asset, size] of Object.entries(sizes)) {
      if (size > DEPLOY_LIMITS.PER_ASSET_BYTES) {
        return {
          kind: "per_asset",
          limit: DEPLOY_LIMITS.PER_ASSET_BYTES,
          actual: size,
          asset,
        };
      }
      total += size;
      if (isImageAsset(asset)) totalImages += size;
    }

    if (totalImages > DEPLOY_LIMITS.TOTAL_IMAGES_BYTES) {
      return {
        kind: "total_images",
        limit: DEPLOY_LIMITS.TOTAL_IMAGES_BYTES,
        actual: totalImages,
      };
    }
    if (total > DEPLOY_LIMITS.TOTAL_ASSETS_BYTES) {
      return {
        kind: "total_assets",
        limit: DEPLOY_LIMITS.TOTAL_ASSETS_BYTES,
        actual: total,
      };
    }
  }

  if (
    input.serverBundle !== null &&
    input.serverBundle.gzippedSize > DEPLOY_LIMITS.WORKER_GZIPPED_BYTES
  ) {
    return {
      kind: "worker_gzipped",
      limit: DEPLOY_LIMITS.WORKER_GZIPPED_BYTES,
      actual: input.serverBundle.gzippedSize,
    };
  }

  return null;
}

const REQUIRED_GAME_EXPORTS = ["game"] as const;
const DEFAULT_OUT_DIR = ".openturn/deploy";
const INTERNAL_BUILD_DIR = ".openturn/build";
const WORKER_COMPATIBILITY_DATE = "2026-04-17";
const SERVER_SCRIPT_FILENAME = "server.js";
const SERVER_METADATA_FILENAME = "server.metadata.json";

export function discoverOpenturnProject(projectDir = process.cwd()): OpenturnProjectPaths {
  const absoluteProjectDir = resolve(projectDir);
  const appDir = join(absoluteProjectDir, "app");
  const gamePath = join(appDir, "game.ts");
  const pagePath = join(appDir, "page.tsx");
  const metadataPath = join(appDir, "openturn.ts");

  if (!existsSync(gamePath)) {
    throw new OpenturnDeployError(
      "missing_game_entry",
      `Missing app/game.ts. Openturn deployments require a canonical game entry that exports "game".`,
    );
  }

  if (!existsSync(pagePath)) {
    throw new OpenturnDeployError(
      "missing_page_entry",
      `Missing app/page.tsx. Openturn deployments require a default React page export.`,
    );
  }

  return {
    game: gamePath,
    metadata: existsSync(metadataPath) ? metadataPath : null,
    page: pagePath,
    projectDir: absoluteProjectDir,
  };
}

export async function validateOpenturnProject(paths: OpenturnProjectPaths): Promise<void> {
  const gameModule = await importFresh(paths.game) as Record<string, unknown>;

  for (const exportName of REQUIRED_GAME_EXPORTS) {
    if (!(exportName in gameModule)) {
      throw new OpenturnDeployError(
        `missing_${exportName}_export`,
        `app/game.ts must export "${exportName}".`,
      );
    }
  }

  validateGamePlayerIDs(gameModule.game, "app/game.ts game.playerIDs");

  const pageSource = readFileSync(paths.page, "utf8");

  if (!/\bexport\s+default\b/u.test(pageSource)) {
    throw new OpenturnDeployError(
      "missing_page_default_export",
      "app/page.tsx must export a default React component.",
    );
  }

  if (paths.metadata !== null) {
    const metadata = await loadMetadata(paths);
    const runtime = metadata.runtime;

    if (runtime !== undefined && runtime !== "local" && runtime !== "multiplayer") {
      throw new OpenturnDeployError(
        "unsupported_runtime",
        `app/openturn.ts declared unsupported runtime "${String(runtime)}". Supported runtimes: "local", "multiplayer".`,
      );
    }
  }
}

/**
 * Discover and validate an Openturn project in one call. Returns validated
 * `OpenturnProjectPaths`. Use this when you need the paths but not the full
 * build artifact — `buildOpenturnProject` calls this internally.
 */
export async function resolveOpenturnProject(projectDir?: string): Promise<OpenturnProjectPaths> {
  const paths = discoverOpenturnProject(projectDir);
  await validateOpenturnProject(paths);
  return paths;
}

export async function buildOpenturnProject(
  options: BuildOpenturnProjectOptions = {},
): Promise<BuildOpenturnProjectResult> {
  const paths = await resolveOpenturnProject(options.projectDir);

  const deploymentID = options.deploymentID ?? createID("dep");
  const projectID = options.projectID ?? basename(paths.projectDir);
  const outDir = resolve(paths.projectDir, options.outDir ?? DEFAULT_OUT_DIR);
  const buildDir = join(paths.projectDir, INTERNAL_BUILD_DIR, deploymentID);
  const entryPath = join(buildDir, "entry.tsx");
  const metadata = await loadMetadata(paths);
  const runtime: OpenturnDeploymentRuntime = metadata.runtime ?? "multiplayer";

  rmSync(outDir, { force: true, recursive: true });
  rmSync(buildDir, { force: true, recursive: true });
  mkdirSync(outDir, { recursive: true });
  mkdirSync(buildDir, { recursive: true });
  writeFileSync(entryPath, createBrowserEntry(paths, deploymentID, projectID, runtime));

  let browserEntryFileName: string | null = null;

  try {
    const browserBuild = await viteBuild({
      appType: "custom",
      build: {
        cssCodeSplit: true,
        emptyOutDir: false,
        minify: false,
        // Build into the deployment root. Bundled JS/CSS are nested under
        // `assets/` via the rollup output patterns below; files Vite copies
        // from `<projectDir>/public/**` land at this root verbatim.
        outDir,
        rollupOptions: {
          input: entryPath,
          output: {
            assetFileNames: "assets/[name]-[hash][extname]",
            chunkFileNames: "assets/[name]-[hash].js",
            entryFileNames: "assets/[name]-[hash].js",
          },
        },
        target: "es2022",
      },
      clearScreen: false,
      configFile: false,
      plugins: [openturnTailwindProjectSource(paths.projectDir), tailwindcss(), react()],
      // `<projectDir>/public/**` is copied verbatim into `outDir`. Files there
      // are NOT content-hashed; the per-deployment R2 prefix is the cache
      // buster, so static images can be referenced by their stable filename.
      publicDir: "public",
      root: paths.projectDir,
    });
    browserEntryFileName = findViteEntryFileName(browserBuild);
  } catch (error) {
    rmSync(buildDir, { force: true, recursive: true });
    const message = error instanceof Error ? error.message : String(error);
    throw new OpenturnDeployError("bundle_failed", message.length > 0 ? message : "Failed to bundle Openturn deployment.");
  }

  let serverBundle: BuildOpenturnProjectServerBundle | null = null;
  let multiplayerManifest: OpenturnMultiplayerManifest | undefined;

  if (runtime === "multiplayer") {
    const workerEntryPath = join(buildDir, "worker-entry.ts");
    const generatedDeployment = await resolveGeneratedDeployment({
      defaultGameKey: projectID,
      defaultDeploymentVersion: "dev",
      metadata,
      paths,
    });
    const serverWorkerPath = fileURLToPath(import.meta.resolve("@openturn/server/worker"));
    linkGeneratedWorkspacePackage(buildDir, "@openturn/core", packageRootFromExport("@openturn/core"));
    linkGeneratedWorkspacePackage(buildDir, "@openturn/json", packageRootFromExport("@openturn/json"));
    linkGeneratedWorkspacePackage(buildDir, "@openturn/protocol", packageRootFromExport("@openturn/protocol"));
    linkGeneratedWorkspacePackage(buildDir, "@openturn/server", dirname(dirname(serverWorkerPath)));
    writeFileSync(workerEntryPath, createWorkerEntry(buildDir, serverWorkerPath, paths.game, generatedDeployment));

    const serverBuild = await buildWorkerBundle({
      entrypoints: [workerEntryPath],
      outdir: buildDir,
      naming: SERVER_SCRIPT_FILENAME,
      plugins: [createWorkerBundleResolverPlugin(serverWorkerPath)],
      splitting: false,
      target: "browser",
      format: "esm",
      external: ["cloudflare:workers"],
    });

    if (!serverBuild.success) {
      rmSync(buildDir, { force: true, recursive: true });
      const message = serverBuild.logs.map((log) => log.message).join("\n").trim();
      throw new OpenturnDeployError(
        "server_bundle_failed",
        message.length > 0 ? message : "Failed to bundle multiplayer worker entry.",
      );
    }

    const compiledServer = join(buildDir, SERVER_SCRIPT_FILENAME);

    if (!existsSync(compiledServer)) {
      rmSync(buildDir, { force: true, recursive: true });
      throw new OpenturnDeployError(
        "server_bundle_missing_output",
        `Multiplayer worker bundle did not produce ${SERVER_SCRIPT_FILENAME} output.`,
      );
    }

    const serverBytes = readFileSync(compiledServer);
    const outServer = join(outDir, SERVER_SCRIPT_FILENAME);
    writeFileSync(outServer, serverBytes);
    const digest = await digestHex(serverBytes);
    const gzippedSize = gzipSync(serverBytes).byteLength;

    const workerMetadata = createWorkerMetadata();
    const outMetadata = join(outDir, SERVER_METADATA_FILENAME);
    writeFileSync(outMetadata, `${JSON.stringify(workerMetadata, null, 2)}\n`);

    serverBundle = {
      path: outServer,
      digest,
      size: serverBytes.byteLength,
      gzippedSize,
      metadataPath: outMetadata,
      metadata: workerMetadata,
    };

    multiplayerManifest = {
      gameKey: generatedDeployment.gameKey,
      deploymentVersion:
        metadata.multiplayer?.deploymentVersion ?? digest,
      schemaVersion: generatedDeployment.schemaVersion,
      players: generatedDeployment.players,
      minPlayers: generatedDeployment.minPlayers,
      maxPlayers: generatedDeployment.maxPlayers,
      serverBundleDigest: digest,
      ...(generatedDeployment.availableBots === undefined
        ? {}
        : { availableBots: generatedDeployment.availableBots }),
    };
  }

  rmSync(buildDir, { force: true, recursive: true });

  // Walk the full outDir, not just `assets/`, so files Vite copied from
  // `<projectDir>/public/**` are included. Deployment metadata files written
  // by this builder are excluded so they don't leak into the manifest.
  const excludedFromAssets = new Set([
    "manifest.json",
    "index.html",
    SERVER_SCRIPT_FILENAME,
    SERVER_METADATA_FILENAME,
  ]);
  const outDirFiles = await listFiles(outDir);
  const assetEntries = outDirFiles
    .map((absolutePath) => ({
      absolutePath,
      relative: toRelativeURL(outDir, absolutePath),
    }))
    .filter(({ relative: rel }) => !excludedFromAssets.has(rel.replace(/^\.\//u, "")))
    .sort((a, b) => a.relative.localeCompare(b.relative));
  const assets = assetEntries.map((entry) => entry.relative);
  const assetSizes: Record<string, number> = {};
  for (const entry of assetEntries) {
    assetSizes[entry.relative] = statSync(entry.absolutePath).size;
  }
  const scripts = assets.filter((asset) => asset.endsWith(".js"));
  const styles = assets.filter((asset) => asset.endsWith(".css"));
  // `browserEntryFileName` is already relative to outDir (e.g. `assets/entry-<hash>.js`)
  // because rollup's `entryFileNames` pattern produces an outDir-relative path.
  const entry = browserEntryFileName === null
    ? scripts[0] ?? ""
    : toRelativeURL(outDir, join(outDir, browserEntryFileName));
  const manifest: OpenturnDeploymentManifest = {
    assets,
    assetSizes,
    build: {
      at: new Date().toISOString(),
      openturn: readOpenturnPackageVersions(paths.projectDir),
    },
    deploymentID,
    entry,
    gameName: readGameName(metadata, projectID),
    projectID,
    runtime,
    styles,
    ...(multiplayerManifest === undefined ? {} : { multiplayer: multiplayerManifest }),
    ...(metadata.inspector === undefined ? {} : { inspector: metadata.inspector }),
  };

  if (manifest.entry.length === 0) {
    throw new OpenturnDeployError("missing_bundle_entry", "Bundler did not emit a JavaScript entry asset.");
  }

  writeFileSync(join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(join(outDir, "index.html"), createDeploymentHTML(manifest));

  return {
    manifest,
    metadata,
    outDir,
    paths,
    serverBundle,
  };
}

function openturnTailwindProjectSource(projectDir: string) {
  const workspaceSources = collectOpenturnWorkspaceSources(projectDir);

  return {
    name: "openturn:tailwind-project-source",
    enforce: "pre" as const,
    transform(code: string, id: string) {
      const filePath = id.split("?", 1)[0];

      if (
        filePath === undefined ||
        !filePath.endsWith(".css") ||
        !isWithinDirectory(projectDir, filePath)
      ) {
        return null;
      }
      if (!importsTailwind(code)) return null;

      const fromDir = dirname(filePath);
      const directives: string[] = [];
      directives.push(`@source ${JSON.stringify(toModuleSpecifier(fromDir, projectDir))};`);
      for (const sourceDir of workspaceSources) {
        directives.push(`@source ${JSON.stringify(toModuleSpecifier(fromDir, sourceDir))};`);
      }
      return `${directives.join("\n")}\n${code}`;
    },
  };
}

function collectOpenturnWorkspaceSources(projectDir: string): string[] {
  const sources = new Set<string>();
  const visited = new Set<string>();
  const queue: string[] = [projectDir];
  const root = realpathSync(projectDir);

  while (queue.length > 0) {
    const dir = queue.shift() as string;
    let real: string;
    try {
      real = realpathSync(dir);
    } catch {
      continue;
    }
    if (visited.has(real)) continue;
    visited.add(real);

    if (real !== root) {
      const srcDir = join(real, "src");
      try {
        if (realpathSync(srcDir)) sources.add(srcDir);
      } catch {
        // No `src/` directory.
      }
    }

    const nested = join(real, "node_modules", "@openturn");
    let entries: string[];
    try {
      entries = readdirSync(nested);
    } catch {
      continue;
    }
    for (const name of entries) {
      queue.push(join(nested, name));
    }
  }

  return [...sources].sort();
}

function importsTailwind(code: string): boolean {
  return /@import\s+(?:url\()?["']tailwindcss["']\)?/.test(code);
}

function isWithinDirectory(parent: string, child: string): boolean {
  const relativePath = relative(parent, child);
  return relativePath === "" || (!relativePath.startsWith("..") && !relativePath.startsWith("/"));
}

export interface GeneratedGameDeploymentDescriptor {
  gameKey: string;
  deploymentVersion: string;
  schemaVersion: string;
  players: readonly string[];
  minPlayers: number;
  maxPlayers: number;
  /** Catalog metadata for bots from `game.bots`. Empty/absent when the game ships none. */
  availableBots?: readonly {
    botID: string;
    label: string;
    description?: string;
    difficulty?: "easy" | "medium" | "hard" | "expert";
  }[];
}

export async function loadOpenturnProjectDeployment(input: {
  deploymentVersion?: string;
  gameKey?: string;
  projectDir?: string;
  schemaVersion?: string;
} = {}): Promise<{
  deploymentVersion: string;
  game: unknown;
  gameKey: string;
  schemaVersion: string;
}> {
  const paths = await resolveOpenturnProject(input.projectDir);
  const metadata = await loadMetadata(paths);
  const gameModule = await importFresh(paths.game) as Record<string, unknown>;
  const descriptor = await resolveGeneratedDeployment({
    defaultGameKey: input.gameKey ?? basename(paths.projectDir),
    defaultDeploymentVersion: input.deploymentVersion ?? "dev",
    metadata,
    paths,
    ...(input.gameKey === undefined ? {} : { overrideGameKey: input.gameKey }),
    ...(input.schemaVersion === undefined ? {} : { overrideSchemaVersion: input.schemaVersion }),
  });

  return {
    deploymentVersion: descriptor.deploymentVersion,
    game: gameModule.game,
    gameKey: descriptor.gameKey,
    schemaVersion: descriptor.schemaVersion,
  };
}

async function resolveGeneratedDeployment(input: {
  defaultDeploymentVersion: string;
  defaultGameKey: string;
  metadata: OpenturnDeploymentMetadata;
  overrideGameKey?: string;
  overrideSchemaVersion?: string;
  paths: OpenturnProjectPaths;
}): Promise<GeneratedGameDeploymentDescriptor> {
  const gameModule = await importFresh(input.paths.game) as Record<string, unknown>;
  const multiplayer = input.metadata.multiplayer;
  const gameKey =
    input.overrideGameKey ??
    multiplayer?.gameKey ??
    slugify(input.defaultGameKey);
  const deploymentVersion =
    multiplayer?.deploymentVersion ??
    input.defaultDeploymentVersion;
  const schemaVersion =
    input.overrideSchemaVersion ??
    multiplayer?.schemaVersion ??
    "1";
  const players = multiplayer?.players ?? extractGamePlayerIDs(gameModule.game);
  const availableBots = extractAvailableBots(gameModule.game);
  const declaredMinPlayers =
    multiplayer?.minPlayers ?? extractGameMinPlayers(gameModule.game);
  const minPlayers = declaredMinPlayers ?? players.length;
  const maxPlayers = players.length;

  if (gameKey.length === 0) {
    throw new OpenturnDeployError("invalid_multiplayer_game_key", "multiplayer.gameKey must be a non-empty string.");
  }

  if (deploymentVersion.length === 0) {
    throw new OpenturnDeployError("invalid_multiplayer_deployment_version", "multiplayer.deploymentVersion must be a non-empty string.");
  }

  if (schemaVersion.length === 0) {
    throw new OpenturnDeployError("invalid_multiplayer_schema_version", "multiplayer.schemaVersion must be a non-empty string.");
  }

  if (players.length === 0 || players.some((player) => typeof player !== "string" || player.length === 0)) {
    throw new OpenturnDeployError("invalid_multiplayer_players", "multiplayer players must contain at least one player.");
  }

  if (!Number.isInteger(minPlayers) || minPlayers < 1 || minPlayers > maxPlayers) {
    throw new OpenturnDeployError(
      "invalid_multiplayer_min_players",
      `multiplayer.minPlayers must be an integer between 1 and players.length (${maxPlayers}); got ${minPlayers}.`,
    );
  }

  return {
    deploymentVersion,
    gameKey,
    players,
    minPlayers,
    maxPlayers,
    schemaVersion,
    ...(availableBots === undefined ? {} : { availableBots }),
  };
}

/**
 * Extracts the bot catalog from `game.bots` (set via `attachBots(game, registry)`
 * in the consumer's bots package). Live `Bot` instances stay bundled with the
 * worker code; only the wire-safe catalog metadata travels in the manifest.
 * Returns `undefined` when the game has no `bots` field.
 */
function extractAvailableBots(game: unknown): readonly {
  botID: string;
  label: string;
  description?: string;
  difficulty?: "easy" | "medium" | "hard" | "expert";
}[] | undefined {
  if (typeof game !== "object" || game === null) return undefined;
  const bots = (game as { bots?: unknown }).bots;
  if (typeof bots !== "object" || bots === null) return undefined;
  const entries = (bots as { entries?: unknown }).entries;
  if (!Array.isArray(entries)) return undefined;
  const out: {
    botID: string;
    label: string;
    description?: string;
    difficulty?: "easy" | "medium" | "hard" | "expert";
  }[] = [];
  for (const entry of entries) {
    if (typeof entry !== "object" || entry === null) continue;
    const e = entry as {
      botID?: unknown;
      label?: unknown;
      description?: unknown;
      difficulty?: unknown;
    };
    if (typeof e.botID !== "string" || e.botID.length === 0) continue;
    if (typeof e.label !== "string" || e.label.length === 0) continue;
    out.push({
      botID: e.botID,
      label: e.label,
      ...(typeof e.description === "string" ? { description: e.description } : {}),
      ...(typeof e.difficulty === "string"
        && (e.difficulty === "easy"
          || e.difficulty === "medium"
          || e.difficulty === "hard"
          || e.difficulty === "expert")
        ? { difficulty: e.difficulty }
        : {}),
    });
  }
  return out.length > 0 ? out : undefined;
}

function extractGamePlayerIDs(game: unknown): readonly string[] {
  validateGamePlayerIDs(game, "app/game.ts game.playerIDs");
  return [...((game as { playerIDs: readonly string[] }).playerIDs)];
}

function extractGameMinPlayers(game: unknown): number | undefined {
  if (typeof game !== "object" || game === null) return undefined;
  const value = (game as { minPlayers?: unknown }).minPlayers;
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return value;
}

function validateGamePlayerIDs(game: unknown, label: string): void {
  if (typeof game !== "object" || game === null) {
    throw new OpenturnDeployError("invalid_game_export", `${label} must be an array of strings.`);
  }

  const players = (game as { playerIDs?: unknown }).playerIDs;
  if (!Array.isArray(players) || players.length === 0 || players.some((value) => typeof value !== "string" || value.length === 0)) {
    throw new OpenturnDeployError("invalid_game_player_ids", `${label} must be a non-empty array of strings.`);
  }
}

async function digestHex(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const hash = await crypto.subtle.digest("SHA-256", copy.buffer);
  return Array.from(new Uint8Array(hash))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function createDeploymentHTML(manifest: OpenturnDeploymentManifest): string {
  return createDeploymentHTMLFromManifest({ manifest });
}

function createWorkerEntry(
  buildDir: string,
  serverWorkerPath: string,
  gamePath: string,
  deployment: GeneratedGameDeploymentDescriptor,
): string {
  const gameSpecifier = toModuleSpecifier(buildDir, gamePath);

  return `import { createGameWorker } from "@openturn/server/worker";
import { game } from ${JSON.stringify(gameSpecifier)};

const worker = createGameWorker({
  deploymentVersion: ${JSON.stringify(deployment.deploymentVersion)},
  game,
  gameKey: ${JSON.stringify(deployment.gameKey)},
  schemaVersion: ${JSON.stringify(deployment.schemaVersion)},
});

export const GameRoom = worker.GameRoom;
export default worker.default;
`;
}

function packageRootFromExport(specifier: string): string {
  return dirname(dirname(fileURLToPath(import.meta.resolve(specifier))));
}

async function buildWorkerBundle(config: Bun.BuildConfig): Promise<Bun.BuildOutput> {
  let lastError: unknown;
  let lastOutput: Bun.BuildOutput | null = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const output = await Bun.build(config);

      if (output.success) {
        return output;
      }

      lastOutput = output;
    } catch (error) {
      lastError = error;
    }
  }

  if (lastOutput !== null) {
    return lastOutput;
  }

  throw lastError;
}

function createWorkerBundleResolverPlugin(serverWorkerPath: string): Bun.BunPlugin {
  const packageEntries = new Map<string, string>([
    ["@openturn/core", join(packageRootFromExport("@openturn/core"), "src", "index.ts")],
    ["@openturn/json", join(packageRootFromExport("@openturn/json"), "src", "index.ts")],
    ["@openturn/protocol", join(packageRootFromExport("@openturn/protocol"), "src", "index.ts")],
    ["@openturn/server/worker", serverWorkerPath],
    ["zod", fileURLToPath(import.meta.resolve("zod"))],
  ]);

  return {
    name: "openturn-worker-package-resolver",
    setup(build) {
      build.onResolve({ filter: /^(?:@openturn\/(?:core|json|protocol|server\/worker)|zod)$/u }, (args) => ({
        path: packageEntries.get(args.path) ?? args.path,
      }));
    },
  };
}

function linkGeneratedWorkspacePackage(buildDir: string, packageName: string, packageRoot: string): void {
  const scopeIndex = packageName.lastIndexOf("/");
  const installDirectory = scopeIndex === -1
    ? join(buildDir, "node_modules")
    : join(buildDir, "node_modules", packageName.slice(0, scopeIndex));
  const linkPath = join(buildDir, "node_modules", packageName);

  mkdirSync(installDirectory, { recursive: true });

  if (!existsSync(linkPath)) {
    symlinkSync(packageRoot, linkPath, "dir");
  }
}

function createWorkerMetadata(): OpenturnWorkerScriptMetadata {
  return {
    main_module: SERVER_SCRIPT_FILENAME,
    compatibility_date: WORKER_COMPATIBILITY_DATE,
    bindings: [
      {
        type: "durable_object_namespace",
        name: "GAME_ROOM",
        class_name: "GameRoom",
      },
    ],
    migrations: {
      new_sqlite_classes: ["GameRoom"],
    },
  };
}

function createBrowserEntry(
  paths: OpenturnProjectPaths,
  deploymentID: string,
  projectID: string,
  runtime: OpenturnDeploymentRuntime,
): string {
  const entryDir = join(paths.projectDir, INTERNAL_BUILD_DIR, deploymentID);
  // The browser entry primes `createOpenturnBindings` with the project's
  // runtime + initial match. Once primed, any `createOpenturnBindings(game)`
  // call inside the user's tree (e.g. an experience component reaching for
  // `useMatch`) hits the cache and shares the same provider context.
  //
  // For `runtime: "local"` we wrap Page in `<OpenturnProvider>` so the
  // in-process session is mounted before user code runs. Multiplayer apps
  // wrap themselves (so they can opt into `useRoom`/lobby UI shapes) and the
  // entry just renders Page.
  const localImport = runtime === "local"
    ? `import { createOpenturnBindings } from "@openturn/react";\n`
    : `import { createOpenturnBindings } from "@openturn/react";\n`;
  const bindingsSetup = runtime === "local"
    ? `
const { OpenturnProvider } = createOpenturnBindings(game, {
  runtime: "local",
  match: { players: game.playerIDs },
});
`
    : `
createOpenturnBindings(game, { runtime: "multiplayer" });
`;
  const renderExpression = runtime === "local"
    ? `React.createElement(OpenturnProvider, null, React.createElement(Page, { deployment }))`
    : `React.createElement(Page, { deployment })`;

  return `import React from "react";
import { createRoot } from "react-dom/client";
${localImport}import Page from ${JSON.stringify(toModuleSpecifier(entryDir, paths.page))};
import { game } from ${JSON.stringify(toModuleSpecifier(entryDir, paths.game))};

const deployment = {
  deploymentID: ${JSON.stringify(deploymentID)},
  projectID: ${JSON.stringify(projectID)},
  runtime: ${JSON.stringify(runtime)},
};
${bindingsSetup}
const host = document.getElementById("openturn-root") ?? document.body.appendChild(document.createElement("div"));
host.setAttribute("data-openturn-host", "");
const mount = document.createElement("div");
mount.setAttribute("data-openturn-mount", "");
host.replaceChildren(mount);

Object.assign(window, {
  __OPENTURN_DEPLOYMENT__: deployment,
});

void game;

createRoot(mount).render(${renderExpression});
`;
}

async function loadMetadata(paths: OpenturnProjectPaths): Promise<OpenturnDeploymentMetadata> {
  if (paths.metadata === null) {
    return {};
  }

  const metadataModule = await importFresh(paths.metadata) as Record<string, unknown>;
  const metadata = metadataModule.metadata;
  const runtime = metadataModule.runtime;

  if (runtime !== undefined && runtime !== "local" && runtime !== "multiplayer") {
    throw new OpenturnDeployError(
      "unsupported_runtime",
      `app/openturn.ts declared unsupported runtime "${String(runtime)}". Supported runtimes: "local", "multiplayer".`,
    );
  }

  if (metadata === undefined) {
    return runtime === undefined ? {} : { runtime };
  }

  if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) {
    throw new OpenturnDeployError("invalid_metadata", "app/openturn.ts metadata export must be an object.");
  }

  const resolved = metadata as OpenturnDeploymentMetadata;

  if (resolved.slug !== undefined) {
    if (typeof resolved.slug !== "string" || !PROJECT_SLUG_RE.test(resolved.slug)) {
      throw new OpenturnDeployError(
        "invalid_metadata_slug",
        `app/openturn.ts metadata.slug must be 2-64 lowercase letters/digits/dashes, starting with a letter (got ${JSON.stringify(resolved.slug)}).`,
      );
    }
  }

  return resolved.runtime === undefined && runtime !== undefined
    ? { ...resolved, runtime }
    : resolved;
}

const PROJECT_SLUG_RE = /^[a-z][a-z0-9-]{1,63}$/u;

function readGameName(metadata: OpenturnDeploymentMetadata, fallback: string): string {
  return typeof metadata.name === "string" && metadata.name.length > 0 ? metadata.name : fallback;
}

function readOpenturnPackageVersions(projectDir: string): Record<string, string> {
  const packageJsonPath = join(projectDir, "package.json");

  if (!existsSync(packageJsonPath)) {
    return {};
  }

  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const versions: Record<string, string> = {};

  for (const dependencies of [packageJson.dependencies, packageJson.devDependencies]) {
    if (dependencies === undefined) {
      continue;
    }

    for (const [name, version] of Object.entries(dependencies)) {
      if (name === "openturn" || name.startsWith("@openturn/")) {
        versions[name] = version;
      }
    }
  }

  return versions;
}

async function listFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const absolutePath = join(directory, entry.name);

    if (entry.isDirectory()) {
      return listFiles(absolutePath);
    }

    return entry.isFile() ? [absolutePath] : [];
  }));

  return files.flat();
}

function findViteEntryFileName(buildOutput: unknown): string | null {
  const outputs = Array.isArray(buildOutput) ? buildOutput : [buildOutput];

  for (const output of outputs) {
    if (!isRecord(output) || !Array.isArray(output.output)) {
      continue;
    }

    for (const chunk of output.output) {
      if (isRecord(chunk) && chunk.type === "chunk" && chunk.isEntry === true && typeof chunk.fileName === "string") {
        return chunk.fileName;
      }
    }
  }

  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function importFresh(path: string): Promise<unknown> {
  return import(`${pathToFileURL(path).href}?t=${Date.now()}-${Math.random()}`);
}

function toRelativeURL(root: string, path: string): string {
  return `./${relative(root, path).split("\\").join("/")}`;
}

function toModuleSpecifier(fromDirectory: string, path: string): string {
  const specifier = relative(fromDirectory, path).split("\\").join("/");
  return specifier.startsWith(".") ? specifier : `./${specifier}`;
}

function createID(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replaceAll(/[^a-z0-9-]+/gu, "-")
    .replaceAll(/-+/gu, "-")
    .replace(/^-|-$/gu, "");
}
