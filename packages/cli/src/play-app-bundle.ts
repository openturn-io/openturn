// Builds the React-based dev play shell into an in-memory bundle. The Bun
// dev server serves this bundle at `/__openturn/play-app/main.js`. We use
// Bun.build instead of Vite because the play app is a CLI-shipped fixed
// React entry — no per-deployment HMR is needed, and the result is cached
// for the CLI process lifetime.

import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

interface PlayAppBundle {
  js: string;
  jsContentType: "text/javascript; charset=utf-8";
}

let cached: Promise<PlayAppBundle> | null = null;

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
    cached = buildBundle();
  }
  return cached;
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
