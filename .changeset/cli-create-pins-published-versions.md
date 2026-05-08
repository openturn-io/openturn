---
"@openturn/cli": patch
---

Fix `openturn create` to scaffold new projects with a concrete `^x.y.z` semver range (matching the CLI's own published version) for `@openturn/core`, `@openturn/gamekit`, `@openturn/react`, and `@openturn/cli` instead of `workspace:*`. Previously, running `bunx @openturn/cli create <name>` from inside the openturn monorepo tree stamped `workspace:*` into the new project's `package.json`, so `bun install` failed with `Workspace dependency "@openturn/cli" not found`. Scaffolded projects are now portable regardless of where the CLI is invoked from.
