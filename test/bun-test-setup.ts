import { existsSync, mkdirSync, readdirSync, readFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { JSDOM } from "jsdom";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const workspacePackageRoots = collectWorkspacePackageRoots();

ensureWorkspacePackageLinks();
registerWorkspacePackageResolver();

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  pretendToBeVisual: true,
  url: "http://localhost/",
});

const { window } = dom;

const globalProperties = [
  "window",
  "self",
  "document",
  "navigator",
  "location",
  "history",
  "localStorage",
  "sessionStorage",
  "Node",
  "Text",
  "Element",
  "HTMLElement",
  "HTMLAnchorElement",
  "HTMLButtonElement",
  "HTMLInputElement",
  "HTMLSelectElement",
  "HTMLTextAreaElement",
  "SVGElement",
  "Document",
  "DocumentFragment",
  "MutationObserver",
  "Event",
  "EventTarget",
  "CustomEvent",
  "MessageEvent",
  "KeyboardEvent",
  "MouseEvent",
  "FocusEvent",
  "InputEvent",
  "DOMParser",
  "getComputedStyle",
] as const;

for (const property of globalProperties) {
  const value = property === "self" ? window : window[property];

  Object.defineProperty(globalThis, property, {
    configurable: true,
    value,
    writable: true,
  });
}

window.fetch = globalThis.fetch.bind(globalThis);
window.Headers = globalThis.Headers;
window.Request = globalThis.Request;
window.Response = globalThis.Response;

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function registerWorkspacePackageResolver(): void {
  Bun.plugin({
    name: "openturn-bun-test-workspace-resolver",
    setup(build) {
      build.onResolve({ filter: /^@openturn\/[^/]+(?:\/.*)?$/u }, (args) => {
        const [scope, name, ...subpath] = args.path.split("/");
        const packageRoot = workspacePackageRoots.get(`${scope}/${name}`);

        if (packageRoot === undefined) {
          return undefined;
        }

        if (subpath.length === 0) {
          return {
            path: join(packageRoot, "src", "index.ts"),
          };
        }

        return {
          path: join(packageRoot, "src", `${subpath.join("/")}.ts`),
        };
      });
    },
  });
}

function ensureWorkspacePackageLinks(): void {
  const scopedDirectory = join(repoRoot, "node_modules", "@openturn");
  mkdirSync(scopedDirectory, { recursive: true });

  for (const [packageName, packageRoot] of workspacePackageRoots) {
    const linkPath = join(repoRoot, "node_modules", packageName);

    if (!existsSync(linkPath)) {
      symlinkSync(packageRoot, linkPath, "dir");
    }
  }
}

function collectWorkspacePackageRoots(): Map<string, string> {
  const packageRoots = new Map<string, string>();

  collectWorkspacePackageRootsFromDirectory(packageRoots, join(repoRoot, "packages"));
  collectWorkspacePackageRootsFromDirectory(packageRoots, join(repoRoot, "examples"), 2);

  return packageRoots;
}

function collectWorkspacePackageRootsFromDirectory(
  packageRoots: Map<string, string>,
  directory: string,
  depth = 1,
): void {
  if (!existsSync(directory)) {
    return;
  }

  if (depth === 0) {
    const manifestPath = join(directory, "package.json");

    if (existsSync(manifestPath)) {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { name?: unknown };

      if (typeof manifest.name === "string") {
        packageRoots.set(manifest.name, directory);
      }
    }

    return;
  }

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      collectWorkspacePackageRootsFromDirectory(packageRoots, join(directory, entry.name), depth - 1);
    }
  }
}
