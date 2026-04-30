---
"@openturn/cli": patch
---

Mark the CLI entrypoint executable in the published tarball so `bun install -g @openturn/cli` creates the `openturn` bin symlink. Bun's global installer silently skips bin linking when the target file isn't executable; npm/pnpm/yarn chmod automatically, which is why this only manifested on Bun.
