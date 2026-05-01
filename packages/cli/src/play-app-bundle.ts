// Builds the React-based dev play shell into an in-memory bundle. The Bun
// dev server serves this bundle at `/__openturn/play-app/main.js`. We use
// Bun.build instead of Vite because the play app is a CLI-shipped fixed
// React entry — no per-deployment HMR is needed, and the result is cached
// for the CLI process lifetime.

import { fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";

interface PlayAppBundle {
  js: string;
  jsContentType: "text/javascript; charset=utf-8";
}

let cached: Promise<PlayAppBundle> | null = null;
let cachedTailwind: string | null = null;

const PLAY_APP_RESOLVED_DEPENDENCIES = new Map(
  [
    "react",
    "react/jsx-runtime",
    "react/jsx-dev-runtime",
    "react-dom/client",
    "zod",
  ].map((specifier) => [
    specifier,
    fileURLToPath(import.meta.resolve(specifier)),
  ]),
);

export function getDevPlayAppBundle(): Promise<PlayAppBundle> {
  if (cached === null) {
    // Clear the cache on rejection so the next request retries instead of
    // permanently serving a stale failure for the lifetime of the process.
    cached = buildBundle().catch((error) => {
      cached = null;
      throw error;
    });
  }
  return cached;
}

/**
 * Returns the bytes of `@tailwindcss/browser`'s IIFE bundle, served at
 * `/__openturn/play-app/tailwind.js`. Self-hosted (resolved from local
 * node_modules) so the dev shell works offline and isn't pinned to a
 * third-party CDN.
 */
export function getDevPlayAppTailwind(): string {
  if (cachedTailwind === null) {
    const path = fileURLToPath(import.meta.resolve("@tailwindcss/browser"));
    cachedTailwind = readFileSync(path, "utf8");
  }
  return cachedTailwind;
}

async function buildBundle(): Promise<PlayAppBundle> {
  const packageRoot = fileURLToPath(new URL("..", import.meta.url));
  const sourceEntry = fileURLToPath(new URL("./play-app/main.tsx", import.meta.url));
  const builtEntry = fileURLToPath(new URL("./play-app/main.js", import.meta.url));
  const entry = existsSync(sourceEntry) ? sourceEntry : builtEntry;
  const result = await Bun.build({
    entrypoints: [entry],
    root: packageRoot,
    target: "browser",
    format: "esm",
    minify: false,
    sourcemap: "inline",
    splitting: false,
    plugins: [
      {
        name: "openturn-play-app-dependencies",
        setup(build) {
          build.onResolve(
            { filter: /^(react|react\/jsx-runtime|react\/jsx-dev-runtime|react-dom\/client|zod)$/ },
            ({ path }) => {
              const resolved = PLAY_APP_RESOLVED_DEPENDENCIES.get(path);
              return resolved === undefined ? undefined : { path: resolved };
            },
          );
        },
      },
    ],
    define: {
      "process.env.NODE_ENV": JSON.stringify("development"),
    },
  });

  if (!result.success) {
    const messages = result.logs.map((log) => log.message).join("\n");
    throw new Error(`Failed to bundle dev play shell:\n${messages}`);
  }

  const output = result.outputs[0];
  if (output === undefined) {
    throw new Error("Dev play shell bundle produced no outputs");
  }

  const js = await output.text();
  return { js, jsContentType: "text/javascript; charset=utf-8" };
}
