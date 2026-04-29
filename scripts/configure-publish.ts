#!/usr/bin/env bun
/**
 * One-shot bootstrap: rewrites every packages/* /package.json so the package is
 * publishable to npm. Idempotent — safe to re-run if the layout changes.
 *
 * Strategy: leave top-level `exports` / `main` / `types` / `bin` pointing at
 * source (./src/*.ts(x)) so monorepo dev / typecheck still works without a
 * build, and put dist-pointing overrides under `publishConfig`. npm merges
 * `publishConfig` into the published manifest, so consumers see the dist paths.
 *
 * What it does, per package:
 *   - removes `private: true`
 *   - adds Apache-2.0 license / repository / homepage / bugs metadata
 *   - adds `publishConfig` with { access, provenance, exports, main, module, types, bin } overrides
 *   - leaves the existing src-pointing exports/main/types/bin alone for dev
 *   - adds `files: ["dist", "README.md", "LICENSE", "NOTICE"]`
 *   - adds `build` + `prepublishOnly` scripts
 *
 * inspector-ui's `build` script is overridden separately (CSS imports — needs Vite).
 */
import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";

const REPO_URL = "https://github.com/openturn-io/openturn";
const PACKAGES_DIR = new URL("../packages", import.meta.url).pathname;

type PkgJson = {
  name: string;
  version: string;
  private?: boolean;
  type?: string;
  bin?: Record<string, string> | string;
  exports?: Record<string, string | Record<string, string>>;
  main?: string;
  module?: string;
  types?: string;
  files?: string[];
  scripts?: Record<string, string>;
  license?: string;
  repository?: unknown;
  homepage?: string;
  bugs?: unknown;
  publishConfig?: Record<string, unknown>;
  [k: string]: unknown;
};

function rewriteJsPath(src: string): string {
  return src.replace(/^\.\/src\//, "./dist/").replace(/\.tsx?$/, ".js");
}

function rewriteDtsPath(src: string): string {
  return src.replace(/^\.\/src\//, "./dist/").replace(/\.tsx?$/, ".d.ts");
}

function buildPublishExports(
  exports: Record<string, string | Record<string, string>>,
): Record<string, { types: string; import: string }> {
  const out: Record<string, { types: string; import: string }> = {};
  for (const [key, value] of Object.entries(exports)) {
    const src = typeof value === "string" ? value : (value.import ?? value.default ?? "");
    if (!src) continue;
    out[key] = {
      types: rewriteDtsPath(src),
      import: rewriteJsPath(src),
    };
  }
  return out;
}

function transform(folder: string, pkg: PkgJson): PkgJson {
  delete pkg.private;

  pkg.license = "Apache-2.0";
  pkg.repository = {
    type: "git",
    url: `git+${REPO_URL}.git`,
    directory: `packages/${folder}`,
  };
  pkg.homepage = `${REPO_URL}/tree/main/packages/${folder}#readme`;
  pkg.bugs = { url: `${REPO_URL}/issues` };

  // publishConfig: overrides applied only when npm packs the tarball.
  // Lets dev keep using ./src/*.ts while consumers get ./dist/*.js + .d.ts.
  const publishConfig: Record<string, unknown> = {
    access: "public",
    provenance: true,
    main: "./dist/index.js",
    module: "./dist/index.js",
    types: "./dist/index.d.ts",
  };

  if (pkg.exports && typeof pkg.exports === "object") {
    publishConfig.exports = buildPublishExports(pkg.exports);
  }

  if (pkg.bin) {
    if (typeof pkg.bin === "string") {
      publishConfig.bin = rewriteJsPath(pkg.bin);
    } else {
      const rewrittenBin: Record<string, string> = {};
      for (const [name, path] of Object.entries(pkg.bin)) {
        rewrittenBin[name] = rewriteJsPath(path);
      }
      publishConfig.bin = rewrittenBin;
    }
  }

  pkg.publishConfig = publishConfig;
  pkg.files = ["dist", "README.md", "LICENSE", "NOTICE"];

  pkg.scripts = pkg.scripts ?? {};
  if (!pkg.scripts.build || pkg.scripts.build.startsWith("tsc")) {
    pkg.scripts.build = "tsc -p tsconfig.build.json";
  }
  pkg.scripts.prepublishOnly = "bun run build";
  // npm calls prepack/postpack around `npm pack` and `npm publish`. We use
  // these to swap publishConfig overrides into the top-level fields of the
  // packed manifest, so consumers see ./dist paths even though the working
  // tree keeps ./src paths for monorepo dev.
  pkg.scripts.prepack = "node ../../scripts/prepack.mjs";
  pkg.scripts.postpack = "node ../../scripts/postpack.mjs";

  return pkg;
}

const folders = readdirSync(PACKAGES_DIR).filter((f) =>
  statSync(join(PACKAGES_DIR, f)).isDirectory(),
);

for (const folder of folders) {
  const pkgPath = join(PACKAGES_DIR, folder, "package.json");
  const raw = readFileSync(pkgPath, "utf8");
  const pkg = JSON.parse(raw) as PkgJson;
  if (!pkg.name?.startsWith("@openturn/")) continue;
  const updated = transform(folder, pkg);
  writeFileSync(pkgPath, `${JSON.stringify(updated, null, 2)}\n`);
  console.log(`updated ${pkg.name}`);
}
