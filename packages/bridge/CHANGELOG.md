# @openturn/bridge

## 0.6.1

### Patch Changes

- @openturn/client@0.6.1
- @openturn/json@0.6.1
- @openturn/manifest@0.6.1

## 0.6.0

### Patch Changes

- ffb51b3: Force the play shell iframe to remount when the bridge host changes by keying it on `host.src`. Browsers don't reload an iframe on hash-only `src` updates, so without the key the bundle would keep running with stale init after `returnToLobby` (game→lobby) instead of re-reading the fresh fragment.
  - @openturn/client@0.6.0
  - @openturn/json@0.6.0
  - @openturn/manifest@0.6.0

## 0.5.0

### Minor Changes

- 43742b6: Fix same-tab play shell theme propagation so embedded dev bars and inspector chrome follow the selected dark theme, and keep the lobby React chrome fixed instead of accepting consumer skinning props (`Lobby` no longer accepts `className` or `renderSeat` — use `LobbyWithBots` for the bot-aware variant).

### Patch Changes

- Updated dependencies [aad0ac5]
  - @openturn/manifest@0.5.0
  - @openturn/client@0.5.0
  - @openturn/json@0.5.0

## 0.4.0

### Minor Changes

- f9930a5: Remove the runtime capability registration system. Games no longer advertise utilities to the shell via `bridge.capabilities.enable(...)` or the `useCapability(...)` hook — both APIs and all four built-in presets (`share-invite`, `current-turn`, `new-game`, `rules`) are gone. The shell's capability header buttons, overflow menu, and ⌘K command palette are removed; games that want in-frame UI render it inside their own iframe.

  **Breaking**:

  - Removed exports: `BRIDGE_CAPABILITY_PRESETS`, `BridgeCapabilityPreset`, `BridgeCapabilityDescriptor`, `BridgeCapabilityDescriptorSchema`, `BridgeCapabilityPresetMeta`, `BridgeCapabilitySlot`, `CapabilityRegistry`, `CapabilityRunner`, `CapabilityEnableOptions` (`@openturn/bridge`); `useCapability` (`@openturn/react`).
  - Removed APIs: `bridge.capabilities`, `BridgeHost.invoke`, `BridgeHost.capabilities`, the `"capability-changed"` host event, and the four `openturn:bridge:capability-*` postMessage kinds.
  - Removed UI: `CapabilityHeaderButtons`, `CapabilityOverflowMenu`, `CapabilityCommandPalette`, `useBridgeCapabilities`, and `disableCommandPalette` on `<PlayShell>`.

  Games that previously used `useCapability("current-turn", ...)` should render the indicator inside their own UI; `share-invite` is now a host-implemented control (see the new shell-controls registry).

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
  - @openturn/client@0.4.0
  - @openturn/json@0.4.0

## 0.3.0

### Minor Changes

- c3e9159: Share the React play shell between the CLI dev server and hosted shells, exposing the shared play adapter types from `@openturn/bridge` and serving the CLI play app bundle from the local dev server.

### Patch Changes

- a65c92d: Rename the play shell invite action to Copy Invite, show a sonner success toast after copying, and let player seat badges wrap cleanly in crowded room toolbars.
  - @openturn/client@0.3.0
  - @openturn/json@0.3.0

## 0.2.3

### Patch Changes

- @openturn/client@0.2.3
- @openturn/json@0.2.3

## 0.2.2

### Patch Changes

- @openturn/client@0.2.2
- @openturn/json@0.2.2

## 0.2.1

### Patch Changes

- @openturn/client@0.2.1
- @openturn/json@0.2.1

## 0.2.0

### Minor Changes

- 6d74435: Add `@openturn/bridge/shell` entry point that exports `PlayShell`, the React component used to host a deployed bundle in a browser shell. The package now declares `react@^19.2.0` as an optional peer dependency, so existing non-React consumers (`/host`, `/game`) are unaffected.

### Patch Changes

- @openturn/client@0.2.0
- @openturn/json@0.2.0

## 0.1.1

### Patch Changes

- 8fe68eb: Replace `workspace:*` internal dependencies with concrete `^X.Y.Z` ranges so published tarballs install cleanly outside the monorepo. The 0.1.0 release shipped `workspace:*` literals into the npm registry, breaking external consumers.
- Updated dependencies [8fe68eb]
  - @openturn/client@0.1.1
  - @openturn/json@0.1.1

## 0.1.0

### Minor Changes

- 390a036: initial changeset release

### Patch Changes

- Updated dependencies [390a036]
  - @openturn/client@0.1.0
  - @openturn/json@0.1.0
