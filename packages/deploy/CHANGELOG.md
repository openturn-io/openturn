# @openturn/deploy

## 0.6.0

### Patch Changes

- Updated dependencies [ffb51b3]
  - @openturn/protocol@0.6.0
  - @openturn/server@0.6.0
  - @openturn/core@0.6.0
  - @openturn/json@0.6.0
  - @openturn/manifest@0.6.0

## 0.5.0

### Minor Changes

- aad0ac5: Add bundle size limits and image asset support for `openturn deploy`. The CLI now (a) enables Vite's `public/` folder so static images can ship alongside imported assets, (b) records per-asset sizes in the deployment manifest, and (c) rejects oversized bundles before contacting the cloud (per-asset 25 MiB, total assets 25 MiB, total images 25 MiB, multiplayer worker 3 MiB gzipped). The cloud control plane re-validates the same limits as defense in depth.

### Patch Changes

- Updated dependencies [aad0ac5]
  - @openturn/manifest@0.5.0
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
  - @openturn/manifest@0.4.0
  - @openturn/core@0.4.0
  - @openturn/json@0.4.0
  - @openturn/protocol@0.4.0
  - @openturn/server@0.4.0

## 0.3.0

### Patch Changes

- Updated dependencies [910daa2]
  - @openturn/server@0.3.0
  - @openturn/core@0.3.0
  - @openturn/json@0.3.0
  - @openturn/manifest@0.3.0
  - @openturn/protocol@0.3.0

## 0.2.3

### Patch Changes

- 19ed132: Derive cloud worker lobby capacity from the deployed game definition so hosted lobby state preserves the declared player pool without injecting per-session match metadata.
- Updated dependencies [19ed132]
  - @openturn/server@0.2.3
  - @openturn/core@0.2.3
  - @openturn/json@0.2.3
  - @openturn/manifest@0.2.3
  - @openturn/protocol@0.2.3

## 0.2.2

### Patch Changes

- @openturn/core@0.2.2
- @openturn/json@0.2.2
- @openturn/manifest@0.2.2
- @openturn/protocol@0.2.2
- @openturn/server@0.2.2

## 0.2.1

### Patch Changes

- @openturn/core@0.2.1
- @openturn/json@0.2.1
- @openturn/manifest@0.2.1
- @openturn/protocol@0.2.1
- @openturn/server@0.2.1

## 0.2.0

### Patch Changes

- @openturn/core@0.2.0
- @openturn/json@0.2.0
- @openturn/manifest@0.2.0
- @openturn/protocol@0.2.0
- @openturn/server@0.2.0

## 0.1.1

### Patch Changes

- 8fe68eb: Replace `workspace:*` internal dependencies with concrete `^X.Y.Z` ranges so published tarballs install cleanly outside the monorepo. The 0.1.0 release shipped `workspace:*` literals into the npm registry, breaking external consumers.
- Updated dependencies [8fe68eb]
  - @openturn/core@0.1.1
  - @openturn/json@0.1.1
  - @openturn/manifest@0.1.1
  - @openturn/protocol@0.1.1
  - @openturn/server@0.1.1

## 0.1.0

### Minor Changes

- 390a036: initial changeset release

### Patch Changes

- Updated dependencies [390a036]
  - @openturn/core@0.1.0
  - @openturn/json@0.1.0
  - @openturn/manifest@0.1.0
  - @openturn/protocol@0.1.0
  - @openturn/server@0.1.0
