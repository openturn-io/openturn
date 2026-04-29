import { mkdirSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { ViteDevServer } from "vite";

export interface DevBundleServerOptions {
  deploymentID: string;
  gameName: string;
  port?: number;
  projectDir: string;
  projectID: string;
  runtime: "local" | "multiplayer";
}

export interface DevBundleServer {
  port: number;
  stop(): Promise<void>;
  url: string;
  viteServer: ViteDevServer;
}

const INTERNAL_DEV_DIR = ".openturn/dev";
const DEV_SERVER_HOST = "localhost";

export async function startDevBundleServer(options: DevBundleServerOptions): Promise<DevBundleServer> {
  const projectDir = resolve(options.projectDir);
  const scratchDir = join(projectDir, INTERNAL_DEV_DIR, options.deploymentID);
  mkdirSync(scratchDir, { recursive: true });

  const pagePath = join(projectDir, "app/page.tsx");
  const gamePath = join(projectDir, "app/game.ts");

  const entryPath = join(scratchDir, "entry.tsx");
  const htmlPath = join(scratchDir, "index.html");

  writeFileSync(
    entryPath,
    createDevEntry({
      deploymentID: options.deploymentID,
      gamePath,
      pagePath,
      projectID: options.projectID,
      runtime: options.runtime,
      scratchDir,
    }),
  );
  writeFileSync(htmlPath, createDevHTML({ gameName: options.gameName }));

  const { createServer } = await import("vite");
  const { default: react } = await import("@vitejs/plugin-react");
  const { default: tailwindcss } = await import("@tailwindcss/vite");
  const openturnReactEntry = fileURLToPath(import.meta.resolve("@openturn/react"));
  const openturnInspectorUIEntry = fileURLToPath(import.meta.resolve("@openturn/inspector-ui"));
  const requestedPort = options.port ?? await findAvailablePort();

  const server = await createServer({
    appType: "spa",
    clearScreen: false,
    configFile: false,
    optimizeDeps: {
      holdUntilCrawlEnd: false,
    },
    plugins: [openturnTailwindProjectSource(projectDir), tailwindcss(), react()],
    resolve: {
      alias: {
        "@openturn/inspector-ui": openturnInspectorUIEntry,
        "@openturn/react": openturnReactEntry,
      },
    },
    root: scratchDir,
    server: {
      fs: {
        strict: false,
      },
      host: DEV_SERVER_HOST,
      port: requestedPort,
      strictPort: options.port === undefined,
    },
  });

  await server.listen();

  const address = server.httpServer?.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  const url = `http://${DEV_SERVER_HOST}:${port}`;

  return {
    port,
    async stop() {
      const httpServer = server.httpServer as ({
        closeAllConnections?: () => void;
        closeIdleConnections?: () => void;
      } | null | undefined);
      httpServer?.closeAllConnections?.();
      httpServer?.closeIdleConnections?.();
      await server.close();
    },
    url,
    viteServer: server,
  };
}

// Tailwind v4 only auto-scans from the directory of the CSS file, so workspace
// packages used by the project never reach the generated CSS. We intercept the
// project's CSS files via `load` (not `transform` — `@tailwindcss/vite`'s
// filtered transform shadows other plugins' transform hooks for `.css` ids)
// and prepend `@source` directives for the project + every linked
// `node_modules/@openturn/*` package's `src/`.
function openturnTailwindProjectSource(projectDir: string) {
  const workspaceSources = collectOpenturnWorkspaceSources(projectDir);
  return {
    name: "openturn:tailwind-project-source",
    enforce: "pre" as const,
    async load(id: string) {
      const filePath = id.split("?", 1)[0];
      if (
        filePath === undefined ||
        !filePath.endsWith(".css") ||
        !isWithinDirectory(projectDir, filePath)
      ) {
        return null;
      }
      let code: string;
      try {
        code = await readFile(filePath, "utf8");
      } catch {
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
  // Walk the @openturn dependency graph transitively. The project's own
  // `node_modules/@openturn/*` only lists its direct deps, but workspace
  // packages re-export components from each other (e.g. @openturn/react
  // re-exports <Lobby> from @openturn/lobby), so Tailwind needs to scan
  // every transitively-reachable workspace package's `src/`.
  const sources = new Set<string>();
  const visited = new Set<string>();
  const queue: string[] = [projectDir];

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

    if (real !== realpathSync(projectDir)) {
      const srcDir = join(real, "src");
      try {
        if (realpathSync(srcDir)) sources.add(srcDir);
      } catch {
        // No `src/` (e.g., compiled-only package) — skip.
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

function createDevEntry(input: {
  deploymentID: string;
  gamePath: string;
  pagePath: string;
  projectID: string;
  runtime: "local" | "multiplayer";
  scratchDir: string;
}): string {
  const pageSpecifier = toModuleSpecifier(input.scratchDir, input.pagePath);
  const gameSpecifier = toModuleSpecifier(input.scratchDir, input.gamePath);
  const renderExpression = input.runtime === "local"
    ? "React.createElement(LocalDevShell, { deployment })"
    : "React.createElement(MultiplayerDevShell, { deployment })";
  const devShellImports = input.runtime === "local"
    ? `import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { createInspector } from "@openturn/inspector-ui";
import { createOpenturnBindings } from "@openturn/react";
`
    : `import { useCallback, useEffect, useState } from "react";
import { createInspector } from "@openturn/inspector-ui";
import { createOpenturnBindings, HostedMatchShellObserver, useShellHostedMatch } from "@openturn/react";
`;
  const localShellSetup = input.runtime === "local"
    ? `
const openturnBindings = createOpenturnBindings(game, {
  runtime: "local",
  match,
});
const { Inspector } = createInspector(openturnBindings);
const LOCAL_SAVE_VERSION = 1;

function LocalDevShell({ deployment }) {
  const [localMatch, setLocalMatch] = useState(() => openturnBindings.createLocalMatch({ match }));
  const [inspectorEnabled, setInspectorEnabled] = useState(readInitialInspectorEnabled);
  const snapshot = useSyncExternalStore(
    localMatch.subscribe,
    () => localMatch.getSnapshot(),
    () => localMatch.getSnapshot(),
  );
  const activePlayers = snapshot.derived.activePlayers;
  const devPlayerID = activePlayers[0] ?? match.players[0];

  const toggleInspector = useCallback(() => {
    setInspectorEnabled((current) => {
      const next = !current;
      writeInspectorEnabled(next);
      return next;
    });
  }, []);
  useInspectorHotkey(toggleInspector);
  useEffect(() => { logInspectorHintOnce(); }, []);

  const onReset = useCallback(() => {
    localMatch.reset?.();
  }, [localMatch]);

  const onSave = useCallback(() => {
    const replay = localMatch.getReplayData();
    const current = localMatch.getSnapshot();
    const payload = {
      version: LOCAL_SAVE_VERSION,
      match: replay.match,
      snapshot: current,
      seed: current.meta.seed,
      initialNow: replay.initialNow,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = \`openturn-local-\${deployment.deploymentID}-\${Date.now()}.json\`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [localMatch, deployment.deploymentID]);

  const onLoad = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json,.json";
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (file === undefined) return;
      try {
        const text = await file.text();
        const parsed = JSON.parse(text);
        if (parsed?.version !== LOCAL_SAVE_VERSION) {
          window.alert("Save file version mismatch");
          return;
        }
        const nextMatch = openturnBindings.createLocalMatch({
          match: parsed.match,
          initialSavedSnapshot: {
            initialNow: parsed.initialNow,
            match: parsed.match,
            seed: parsed.seed,
            snapshot: parsed.snapshot,
          },
        });
        setLocalMatch(nextMatch);
      } catch (caught) {
        window.alert("Failed to load save: " + (caught instanceof Error ? caught.message : String(caught)));
      }
    });
    input.click();
  }, []);

  const page = React.createElement(Page, { deployment });
  const surface = React.createElement(
    Inspector,
    { active: inspectorEnabled, match, matchStore: localMatch, playerID: devPlayerID },
    page,
  );

  return renderDevShell({
    deployment,
    inspectorEnabled,
    onToggleInspector: toggleInspector,
    onReset,
    onSave,
    onLoad,
    statusLabel: formatLocalDevPlayerStatus(snapshot),
    surface,
  });
}

function formatLocalDevPlayerStatus(snapshot) {
  if (snapshot.meta.result !== null) {
    return "Match complete";
  }

  const activePlayers = snapshot.derived.activePlayers;

  if (activePlayers.length === 0) {
    return "No active player";
  }

  if (activePlayers.length === 1) {
    return \`Playing as player \${activePlayers[0]}\`;
  }

  return \`Playing as players \${activePlayers.join(", ")}\`;
}
`
    : "";
  const multiplayerShellSetup = input.runtime === "multiplayer"
    ? `
const { HostedInspector } = createInspector(createOpenturnBindings(game, { runtime: "multiplayer" }));
const idleHostedState = createIdleHostedState(game);

function MultiplayerDevShell({ deployment }) {
  const observedHostedState = useShellHostedMatch(game);
  const [inspectorEnabled, setInspectorEnabled] = useState(readInitialInspectorEnabled);

  const toggleInspector = useCallback(() => {
    setInspectorEnabled((current) => {
      const next = !current;
      writeInspectorEnabled(next);
      return next;
    });
  }, []);
  useInspectorHotkey(toggleInspector);
  useEffect(() => { logInspectorHintOnce(); }, []);

  const page = React.createElement(
    HostedMatchShellObserver,
    null,
    React.createElement(Page, { deployment }),
  );
  const surface = React.createElement(
    HostedInspector,
    { active: inspectorEnabled, hostedState: observedHostedState ?? idleHostedState },
    page,
  );

  return renderDevShell({
    deployment,
    inspectorEnabled,
    onToggleInspector: toggleInspector,
    statusLabel: formatMultiplayerDevStatus(observedHostedState),
    surface,
  });
}

function formatMultiplayerDevStatus(hostedState) {
  if (hostedState === null) {
    return "Waiting for match";
  }

  if (hostedState.status === "idle") {
    return "Waiting for match";
  }
  if (hostedState.status === "connecting") {
    return "Connecting\u2026";
  }
  if (hostedState.status === "disconnected") {
    return "Disconnected";
  }
  if (hostedState.status === "error") {
    return hostedState.error ?? "Error";
  }
  if (hostedState.isFinished) {
    return "Match complete";
  }
  if (hostedState.playerID !== null) {
    return hostedState.isActivePlayer
      ? \`Your turn (player \${hostedState.playerID})\`
      : \`Waiting as player \${hostedState.playerID}\`;
  }
  return "Connected";
}

function createIdleHostedState(game) {
  const dispatchEntries = Object.keys(game.events).map((eventName) => [
    eventName,
    () => ({ error: "not_connected", ok: false }),
  ]);
  const canDispatchEntries = Object.keys(game.events).map((eventName) => [eventName, false]);

  return {
    activePlayers: [],
    batchHistory: [],
    canAct() {
      return false;
    },
    canDispatch: Object.fromEntries(canDispatchEntries),
    disconnect() {},
    dispatch: Object.fromEntries(dispatchEntries),
    error: null,
    initialSnapshot: null,
    isActivePlayer: false,
    isFinished: false,
    lastAcknowledgedActionID: null,
    lastBatch: null,
    playerID: null,
    async reconnect() {},
    requestResync() {},
    requestSync() {},
    result: null,
    roomID: null,
    self: null,
    snapshot: null,
    status: "idle",
  };
}
`
    : "";
  const sharedDevSetup = `
const INSPECTOR_STORAGE_KEY = "openturn.dev.inspector.enabled";

function renderDevShell({
  deployment,
  inspectorEnabled,
  onToggleInspector,
  onReset,
  onReturnToLobby,
  onSave,
  onLoad,
  statusLabel,
  surface,
}) {
  const actionButtons = [];
  if (onReset !== undefined) {
    actionButtons.push(
      React.createElement(
        "button",
        {
          key: "reset",
          onClick: onReset,
          style: DEV_TOOLBAR_BUTTON_STYLE,
          title: "Reset match to start",
          type: "button",
        },
        "Reset",
      ),
    );
  }
  if (onReturnToLobby !== undefined) {
    actionButtons.push(
      React.createElement(
        "button",
        {
          key: "return-to-lobby",
          onClick: onReturnToLobby,
          style: DEV_TOOLBAR_BUTTON_STYLE,
          title: "End match and return to lobby",
          type: "button",
        },
        "Back to lobby",
      ),
    );
  }
  if (onSave !== undefined) {
    actionButtons.push(
      React.createElement(
        "button",
        {
          key: "save",
          onClick: onSave,
          style: DEV_TOOLBAR_BUTTON_STYLE,
          title: "Save current match",
          type: "button",
        },
        "Save",
      ),
    );
  }
  if (onLoad !== undefined) {
    actionButtons.push(
      React.createElement(
        "button",
        {
          key: "load",
          onClick: onLoad,
          style: DEV_TOOLBAR_BUTTON_STYLE,
          title: "Load a saved match",
          type: "button",
        },
        "Load",
      ),
    );
  }

  return React.createElement(
    "div",
    { "data-openturn-dev-shell": "", style: DEV_SHELL_STYLE },
    React.createElement(
      "div",
      { "data-openturn-dev-toolbar": "", style: DEV_TOOLBAR_STYLE },
      React.createElement("strong", { style: DEV_TOOLBAR_TITLE_STYLE }, deployment.deploymentID),
      React.createElement("span", { "aria-live": "polite", style: DEV_TOOLBAR_PLAYER_STYLE }, statusLabel),
      ...actionButtons,
      React.createElement(
        "button",
        {
          "aria-pressed": inspectorEnabled,
          onClick: onToggleInspector,
          style: inspectorEnabled ? DEV_TOOLBAR_BUTTON_ACTIVE_STYLE : DEV_TOOLBAR_BUTTON_STYLE,
          title: "Inspector",
          type: "button",
        },
        "Inspector",
      ),
    ),
    React.createElement("div", { "data-openturn-dev-surface": "", style: DEV_SURFACE_STYLE }, surface),
  );
}

function readInitialInspectorEnabled() {
  const urlValue = readInspectorURLValue();

  if (urlValue !== null) {
    const enabled = urlValue === "1" || urlValue === "true" || urlValue === "on";
    writeInspectorEnabled(enabled);
    return enabled;
  }

  return window.localStorage.getItem(INSPECTOR_STORAGE_KEY) === "true";
}

function readInspectorURLValue() {
  const url = new URL(window.location.href);
  const queryValue = url.searchParams.get("inspector");

  if (queryValue !== null) {
    return queryValue;
  }

  return new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : url.hash).get("inspector");
}

function writeInspectorEnabled(enabled) {
  window.localStorage.setItem(INSPECTOR_STORAGE_KEY, enabled ? "true" : "false");
}

function useInspectorHotkey(toggle) {
  useEffect(() => {
    function onKeyDown(event) {
      if (event.defaultPrevented || !event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
        return;
      }
      if (event.key !== "i" && event.key !== "I") {
        return;
      }
      const target = event.target;
      if (target instanceof HTMLElement) {
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable) {
          return;
        }
      }
      event.preventDefault();
      toggle();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [toggle]);
}

let inspectorHintLogged = false;
function logInspectorHintOnce() {
  if (inspectorHintLogged) return;
  inspectorHintLogged = true;
  console.info("[openturn] Inspector available — toggle with the toolbar button or Alt+I.");
}

const DEV_SHELL_STYLE = {
  boxSizing: "border-box",
  display: "flex",
  flexDirection: "column",
  height: "100dvh",
  minHeight: 0,
  overflow: "hidden",
  width: "100%",
};
const DEV_TOOLBAR_STYLE = {
  alignItems: "center",
  background: "#ffffff",
  borderBottom: "1px solid #d9dee7",
  boxSizing: "border-box",
  display: "flex",
  flex: "0 0 auto",
  gap: "12px",
  minHeight: "44px",
  padding: "0 16px",
};
const DEV_TOOLBAR_TITLE_STYLE = {
  color: "#111827",
  fontFamily: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, \\"Segoe UI\\", sans-serif",
  fontSize: "13px",
};
const DEV_TOOLBAR_PLAYER_STYLE = {
  background: "#f3f4f6",
  border: "1px solid #e5e7eb",
  borderRadius: "999px",
  color: "#374151",
  fontFamily: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, \\"Segoe UI\\", sans-serif",
  fontSize: "12px",
  marginLeft: "auto",
  maxWidth: "50vw",
  overflow: "hidden",
  padding: "4px 9px",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};
const DEV_TOOLBAR_BUTTON_STYLE = {
  background: "#ffffff",
  border: "1px solid #d1d5db",
  borderRadius: "6px",
  color: "#4b5563",
  cursor: "pointer",
  fontFamily: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, \\"Segoe UI\\", sans-serif",
  fontSize: "13px",
  padding: "5px 9px",
};
const DEV_TOOLBAR_BUTTON_ACTIVE_STYLE = {
  ...DEV_TOOLBAR_BUTTON_STYLE,
  background: "#111827",
  borderColor: "#111827",
  color: "#ffffff",
};
const DEV_SURFACE_STYLE = {
  display: "flex",
  flexDirection: "column",
  flex: "1 1 auto",
  minHeight: 0,
  minWidth: 0,
  overflow: "hidden",
  width: "100%",
};
`;

  return `import React from "react";
import { createRoot } from "react-dom/client";
${devShellImports}import Page from ${JSON.stringify(pageSpecifier)};
import { game } from ${JSON.stringify(gameSpecifier)};

// Capacity for this game lives on game.playerIDs / game.minPlayers. The dev
// shell still needs a per-session match to seat players for local runtime;
// mirror playerIDs into a plain MatchInput shape for that path only.
const match = { players: game.playerIDs };

const deployment = {
  deploymentID: ${JSON.stringify(input.deploymentID)},
  projectID: ${JSON.stringify(input.projectID)},
  runtime: ${JSON.stringify(input.runtime)},
};

${sharedDevSetup}${localShellSetup}${multiplayerShellSetup}
const host = document.getElementById("openturn-root") ?? document.body.appendChild(document.createElement("div"));
host.setAttribute("data-openturn-host", "");
const mount = document.createElement("div");
mount.setAttribute("data-openturn-mount", "");
host.replaceChildren(mount);

Object.assign(window, {
  __OPENTURN_DEPLOYMENT__: deployment,
});

void game;
void match;

createRoot(mount).render(${renderExpression});
`;
}

function createDevHTML(input: { gameName: string }): string {
  const title = escapeHTML(input.gameName);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${title}</title>
    <style>
      html, body, #openturn-root { height: 100%; margin: 0; overflow: hidden; width: 100%; }
      [data-openturn-host], [data-openturn-mount] { height: 100%; min-height: 0; overflow: hidden; width: 100%; }
    </style>
  </head>
  <body>
    <div id="openturn-root"></div>
    <script type="module" src="/entry.tsx"></script>
  </body>
</html>
`;
}

function toModuleSpecifier(fromDirectory: string, path: string): string {
  const specifier = relative(fromDirectory, path).split("\\").join("/");
  return specifier.startsWith(".") ? specifier : `./${specifier}`;
}

function escapeHTML(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function findAvailablePort(): Promise<number> {
  return await new Promise((resolvePort, reject) => {
    const server = createNetServer();

    server.once("error", reject);
    server.listen(0, DEV_SERVER_HOST, () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      server.close((error) => {
        if (error !== undefined) {
          reject(error);
          return;
        }
        resolvePort(port);
      });
    });
  });
}
