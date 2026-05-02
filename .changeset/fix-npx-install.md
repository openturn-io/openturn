---
"@openturn/cli": patch
---

Fix `npx @openturn/cli` and `bun install -g @openturn/cli` failing to expose a working `openturn` binary.

Two unrelated bugs landed together in 0.6.0:

- **Registry metadata pointed at the wrong file.** The `prepack`/`postpack` script pair merged `publishConfig` (with `dist/` paths) into `package.json` for `npm pack`, then restored the dev-mode `src/` paths immediately after. But `npm publish` reads the registry-bound metadata from on-disk `package.json` *after* `postpack` runs, so the registry received `bin: 'src/index.ts'` — a path that isn't shipped in the tarball. npm install silently skipped creating `node_modules/.bin/openturn`. Fix: drop the per-package `postpack`, leave the `prepack`-modified `package.json` in place through `npm publish`, and restore via `git restore packages/*/package.json` in the root `release` script after `changeset publish` finishes.

- **`drizzle-orm` peer-dep conflict.** `@openturn/cli` pinned `drizzle-orm: 1.0.0-rc.1` while `@better-auth/drizzle-adapter` peers against `^0.45.2`. The pin worked inside this monorepo because of a root `overrides` field, but `overrides` doesn't apply to standalone consumers. Under npm's hoisting, `@better-auth/drizzle-adapter` ended up at the install root with no resolvable `drizzle-orm`, breaking the dev server's first import. Fix: downgrade to `drizzle-orm: ^0.45.2` (the cli only uses `and`/`eq`/`drizzle/bun-sqlite`/`sqliteTable`/`text`/`integer`, all stable across 0.45.x → 1.0) and remove the now-unnecessary root override.
