# @openturn/cli

## 0.2.3

### Patch Changes

- Updated dependencies [19ed132]
  - @openturn/deploy@0.2.3
  - @openturn/server@0.2.3
  - @openturn/bridge@0.2.3
  - @openturn/core@0.2.3
  - @openturn/inspector-ui@0.2.3
  - @openturn/json@0.2.3
  - @openturn/protocol@0.2.3
  - @openturn/react@0.2.3

## 0.2.2

### Patch Changes

- 507a1a5: Mark the CLI entrypoint executable in the published tarball so `bun install -g @openturn/cli` creates the `openturn` bin symlink. Bun's global installer silently skips bin linking when the target file isn't executable; npm/pnpm/yarn chmod automatically, which is why this only manifested on Bun.
- e7e9c70: Prefer the hosted play shell URL returned by openturn-cloud during deploys and derive multiplayer lobby capacity fallbacks from the game definition when bridge init data is zeroed.
- Updated dependencies [e7e9c70]
  - @openturn/react@0.2.2
  - @openturn/bridge@0.2.2
  - @openturn/core@0.2.2
  - @openturn/deploy@0.2.2
  - @openturn/inspector-ui@0.2.2
  - @openturn/json@0.2.2
  - @openturn/protocol@0.2.2
  - @openturn/server@0.2.2

## 0.2.1

### Patch Changes

- d0f00e9: Fix `openturn dev` exiting immediately after startup when telemetry is enabled. The dev command now waits for SIGINT/SIGTERM and stops the server cleanly on shutdown.
  - @openturn/bridge@0.2.1
  - @openturn/core@0.2.1
  - @openturn/deploy@0.2.1
  - @openturn/inspector-ui@0.2.1
  - @openturn/json@0.2.1
  - @openturn/protocol@0.2.1
  - @openturn/react@0.2.1
  - @openturn/server@0.2.1

## 0.2.0

### Patch Changes

- 8705cd5: Add the Bun shebang to the CLI entrypoint so package managers install the `openturn` binary correctly.
- Updated dependencies [6d74435]
  - @openturn/bridge@0.2.0
  - @openturn/inspector-ui@0.2.0
  - @openturn/react@0.2.0
  - @openturn/core@0.2.0
  - @openturn/deploy@0.2.0
  - @openturn/json@0.2.0
  - @openturn/protocol@0.2.0
  - @openturn/server@0.2.0

## 0.1.1

### Patch Changes

- 8fe68eb: Replace `workspace:*` internal dependencies with concrete `^X.Y.Z` ranges so published tarballs install cleanly outside the monorepo. The 0.1.0 release shipped `workspace:*` literals into the npm registry, breaking external consumers.
- Updated dependencies [8fe68eb]
  - @openturn/bridge@0.1.1
  - @openturn/core@0.1.1
  - @openturn/deploy@0.1.1
  - @openturn/inspector-ui@0.1.1
  - @openturn/json@0.1.1
  - @openturn/protocol@0.1.1
  - @openturn/react@0.1.1
  - @openturn/server@0.1.1

## 0.1.0

### Minor Changes

- 390a036: initial changeset release

### Patch Changes

- Updated dependencies [390a036]
  - @openturn/bridge@0.1.0
  - @openturn/core@0.1.0
  - @openturn/deploy@0.1.0
  - @openturn/inspector-ui@0.1.0
  - @openturn/json@0.1.0
  - @openturn/protocol@0.1.0
  - @openturn/react@0.1.0
  - @openturn/server@0.1.0
