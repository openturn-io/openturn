# @openturn/react

## 0.8.0

### Minor Changes

- ba64788: Add a server-authoritative turn-timer countdown to the play shell, plus a hook for game authors who want custom in-iframe UI.

  `<PlayShell>` (used by both the CLI dev shell and the cloud play page) auto-mounts a compact `<TurnCountdown>` in its toolbar trail. The countdown shows `m:ss` with an urgent red state when remaining time is under 5 seconds and is hidden entirely when no deadline is active. Embedders can suppress it with `showTurnCountdown={false}` and mount `<TurnCountdown host={host}>` themselves elsewhere.

  A new bridge protocol message `openturn:bridge:deadline` propagates the current `controlMeta.deadline` from the game iframe to the shell. `BridgeHost` gains a `deadline: number | null` readonly field and a `deadline-changed` event with de-dupe (mirrors the existing `matchActive` / `match-state-changed` pattern). `GameBridge.setDeadline(deadline)` is the iframe-side emit method; `<OpenturnProvider>` in `@openturn/react` calls it whenever the snapshot's `controlMeta.deadline` changes (de-duped at both ends so unchanged values don't churn the bridge channel).

  For game authors writing custom in-iframe UI (urgent flashes, "5s left!" alerts, animated displays), `useTurnDeadline()` in `@openturn/react` returns `{ deadline, remainingMs, isExpired }` derived from `useMatch()`'s current snapshot. The shell-side equivalent `useTurnDeadline(host)` in `@openturn/bridge` returns the same shape from a `BridgeHost`. Both hooks tick at 1 Hz baseline, ramping to 10 Hz when remaining time drops below 5 seconds; each tick recomputes from `Date.now()` so tab-visibility throttling self-corrects on foreground.

  **Deploy ordering note:** the new `openturn:bridge:deadline` message is added to `BridgeMessageSchema`'s discriminated union. Older host shells (built against pre-fix `@openturn/bridge`) parsing messages from a newer iframe game will reject the unknown variant. Deploy the host shell at the same time as or ahead of game iframes; the iframe's `setDeadline` calls are idempotent and silently swallowed if the host is older.

### Patch Changes

- Updated dependencies [ba64788]
- Updated dependencies [ba64788]
- Updated dependencies [a62cd82]
- Updated dependencies [056a3d8]
- Updated dependencies [ba64788]
- Updated dependencies [da70cae]
  - @openturn/core@0.8.0
  - @openturn/replay@0.8.0
  - @openturn/lobby@0.8.0
  - @openturn/protocol@0.8.0
  - @openturn/bridge@0.8.0
  - @openturn/bot@0.8.0
  - @openturn/inspector@0.8.0
  - @openturn/client@0.8.0

## 0.7.0

### Patch Changes

- @openturn/bot@0.7.0
- @openturn/inspector@0.7.0
- @openturn/lobby@0.7.0
- @openturn/replay@0.7.0
- @openturn/bridge@0.7.0
- @openturn/client@0.7.0
- @openturn/core@0.7.0
- @openturn/protocol@0.7.0

## 0.6.1

### Patch Changes

- @openturn/bot@0.6.1
- @openturn/bridge@0.6.1
- @openturn/client@0.6.1
- @openturn/core@0.6.1
- @openturn/inspector@0.6.1
- @openturn/lobby@0.6.1
- @openturn/protocol@0.6.1
- @openturn/replay@0.6.1

## 0.6.0

### Patch Changes

- Updated dependencies [ffb51b3]
- Updated dependencies [ffb51b3]
  - @openturn/bridge@0.6.0
  - @openturn/protocol@0.6.0
  - @openturn/lobby@0.6.0
  - @openturn/client@0.6.0
  - @openturn/inspector@0.6.0
  - @openturn/bot@0.6.0
  - @openturn/core@0.6.0
  - @openturn/replay@0.6.0

## 0.5.0

### Patch Changes

- Updated dependencies [43742b6]
  - @openturn/bridge@0.5.0
  - @openturn/lobby@0.5.0
  - @openturn/bot@0.5.0
  - @openturn/client@0.5.0
  - @openturn/core@0.5.0
  - @openturn/inspector@0.5.0
  - @openturn/protocol@0.5.0
  - @openturn/replay@0.5.0

## 0.4.0

### Minor Changes

- f9930a5: Remove the runtime capability registration system. Games no longer advertise utilities to the shell via `bridge.capabilities.enable(...)` or the `useCapability(...)` hook — both APIs and all four built-in presets (`share-invite`, `current-turn`, `new-game`, `rules`) are gone. The shell's capability header buttons, overflow menu, and ⌘K command palette are removed; games that want in-frame UI render it inside their own iframe.

  **Breaking**:

  - Removed exports: `BRIDGE_CAPABILITY_PRESETS`, `BridgeCapabilityPreset`, `BridgeCapabilityDescriptor`, `BridgeCapabilityDescriptorSchema`, `BridgeCapabilityPresetMeta`, `BridgeCapabilitySlot`, `CapabilityRegistry`, `CapabilityRunner`, `CapabilityEnableOptions` (`@openturn/bridge`); `useCapability` (`@openturn/react`).
  - Removed APIs: `bridge.capabilities`, `BridgeHost.invoke`, `BridgeHost.capabilities`, the `"capability-changed"` host event, and the four `openturn:bridge:capability-*` postMessage kinds.
  - Removed UI: `CapabilityHeaderButtons`, `CapabilityOverflowMenu`, `CapabilityCommandPalette`, `useBridgeCapabilities`, and `disableCommandPalette` on `<PlayShell>`.

  Games that previously used `useCapability("current-turn", ...)` should render the indicator inside their own UI; `share-invite` is now a host-implemented control (see the new shell-controls registry).

### Patch Changes

- Updated dependencies [cd571a5]
- Updated dependencies [f9930a5]
- Updated dependencies [f9930a5]
  - @openturn/lobby@0.4.0
  - @openturn/bridge@0.4.0
  - @openturn/bot@0.4.0
  - @openturn/client@0.4.0
  - @openturn/core@0.4.0
  - @openturn/inspector@0.4.0
  - @openturn/protocol@0.4.0
  - @openturn/replay@0.4.0

## 0.3.0

### Patch Changes

- Updated dependencies [a65c92d]
- Updated dependencies [28b10a3]
- Updated dependencies [c3e9159]
  - @openturn/bridge@0.3.0
  - @openturn/lobby@0.3.0
  - @openturn/bot@0.3.0
  - @openturn/client@0.3.0
  - @openturn/core@0.3.0
  - @openturn/inspector@0.3.0
  - @openturn/protocol@0.3.0
  - @openturn/replay@0.3.0

## 0.2.3

### Patch Changes

- @openturn/bot@0.2.3
- @openturn/bridge@0.2.3
- @openturn/client@0.2.3
- @openturn/core@0.2.3
- @openturn/inspector@0.2.3
- @openturn/lobby@0.2.3
- @openturn/protocol@0.2.3
- @openturn/replay@0.2.3

## 0.2.2

### Patch Changes

- e7e9c70: Prefer the hosted play shell URL returned by openturn-cloud during deploys and derive multiplayer lobby capacity fallbacks from the game definition when bridge init data is zeroed.
  - @openturn/bot@0.2.2
  - @openturn/bridge@0.2.2
  - @openturn/client@0.2.2
  - @openturn/core@0.2.2
  - @openturn/inspector@0.2.2
  - @openturn/lobby@0.2.2
  - @openturn/protocol@0.2.2
  - @openturn/replay@0.2.2

## 0.2.1

### Patch Changes

- @openturn/bot@0.2.1
- @openturn/bridge@0.2.1
- @openturn/client@0.2.1
- @openturn/core@0.2.1
- @openturn/inspector@0.2.1
- @openturn/lobby@0.2.1
- @openturn/protocol@0.2.1
- @openturn/replay@0.2.1

## 0.2.0

### Patch Changes

- Updated dependencies [6d74435]
  - @openturn/bridge@0.2.0
  - @openturn/bot@0.2.0
  - @openturn/client@0.2.0
  - @openturn/core@0.2.0
  - @openturn/inspector@0.2.0
  - @openturn/lobby@0.2.0
  - @openturn/protocol@0.2.0
  - @openturn/replay@0.2.0

## 0.1.1

### Patch Changes

- 8fe68eb: Replace `workspace:*` internal dependencies with concrete `^X.Y.Z` ranges so published tarballs install cleanly outside the monorepo. The 0.1.0 release shipped `workspace:*` literals into the npm registry, breaking external consumers.
- Updated dependencies [8fe68eb]
  - @openturn/bot@0.1.1
  - @openturn/bridge@0.1.1
  - @openturn/client@0.1.1
  - @openturn/core@0.1.1
  - @openturn/inspector@0.1.1
  - @openturn/lobby@0.1.1
  - @openturn/protocol@0.1.1
  - @openturn/replay@0.1.1

## 0.1.0

### Minor Changes

- 390a036: initial changeset release

### Patch Changes

- Updated dependencies [390a036]
  - @openturn/bot@0.1.0
  - @openturn/bridge@0.1.0
  - @openturn/client@0.1.0
  - @openturn/core@0.1.0
  - @openturn/inspector@0.1.0
  - @openturn/lobby@0.1.0
  - @openturn/protocol@0.1.0
  - @openturn/replay@0.1.0
