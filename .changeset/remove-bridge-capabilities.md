---
"@openturn/bridge": minor
"@openturn/react": minor
---

Remove the runtime capability registration system. Games no longer advertise utilities to the shell via `bridge.capabilities.enable(...)` or the `useCapability(...)` hook — both APIs and all four built-in presets (`share-invite`, `current-turn`, `new-game`, `rules`) are gone. The shell's capability header buttons, overflow menu, and ⌘K command palette are removed; games that want in-frame UI render it inside their own iframe.

**Breaking**:
- Removed exports: `BRIDGE_CAPABILITY_PRESETS`, `BridgeCapabilityPreset`, `BridgeCapabilityDescriptor`, `BridgeCapabilityDescriptorSchema`, `BridgeCapabilityPresetMeta`, `BridgeCapabilitySlot`, `CapabilityRegistry`, `CapabilityRunner`, `CapabilityEnableOptions` (`@openturn/bridge`); `useCapability` (`@openturn/react`).
- Removed APIs: `bridge.capabilities`, `BridgeHost.invoke`, `BridgeHost.capabilities`, the `"capability-changed"` host event, and the four `openturn:bridge:capability-*` postMessage kinds.
- Removed UI: `CapabilityHeaderButtons`, `CapabilityOverflowMenu`, `CapabilityCommandPalette`, `useBridgeCapabilities`, and `disableCommandPalette` on `<PlayShell>`.

Games that previously used `useCapability("current-turn", ...)` should render the indicator inside their own UI; `share-invite` is now a host-implemented control (see the new shell-controls registry).
