---
"@openturn/cli": minor
"@openturn/core": minor
"@openturn/lobby": minor
"@openturn/protocol": minor
"@openturn/replay": minor
"@openturn/server": minor
---

Add a typed config schema declared on `GameDefinition.config` (peer to `profile?` and `bots?`) — number, boolean, and string-enum fields with defaults, labels, and bounds. Schema values are mutable in the lobby (host-only via the new `host:set_config` message), surfaced in `lobby:state.config.values` so non-host viewers see them, and locked into `match.config` at game-start. Three layers of validation reject invalid values: wire-time (`LobbyRuntime.setConfig`), lock-time (`start()` snapshot), and engine-time (`normalizeMatchInput` with default-fill for non-lobby callers).

Game code reads typed values via `ctx.match.config.X` with full TS inference from the schema (`defineGame` overloads thread `TConfig` through). Successful `setConfig` mutations un-ready every human seat so players re-confirm settings before the host can start.

Lobby React layer adds `<ConfigForm>` and an opt-in `configUI: "auto" | "none"` prop on `<Lobby>` and `<LobbyWithBots>` that auto-renders a settings section above the seat list — collapsible, default-expanded for host, disabled inputs for non-hosts. Per-field React overrides via the `configRenderers` map; built-in renderers for number (slider when bounded, stepper otherwise), boolean (checkbox), and enum (radio for ≤4 options, dropdown otherwise). `ConfigRenderers<TSchema>` provides per-field type-safe construction.

Cloud worker, CLI dev shell, and local-lobby React hook all thread the resolved config through `LobbyStartResult` into the running runtime's match. Replay parser and zod `MatchInputSchema` round-trip `match.config` so persisted records and saved replays preserve it.
