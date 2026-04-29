#!/usr/bin/env node
// Runs from the cwd of the package being packed (npm sets cwd = package dir).
// Backs up package.json to .package.json.prepack.bak, then merges
// `publishConfig` into the top-level fields so the tarball ships with
// dist-pointing exports/main/types/bin while dev keeps src-pointing fields.
// `postpack.mjs` restores the original.
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const pkgPath = "package.json";
const bakPath = ".package.json.prepack.bak";

const original = readFileSync(pkgPath, "utf8");
if (existsSync(bakPath)) {
  // Defensive: a previous postpack didn't run. Don't double-backup over the
  // original — keep the existing .bak (which is the true original).
} else {
  writeFileSync(bakPath, original);
}

const pkg = JSON.parse(original);
const overrides = pkg.publishConfig ?? {};

// publishConfig fields that npm itself consumes at publish time (not as
// package metadata) — keep them inside publishConfig.
const publishOnlyKeys = new Set(["access", "registry", "tag", "provenance"]);

const merged = { ...pkg };
for (const [key, value] of Object.entries(overrides)) {
  if (publishOnlyKeys.has(key)) continue;
  merged[key] = value;
}
// Trim publishConfig down to the publish-only fields so consumers don't see
// dist-pointing paths a second time (and so npm still applies access/provenance).
const trimmedPublishConfig = {};
for (const [key, value] of Object.entries(overrides)) {
  if (publishOnlyKeys.has(key)) trimmedPublishConfig[key] = value;
}
if (Object.keys(trimmedPublishConfig).length > 0) {
  merged.publishConfig = trimmedPublishConfig;
} else {
  delete merged.publishConfig;
}

writeFileSync(pkgPath, `${JSON.stringify(merged, null, 2)}\n`);
