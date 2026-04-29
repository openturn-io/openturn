#!/usr/bin/env node
// Restores package.json from the backup left by prepack.mjs and removes the
// backup file. Runs from the cwd of the package being packed.
import { readFileSync, writeFileSync, existsSync, unlinkSync } from "node:fs";

const pkgPath = "package.json";
const bakPath = ".package.json.prepack.bak";

if (!existsSync(bakPath)) {
  process.exit(0);
}

const original = readFileSync(bakPath, "utf8");
writeFileSync(pkgPath, original);
unlinkSync(bakPath);
