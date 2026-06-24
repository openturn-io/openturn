# @openturn/lobby

## 0.9.0

### Patch Changes

- Updated dependencies [56b512e]
  - @openturn/core@0.9.0
  - @openturn/bot@0.9.0
  - @openturn/protocol@0.9.0
  - @openturn/server@0.9.0
  - @openturn/client@0.9.0

## 0.8.3

### Patch Changes

- @openturn/bot@0.8.3
- @openturn/client@0.8.3
- @openturn/core@0.8.3
- @openturn/protocol@0.8.3
- @openturn/server@0.8.3

## 0.8.2

### Patch Changes

- @openturn/bot@0.8.2
- @openturn/client@0.8.2
- @openturn/core@0.8.2
- @openturn/protocol@0.8.2
- @openturn/server@0.8.2

## 0.8.1

### Patch Changes

- Updated dependencies [ce2d094]
  - @openturn/server@0.8.1
  - @openturn/bot@0.8.1
  - @openturn/client@0.8.1
  - @openturn/core@0.8.1
  - @openturn/protocol@0.8.1

## 0.8.0

### Minor Changes

- a62cd82: Add `MatchInput.hostPlayerID` as the seated player who hosted the lobby that started a match, with `null` for single-player matches, spectating hosts, or absent hosts. The core runtime now normalizes and validates the field, exposes `isHost`, and threads the value into game setup and snapshots.

  Lobby and server start flows now resolve the host player ID at `lobby:start`, persist it into room metadata, and pass it into the running game match in both hosted worker and local CLI runtimes. Replay parsing now preserves and validates `hostPlayerID` from saved match envelopes.

- 056a3d8: Add a typed config schema declared on `GameDefinition.config` (peer to `profile?` and `bots?`) — number, boolean, and string-enum fields with defaults, labels, and bounds. Schema values are mutable in the lobby (host-only via the new `host:set_config` message), surfaced in `lobby:state.config.values` so non-host viewers see them, and locked into `match.config` at game-start. Three layers of validation reject invalid values: wire-time (`LobbyRuntime.setConfig`), lock-time (`start()` snapshot), and engine-time (`normalizeMatchInput` with default-fill for non-lobby callers).

  Game code reads typed values via `ctx.match.config.X` with full TS inference from the schema (`defineGame` overloads thread `TConfig` through). Successful `setConfig` mutations un-ready every human seat so players re-confirm settings before the host can start.

  Lobby React layer adds `<ConfigForm>` and an opt-in `configUI: "auto" | "none"` prop on `<Lobby>` and `<LobbyWithBots>` that auto-renders a settings section above the seat list — collapsible, default-expanded for host, disabled inputs for non-hosts. Per-field React overrides via the `configRenderers` map; built-in renderers for number (slider when bounded, stepper otherwise), boolean (checkbox), and enum (radio for ≤4 options, dropdown otherwise). `ConfigRenderers<TSchema>` provides per-field type-safe construction.

  Cloud worker, CLI dev shell, and local-lobby React hook all thread the resolved config through `LobbyStartResult` into the running runtime's match. Replay parser and zod `MatchInputSchema` round-trip `match.config` so persisted records and saved replays preserve it.

### Patch Changes

- Updated dependencies [ba64788]
- Updated dependencies [ba64788]
- Updated dependencies [a62cd82]
- Updated dependencies [056a3d8]
- Updated dependencies [da70cae]
  - @openturn/core@0.8.0
  - @openturn/server@0.8.0
  - @openturn/protocol@0.8.0
  - @openturn/bot@0.8.0
  - @openturn/client@0.8.0

## 0.7.0

### Patch Changes

- @openturn/bot@0.7.0
- @openturn/server@0.7.0
- @openturn/client@0.7.0
- @openturn/core@0.7.0
- @openturn/protocol@0.7.0

## 0.6.1

### Patch Changes

- @openturn/bot@0.6.1
- @openturn/client@0.6.1
- @openturn/core@0.6.1
- @openturn/protocol@0.6.1
- @openturn/server@0.6.1

## 0.6.0

### Minor Changes

- ffb51b3: Add `LobbyEnv.requireHumanSeat` so hosted lobbies reject all-bot starts with the new `no_humans_seated` rejection reason; the cloud worker enables it by default. The CLI dev server keeps it off so authors can dry-run bot-vs-bot matches: when the host starts a room with only bot seats, the dev server mints them a game token bound to seat 0's playerID and transitions them straight into the running match so they can watch the bots play out the game. (The host technically connects as player 0 — they shouldn't dispatch during a bot-vs-bot watch, but cloud doesn't expose this path.)

### Patch Changes

- Updated dependencies [ffb51b3]
  - @openturn/protocol@0.6.0
  - @openturn/server@0.6.0
  - @openturn/client@0.6.0
  - @openturn/bot@0.6.0
  - @openturn/core@0.6.0

## 0.5.0

### Minor Changes

- 43742b6: Fix same-tab play shell theme propagation so embedded dev bars and inspector chrome follow the selected dark theme, and keep the lobby React chrome fixed instead of accepting consumer skinning props (`Lobby` no longer accepts `className` or `renderSeat` — use `LobbyWithBots` for the bot-aware variant).

### Patch Changes

- @openturn/bot@0.5.0
- @openturn/client@0.5.0
- @openturn/core@0.5.0
- @openturn/protocol@0.5.0
- @openturn/server@0.5.0

## 0.4.0

### Patch Changes

- cd571a5: Keep the lobby bot assignment dropdown layered above adjacent seats and the host seat-count controls.
  - @openturn/bot@0.4.0
  - @openturn/client@0.4.0
  - @openturn/core@0.4.0
  - @openturn/protocol@0.4.0
  - @openturn/server@0.4.0

## 0.3.0

### Patch Changes

- 28b10a3: Widen the default lobby panel while keeping the round-table stage height-aware so seat controls do not crowd or overflow the viewport.
- Updated dependencies [910daa2]
  - @openturn/server@0.3.0
  - @openturn/bot@0.3.0
  - @openturn/client@0.3.0
  - @openturn/core@0.3.0
  - @openturn/protocol@0.3.0

## 0.2.3

### Patch Changes

- Updated dependencies [19ed132]
  - @openturn/server@0.2.3
  - @openturn/bot@0.2.3
  - @openturn/client@0.2.3
  - @openturn/core@0.2.3
  - @openturn/protocol@0.2.3

## 0.2.2

### Patch Changes

- @openturn/bot@0.2.2
- @openturn/client@0.2.2
- @openturn/core@0.2.2
- @openturn/protocol@0.2.2
- @openturn/server@0.2.2

## 0.2.1

### Patch Changes

- @openturn/bot@0.2.1
- @openturn/client@0.2.1
- @openturn/core@0.2.1
- @openturn/protocol@0.2.1
- @openturn/server@0.2.1

## 0.2.0

### Patch Changes

- @openturn/bot@0.2.0
- @openturn/client@0.2.0
- @openturn/core@0.2.0
- @openturn/protocol@0.2.0
- @openturn/server@0.2.0

## 0.1.1

### Patch Changes

- 8fe68eb: Replace `workspace:*` internal dependencies with concrete `^X.Y.Z` ranges so published tarballs install cleanly outside the monorepo. The 0.1.0 release shipped `workspace:*` literals into the npm registry, breaking external consumers.
- Updated dependencies [8fe68eb]
  - @openturn/bot@0.1.1
  - @openturn/client@0.1.1
  - @openturn/core@0.1.1
  - @openturn/protocol@0.1.1
  - @openturn/server@0.1.1

## 0.1.0

### Minor Changes

- 390a036: initial changeset release

### Patch Changes

- Updated dependencies [390a036]
  - @openturn/bot@0.1.0
  - @openturn/client@0.1.0
  - @openturn/core@0.1.0
  - @openturn/protocol@0.1.0
  - @openturn/server@0.1.0
