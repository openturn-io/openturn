import { z } from "zod";

export type OpenturnDeploymentRuntime = "local" | "multiplayer";

export type OpenturnInspectorMode = "always" | "dev-only" | "never";
export type OpenturnInspectorRole = "owner" | "player" | "spectator";

export interface OpenturnInspectorPolicy {
  mode: OpenturnInspectorMode;
  allowedRoles?: readonly OpenturnInspectorRole[] | undefined;
}

// Canonical list of shell controls a host may render. Listed once here so the
// manifest schema, the bridge registry (`@openturn/bridge` SHELL_CONTROLS), and
// the runtime gating helper all derive from the same source. To add a new
// control: add the id here, then map it to its adapter method / label /
// placement in `@openturn/bridge`'s `SHELL_CONTROLS`. The `satisfies` constraint
// in bridge fails to compile until the registry is updated.
export const SHELL_CONTROL_IDS = [
  "save",
  "load",
  "reset",
  "returnToLobby",
  "copyInvite",
  "publicRooms",
  "visibilityToggle",
] as const;

export type OpenturnShellControl = (typeof SHELL_CONTROL_IDS)[number];

// Per-control opt-in/out for shell chrome. `undefined` means "default-on when
// the host adapter supports it" — the shell only renders a control when both
// the adapter implements it and the manifest hasn't explicitly disabled it.
// Set `false` to hide a control even if the adapter could provide it.
export type OpenturnShellControlsConfig = {
  readonly [K in OpenturnShellControl]?: boolean | undefined;
};

export interface OpenturnMultiplayerManifest {
  gameKey: string;
  deploymentVersion: string;
  schemaVersion: string;
  /**
   * Maximal player roster. `players.length === maxPlayers` is invariant.
   * The lobby seats up to `targetCapacity` (host-chosen, `[minPlayers, maxPlayers]`)
   * and the running game sees `match.players` filtered to the seated subset.
   */
  players: readonly string[];
  minPlayers: number;
  maxPlayers: number;
  serverBundleDigest: string;
  /**
   * Catalog of bots the deployed game offers in its lobby. Populated at
   * build time from `game.bots` (see `@openturn/lobby/registry`). The cloud
   * Durable Object reads this to build `LobbyEnv.knownBots`, which the
   * lobby UI uses to render the per-seat bot picker.
   */
  availableBots?: readonly OpenturnAvailableBot[] | undefined;
}

export interface OpenturnAvailableBot {
  botID: string;
  label: string;
  description?: string | undefined;
  difficulty?: "easy" | "medium" | "hard" | "expert" | undefined;
}

export interface OpenturnDeploymentManifest {
  // Optional because the build-time manifest written by @openturn/deploy sets
  // these, but manifests read back at serve time (before promotion into a
  // deployment record) may lack them. Explicit `| undefined` is required for
  // consumers whose tsconfig enables `exactOptionalPropertyTypes`.
  deploymentID?: string | undefined;
  projectID?: string | undefined;
  runtime: OpenturnDeploymentRuntime;
  gameName: string;
  entry: string;
  styles: readonly string[];
  assets: readonly string[];
  build: {
    at: string;
    openturn: Record<string, string>;
  };
  multiplayer?: OpenturnMultiplayerManifest | undefined;
  inspector?: OpenturnInspectorPolicy | undefined;
  shellControls?: OpenturnShellControlsConfig | undefined;
}

export const OpenturnInspectorPolicySchema = z.object({
  mode: z.enum(["always", "dev-only", "never"]),
  allowedRoles: z
    .array(z.enum(["owner", "player", "spectator"]))
    .min(1)
    .max(3)
    .optional(),
});

// Schema shape derived from SHELL_CONTROL_IDS so the zod object stays in lock-
// step with the canonical id list. Adding an id above automatically extends
// the schema; removing one drops it.
export const OpenturnShellControlsConfigSchema = z
  .object(
    Object.fromEntries(
      SHELL_CONTROL_IDS.map((id) => [id, z.boolean().optional()]),
    ) as { [K in OpenturnShellControl]: z.ZodOptional<z.ZodBoolean> },
  )
  .strict();

export const OpenturnAvailableBotSchema = z.object({
  botID: z.string().min(1).max(64),
  label: z.string().min(1).max(120),
  description: z.string().max(280).optional(),
  difficulty: z.enum(["easy", "medium", "hard", "expert"]).optional(),
});

export const OpenturnMultiplayerManifestSchema = z
  .object({
    gameKey: z.string().min(1).max(128),
    deploymentVersion: z.string().min(1).max(64),
    schemaVersion: z.string().min(1).max(64),
    players: z.array(z.string().min(1).max(64)).min(1).max(32),
    minPlayers: z.number().int().min(1).max(32),
    maxPlayers: z.number().int().min(1).max(32),
    serverBundleDigest: z.string().min(1).max(128),
    availableBots: z.array(OpenturnAvailableBotSchema).max(32).optional(),
  })
  .refine((m) => m.minPlayers <= m.maxPlayers, {
    message: "minPlayers must be <= maxPlayers",
    path: ["minPlayers"],
  })
  .refine((m) => m.players.length === m.maxPlayers, {
    message: "players.length must equal maxPlayers (players is the maximal roster)",
    path: ["players"],
  });

// deploymentID/projectID are optional here because the build-time manifest
// (written by @openturn/deploy) doesn't always know them — the cloud control
// plane fills them in when the manifest is promoted to a deployment record.
export const OpenturnDeploymentManifestSchema = z
  .object({
    deploymentID: z.string().min(1).optional(),
    projectID: z.string().min(1).optional(),
    runtime: z.enum(["local", "multiplayer"]),
    gameName: z.string().min(1),
    entry: z.string().min(1),
    styles: z.array(z.string()),
    assets: z.array(z.string()),
    build: z.object({
      at: z.string(),
      openturn: z.record(z.string(), z.string()),
    }),
    multiplayer: OpenturnMultiplayerManifestSchema.optional(),
    inspector: OpenturnInspectorPolicySchema.optional(),
    shellControls: OpenturnShellControlsConfigSchema.optional(),
  })
  .refine(
    (manifest) =>
      manifest.runtime !== "multiplayer" || manifest.multiplayer !== undefined,
    { message: "multiplayer deployments require a multiplayer manifest block" },
  );

export function parseDeploymentManifest(value: unknown): OpenturnDeploymentManifest {
  const parsed = OpenturnDeploymentManifestSchema.parse(value);
  const { multiplayer, deploymentID, projectID, inspector, shellControls, ...rest } =
    parsed;
  const base: OpenturnDeploymentManifest = {
    ...rest,
    ...(deploymentID === undefined ? {} : { deploymentID }),
    ...(projectID === undefined ? {} : { projectID }),
    ...(inspector === undefined ? {} : { inspector: normalizeInspector(inspector) }),
    ...(shellControls === undefined
      ? {}
      : { shellControls: normalizeShellControls(shellControls) }),
  };
  if (multiplayer === undefined) return base;
  const { availableBots, ...multiplayerRest } = multiplayer;
  return {
    ...base,
    multiplayer: {
      ...multiplayerRest,
      ...(availableBots === undefined ? {} : { availableBots: availableBots.map(normalizeAvailableBot) }),
    },
  };
}

function normalizeAvailableBot(input: z.infer<typeof OpenturnAvailableBotSchema>): OpenturnAvailableBot {
  return {
    botID: input.botID,
    label: input.label,
    ...(input.description === undefined ? {} : { description: input.description }),
    ...(input.difficulty === undefined ? {} : { difficulty: input.difficulty }),
  };
}

function normalizeShellControls(
  input: z.infer<typeof OpenturnShellControlsConfigSchema>,
): OpenturnShellControlsConfig {
  const out: { -readonly [K in OpenturnShellControl]?: boolean } = {};
  for (const id of SHELL_CONTROL_IDS) {
    const value = input[id];
    if (value !== undefined) out[id] = value;
  }
  return out;
}

function normalizeInspector(
  input: z.infer<typeof OpenturnInspectorPolicySchema>,
): OpenturnInspectorPolicy {
  if (input.allowedRoles === undefined) {
    return { mode: input.mode };
  }
  return { mode: input.mode, allowedRoles: input.allowedRoles };
}

export interface CreateDeploymentHTMLOptions {
  manifest: OpenturnDeploymentManifest;
  /**
   * Prefix prepended to the entry script and stylesheet paths. Use `""` (the
   * default) to emit the manifest's paths untouched (suitable when index.html
   * is served from the same directory as its assets). Cloud serving uses an
   * absolute URL prefix, e.g. `https://cdn.example/deployments/<id>`.
   */
  assetBaseURL?: string;
}

export function createDeploymentHTML(options: CreateDeploymentHTMLOptions): string {
  const { manifest, assetBaseURL = "" } = options;
  const styleTags = manifest.styles
    .map(
      (style) =>
        `    <link rel="stylesheet" href="${escapeHTML(toAssetURL(assetBaseURL, style))}">`,
    )
    .join("\n");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHTML(manifest.gameName)}</title>
${styleTags.length > 0 ? `${styleTags}\n` : ""}  </head>
  <body>
    <div id="openturn-root"></div>
    <script>
      window.__OPENTURN_DEPLOYMENT__ = ${JSON.stringify({
        deploymentID: manifest.deploymentID,
        projectID: manifest.projectID,
        runtime: manifest.runtime,
      })};
    </script>
    <script type="module" src="${escapeHTML(toAssetURL(assetBaseURL, manifest.entry))}"></script>
  </body>
</html>
`;
}

export function normalizeAssetPath(asset: string): string {
  if (asset.startsWith("./")) return asset.slice(2);
  if (asset.startsWith("/")) return asset.slice(1);
  return asset;
}

function escapeHTML(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function toAssetURL(baseURL: string, asset: string): string {
  if (baseURL.length === 0) return asset;
  const trimmed = asset.startsWith("./") ? asset.slice(2) : asset;
  const base = baseURL.endsWith("/") ? baseURL.slice(0, -1) : baseURL;
  return `${base}/${trimmed}`;
}
