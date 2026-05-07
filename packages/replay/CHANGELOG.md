# @openturn/replay

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

- ba64788: Fix: `applyEvent` now stamps every action record with `Date.now()` and hops the in-flight snapshot's `meta.now` to that value before applying, so per-state `deadline: ctx => ctx.now + N` declarations recompute correctly per turn.

  Previously, `meta.now` only ever advanced via `fireTimeout`'s explicit hop, so player events stamped `at = snapshot.meta.now` (which was frozen at `initialNow` after session creation). State-context evaluations during dispatch saw the same `ctx.now` for the entire game, producing one global deadline window from game-start instead of a fresh window per turn. User-visible symptom: in a 1-bot game with a 10-second turn timer, the bot's deliberation consumed the human player's clock — by turn 3 the player had no time left.

  Replay determinism is preserved by a new `applyEventAt(playerID, event, at, ...payload)` method on `LocalGameSession` that takes an explicit `at`. The replay materializer in `@openturn/replay` switches to it, feeding recorded `at` values back in so any `ctx.now`-dependent resolver evaluation reproduces deterministically across replay runs.

  JSON wire format unchanged: action records still have a `number` `at` field; snapshot `meta.now` is still a `number`. Replays of logs saved before this fix continue to materialize correctly — the recorded (frozen) `at` values feed back through `applyEventAt` and reproduce the exact state evolution the original session produced.

  **Behavioral change to flag for game authors:** `ctx.now` inside transition resolvers, state-context functions, view functions, and gamekit move handlers now reflects the actual wall-clock instant of the dispatching event instead of being frozen at session creation. Most games that don't read `ctx.now` are unaffected. Games that timestamp values in `G` from `ctx.now` will now record real-time progression instead of game-start. This is the intended behavior for the per-turn deadline feature, but worth auditing if a game previously relied on `ctx.now` being stable.

  The server's `replayIntoSession` (used on DO cold-start when restoring from persisted state) and `@openturn/replay`'s `materializeReplay` both switch to `applyEventAt` so restored sessions carry the original recorded `at` values rather than being re-stamped with the cold-start wall-clock.

- Updated dependencies [ba64788]
- Updated dependencies [ba64788]
- Updated dependencies [a62cd82]
- Updated dependencies [056a3d8]
- Updated dependencies [da70cae]
  - @openturn/core@0.8.0
  - @openturn/json@0.8.0

## 0.7.0

### Patch Changes

- @openturn/core@0.7.0
- @openturn/json@0.7.0

## 0.6.1

### Patch Changes

- @openturn/core@0.6.1
- @openturn/json@0.6.1

## 0.6.0

### Patch Changes

- @openturn/core@0.6.0
- @openturn/json@0.6.0

## 0.5.0

### Patch Changes

- @openturn/core@0.5.0
- @openturn/json@0.5.0

## 0.4.0

### Patch Changes

- @openturn/core@0.4.0
- @openturn/json@0.4.0

## 0.3.0

### Patch Changes

- @openturn/core@0.3.0
- @openturn/json@0.3.0

## 0.2.3

### Patch Changes

- @openturn/core@0.2.3
- @openturn/json@0.2.3

## 0.2.2

### Patch Changes

- @openturn/core@0.2.2
- @openturn/json@0.2.2

## 0.2.1

### Patch Changes

- @openturn/core@0.2.1
- @openturn/json@0.2.1

## 0.2.0

### Patch Changes

- @openturn/core@0.2.0
- @openturn/json@0.2.0

## 0.1.1

### Patch Changes

- 8fe68eb: Replace `workspace:*` internal dependencies with concrete `^X.Y.Z` ranges so published tarballs install cleanly outside the monorepo. The 0.1.0 release shipped `workspace:*` literals into the npm registry, breaking external consumers.
- Updated dependencies [8fe68eb]
  - @openturn/core@0.1.1
  - @openturn/json@0.1.1

## 0.1.0

### Minor Changes

- 390a036: initial changeset release

### Patch Changes

- Updated dependencies [390a036]
  - @openturn/core@0.1.0
  - @openturn/json@0.1.0
