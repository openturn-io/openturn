# @openturn/server

## 0.8.3

### Patch Changes

- @openturn/bot@0.8.3
- @openturn/core@0.8.3
- @openturn/json@0.8.3
- @openturn/protocol@0.8.3

## 0.8.2

### Patch Changes

- @openturn/bot@0.8.2
- @openturn/core@0.8.2
- @openturn/json@0.8.2
- @openturn/protocol@0.8.2

## 0.8.1

### Patch Changes

- ce2d094: Fix Cloudflare Worker turn-timeout alarms so cold Durable Object wakes rehydrate the game runtime, broadcast timeout deliveries, tick bots, and arm initial turn deadlines from lobby start time.
  - @openturn/bot@0.8.1
  - @openturn/core@0.8.1
  - @openturn/json@0.8.1
  - @openturn/protocol@0.8.1

## 0.8.0

### Minor Changes

- a62cd82: Add `MatchInput.hostPlayerID` as the seated player who hosted the lobby that started a match, with `null` for single-player matches, spectating hosts, or absent hosts. The core runtime now normalizes and validates the field, exposes `isHost`, and threads the value into game setup and snapshots.

  Lobby and server start flows now resolve the host player ID at `lobby:start`, persist it into room metadata, and pass it into the running game match in both hosted worker and local CLI runtimes. Replay parsing now preserves and validates `hostPlayerID` from saved match envelopes.

- 056a3d8: Add a typed config schema declared on `GameDefinition.config` (peer to `profile?` and `bots?`) — number, boolean, and string-enum fields with defaults, labels, and bounds. Schema values are mutable in the lobby (host-only via the new `host:set_config` message), surfaced in `lobby:state.config.values` so non-host viewers see them, and locked into `match.config` at game-start. Three layers of validation reject invalid values: wire-time (`LobbyRuntime.setConfig`), lock-time (`start()` snapshot), and engine-time (`normalizeMatchInput` with default-fill for non-lobby callers).

  Game code reads typed values via `ctx.match.config.X` with full TS inference from the schema (`defineGame` overloads thread `TConfig` through). Successful `setConfig` mutations un-ready every human seat so players re-confirm settings before the host can start.

  Lobby React layer adds `<ConfigForm>` and an opt-in `configUI: "auto" | "none"` prop on `<Lobby>` and `<LobbyWithBots>` that auto-renders a settings section above the seat list — collapsible, default-expanded for host, disabled inputs for non-hosts. Per-field React overrides via the `configRenderers` map; built-in renderers for number (slider when bounded, stepper otherwise), boolean (checkbox), and enum (radio for ≤4 options, dropdown otherwise). `ConfigRenderers<TSchema>` provides per-field type-safe construction.

  Cloud worker, CLI dev shell, and local-lobby React hook all thread the resolved config through `LobbyStartResult` into the running runtime's match. Replay parser and zod `MatchInputSchema` round-trip `match.config` so persisted records and saved replays preserve it.

- da70cae: Add server-authoritative turn-timer enforcement. When a state declares `deadline`, the server fires a trigger when wall-clock elapses; the game decides the response. Works the same in cloud DO (`ctx.storage.setAlarm` multiplexed with the existing idle-reap) and the CLI dev shell (`setTimeout` per `DeadlineKey`).

  `GameTransitionConfig` is now a discriminated union with a new `kind: "timeout"` variant. Core games declare `transition({ kind: "timeout", from, to, resolve, turn? })`; the runtime fires it at the elapsed instant via the same dispatch path used for player events. The action log records timeout-dispatched events as `type: "internal"` with `playerID: null` and a `"__timeout"` sentinel event name (matches the existing `ProtocolInternalEventRecordSchema`). `LocalGameSession.fireTimeout(now?)` does an idempotency check, finds the matching transition with parent-fallback, applies it, and returns the resulting batch — so `RoomRuntime.fireTimeout()` emits the same `batch_applied` envelopes a regular event would.

  Gamekit games declare `phase.onTimeout?: (ctx, moves) => MoveOutcome | null` directly on the phase config. The handler receives the same `ctx` and `moves` a regular move handler gets and returns the same `MoveOutcome` shape (`stay` / `goto` / `finish` / `null`); gamekit's `defineGame` synthesizes the underlying `kind: "timeout"` core transition during compilation and reuses the existing move-result interpreter. Validation throws at definition time if `onTimeout` is declared without `deadline`.

  A new `DeadlineScheduler` interface (`@openturn/core`) decouples the host from the runtime. `RoomRuntime` accepts an optional `scheduler` and calls `setDeadline("turn-timeout", session.getNextDeadline())` after every event. The cloud DO worker implements it by persisting a `deadlines: { "turn-timeout"?, "idle-reap"? }` record in `ctx.storage`, recomputing `min()` for `setAlarm`, and forward-compat-handling persisted DOs that pre-date this deploy. The CLI dev shell implements it with in-memory `setTimeout` handles per key.

  The replay parser now accepts `type: "internal"` records and re-fires `__timeout` records via `session.fireTimeout` during materialization, so saved replays of matches that include timeouts round-trip cleanly.

### Patch Changes

- Updated dependencies [ba64788]
- Updated dependencies [ba64788]
- Updated dependencies [a62cd82]
- Updated dependencies [056a3d8]
- Updated dependencies [da70cae]
  - @openturn/core@0.8.0
  - @openturn/protocol@0.8.0
  - @openturn/bot@0.8.0
  - @openturn/json@0.8.0

## 0.7.0

### Patch Changes

- @openturn/bot@0.7.0
- @openturn/core@0.7.0
- @openturn/json@0.7.0
- @openturn/protocol@0.7.0

## 0.6.1

### Patch Changes

- @openturn/bot@0.6.1
- @openturn/core@0.6.1
- @openturn/json@0.6.1
- @openturn/protocol@0.6.1

## 0.6.0

### Minor Changes

- ffb51b3: Add `LobbyEnv.requireHumanSeat` so hosted lobbies reject all-bot starts with the new `no_humans_seated` rejection reason; the cloud worker enables it by default. The CLI dev server keeps it off so authors can dry-run bot-vs-bot matches: when the host starts a room with only bot seats, the dev server mints them a game token bound to seat 0's playerID and transitions them straight into the running match so they can watch the bots play out the game. (The host technically connects as player 0 — they shouldn't dispatch during a bot-vs-bot watch, but cloud doesn't expose this path.)

### Patch Changes

- Updated dependencies [ffb51b3]
  - @openturn/protocol@0.6.0
  - @openturn/bot@0.6.0
  - @openturn/core@0.6.0
  - @openturn/json@0.6.0

## 0.5.0

### Patch Changes

- @openturn/bot@0.5.0
- @openturn/core@0.5.0
- @openturn/json@0.5.0
- @openturn/protocol@0.5.0

## 0.4.0

### Patch Changes

- @openturn/bot@0.4.0
- @openturn/core@0.4.0
- @openturn/json@0.4.0
- @openturn/protocol@0.4.0

## 0.3.0

### Patch Changes

- 910daa2: Rehydrate cloud-hosted bot drivers from persisted active lobby seats whenever a game message arrives without an in-memory driver — both after Durable Object hibernation and on first message after `loadLobby`. Also exports `resolveBotMapFromSeats` and `BotSeatRecordShape` for callers that need to derive a bot map from persisted seats.
  - @openturn/bot@0.3.0
  - @openturn/core@0.3.0
  - @openturn/json@0.3.0
  - @openturn/protocol@0.3.0

## 0.2.3

### Patch Changes

- 19ed132: Derive cloud worker lobby capacity from the deployed game definition so hosted lobby state preserves the declared player pool without injecting per-session match metadata.
  - @openturn/bot@0.2.3
  - @openturn/core@0.2.3
  - @openturn/json@0.2.3
  - @openturn/protocol@0.2.3

## 0.2.2

### Patch Changes

- @openturn/bot@0.2.2
- @openturn/core@0.2.2
- @openturn/json@0.2.2
- @openturn/protocol@0.2.2

## 0.2.1

### Patch Changes

- @openturn/bot@0.2.1
- @openturn/core@0.2.1
- @openturn/json@0.2.1
- @openturn/protocol@0.2.1

## 0.2.0

### Patch Changes

- @openturn/bot@0.2.0
- @openturn/core@0.2.0
- @openturn/json@0.2.0
- @openturn/protocol@0.2.0

## 0.1.1

### Patch Changes

- 8fe68eb: Replace `workspace:*` internal dependencies with concrete `^X.Y.Z` ranges so published tarballs install cleanly outside the monorepo. The 0.1.0 release shipped `workspace:*` literals into the npm registry, breaking external consumers.
- Updated dependencies [8fe68eb]
  - @openturn/bot@0.1.1
  - @openturn/core@0.1.1
  - @openturn/json@0.1.1
  - @openturn/protocol@0.1.1

## 0.1.0

### Minor Changes

- 390a036: initial changeset release

### Patch Changes

- Updated dependencies [390a036]
  - @openturn/bot@0.1.0
  - @openturn/core@0.1.0
  - @openturn/json@0.1.0
  - @openturn/protocol@0.1.0
