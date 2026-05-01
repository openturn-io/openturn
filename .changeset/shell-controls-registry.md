---
"@openturn/bridge": minor
"@openturn/cli": minor
"@openturn/manifest": minor
---

Introduce an adapter-driven shell controls system. The play shell renders Save / Load / Reset / Back to lobby / Copy Invite / public rooms / visibility toggle from a single registry, gated by a new manifest field that lets game authors opt out per control.

**`@openturn/manifest`**
- New `SHELL_CONTROL_IDS` const tuple — the canonical id list (`save`, `load`, `reset`, `returnToLobby`, `copyInvite`, `publicRooms`, `visibilityToggle`). The `OpenturnShellControl` type and `OpenturnShellControlsConfigSchema` are derived from it.
- New `OpenturnDeploymentManifest.shellControls?` field. `false` opts out of a control even if the host adapter supports it; `undefined` defaults to "render when supported".

**`@openturn/bridge`**
- New `SHELL_CONTROLS` registry binds each manifest id to its backing adapter method, label, placement (`toolbar-trail` / `toolbar-lead` / `lobby-section`), and `requiresMatchActive` flag. A `satisfies Record<OpenturnShellControl, ShellControlMeta>` constraint locks the registry in step with the manifest.
- New `isShellControlEnabled(adapter, id)` helper — single source of truth for shell gating. `<PlayPage>` derives all rendering from the registry.
- New `host.emitShellControl(control, phase)` and `bridge.shellControl.on(listener)` for one-way host → game notifications around shell-driven adapter calls. Phases are `"before"` / `"after"`.
- `BridgeShellControl` is now an open `string` on the wire (control ids are camelCase, e.g. `"returnToLobby"` / `"copyInvite"`). Hosts can fire arbitrary control ids without bumping the bridge schema; older games safely ignore unknown ids.
- New `PlayShellAdapterMeta.shellControls?` carries the manifest opt-out config into the shell.

**`@openturn/cli`**
- The dev play shell threads `manifest.shellControls` from `manifest.json` through to the dev adapter, so `openturn play` honours per-control opt-outs.
- New `DevShellControlsConfig` type exposed via `LocalDevServerOptions` for hosts that embed the dev server.
