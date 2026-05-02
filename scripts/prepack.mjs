#!/usr/bin/env node
// Runs from the cwd of the package being packed (npm sets cwd = package dir).
// Merges `publishConfig` into the top-level fields so the tarball ships with
// dist-pointing exports/main/types/bin. The release script restores the
// dev-paths package.json via `git restore` after `changeset publish` finishes
// — npm publish reads its registry metadata from on-disk package.json AFTER
// pack, so the modified file must remain in place through publish.
import { readFileSync, writeFileSync } from "node:fs";

const pkgPath = "package.json";

const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
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
