# @openturn/cli

## 0.5.0

### Minor Changes

- aad0ac5: Add bundle size limits and image asset support for `openturn deploy`. The CLI now (a) enables Vite's `public/` folder so static images can ship alongside imported assets, (b) records per-asset sizes in the deployment manifest, and (c) rejects oversized bundles before contacting the cloud (per-asset 25 MiB, total assets 25 MiB, total images 25 MiB, multiplayer worker 3 MiB gzipped). The cloud control plane re-validates the same limits as defense in depth.

### Patch Changes

- 2389816: Pin drizzle-orm to 1.0.0-rc.1.
- ea887a0: Stop the dev shell theme styles from overriding game document backgrounds, preserving example-specific surfaces such as Splendor's green felt gradient.
- c6b1ef8: Remove the Inspector tip line from `openturn dev` project startup logs.
- 9876f69: Preserve the lobby-start player roster when resetting active dev rooms.
- e6c6181: Print only the canonical Play URL when `openturn dev` starts a project server.
- Updated dependencies [aad0ac5]
- Updated dependencies [43742b6]
  - @openturn/deploy@0.5.0
  - @openturn/bridge@0.5.0
  - @openturn/inspector-ui@0.5.0
  - @openturn/react@0.5.0
  - @openturn/core@0.5.0
  - @openturn/json@0.5.0
  - @openturn/protocol@0.5.0
  - @openturn/server@0.5.0

## 0.4.0

### Minor Changes

- f9930a5: Introduce an adapter-driven shell controls system. The play shell renders Save / Load / Reset / Back to lobby / Copy Invite / public rooms / visibility toggle from a single registry, gated by a new manifest field that lets game authors opt out per control.

  **`@openturn/manifest`**

  - New `SHELL_CONTROL_IDS` const tuple — the canonical id list (`save`, `load`, `reset`, `returnToLobby`, `copyInvite`, `publicRooms`, `visibilityToggle`). The `OpenturnShellControl` type and `OpenturnShellControlsConfigSchema` are derived from it.
  - New `OpenturnDeploymentManifest.shellControls?` field. `false` opts out of a control even if the host adapter supports it; `undefined` defaults to "render when supported".

  **`@openturn/bridge`**

  - New `SHELL_CONTROLS` registry binds each manifest id to its backing adapter method, label, placement (`toolbar-trail` / `toolbar-lead` / `lobby-section`), and `requiresMatchActive` flag. A `satisfies Record<OpenturnShellControl, ShellControlMeta>` constraint locks the registry in step with the manifest.
  - New `isShellControlEnabled(adapter, id)` helper — single source of truth for shell gating. `<PlayPage>` derives all rendering from the registry.
  - New `host.emitShellControl(control, phase)` and `bridge.shellControl.on(listener)` for one-way host → game notifications around shell-driven adapter calls. Phases are `"before"` / `"after"`. Events fired before the iframe finishes loading are buffered and replayed once the bridge channel is established.
  - `BridgeShellControl` is an open `string` on the wire (capped at 64 chars, control ids are camelCase, e.g. `"returnToLobby"` / `"copyInvite"`). Hosts can fire arbitrary control ids without bumping the bridge schema; older games safely ignore unknown ids.
  - New `isKnownShellControl(id)` runtime narrowing helper for games that want to switch on a closed set of control ids.
  - New `TrailShellControl` type — toolbar-trail-placement subset of `OpenturnShellControl`. Used to enforce exhaustive trail-handler maps at compile time.
  - New `PlayShellAdapterMeta.shellControls?` carries the manifest opt-out config into the shell.

  **`@openturn/cli`**

  - The dev play shell threads `manifest.shellControls` from `manifest.json` through to the dev adapter, so `openturn play` honours per-control opt-outs. The opt-out config flows through `LocalDevServerOptions` using `OpenturnShellControlsConfig` from `@openturn/manifest` (re-exported via `@openturn/deploy`).

  **`@openturn/deploy`**

  - Re-export `OpenturnShellControlsConfig` so local tooling can type shell-control opt-out config through the deployment package.

### Patch Changes

- Updated dependencies [f9930a5]
- Updated dependencies [f9930a5]
  - @openturn/bridge@0.4.0
  - @openturn/react@0.4.0
  - @openturn/deploy@0.4.0
  - @openturn/inspector-ui@0.4.0
  - @openturn/core@0.4.0
  - @openturn/json@0.4.0
  - @openturn/protocol@0.4.0
  - @openturn/server@0.4.0

## 0.3.0

### Minor Changes

- c3e9159: Share the React play shell between the CLI dev server and hosted shells, exposing the shared play adapter types from `@openturn/bridge` and serving the CLI play app bundle from the local dev server.

### Patch Changes

- Updated dependencies [a65c92d]
- Updated dependencies [c3e9159]
- Updated dependencies [910daa2]
  - @openturn/bridge@0.3.0
  - @openturn/server@0.3.0
  - @openturn/inspector-ui@0.3.0
  - @openturn/react@0.3.0
  - @openturn/core@0.3.0
  - @openturn/deploy@0.3.0
  - @openturn/json@0.3.0
  - @openturn/protocol@0.3.0

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
