# @openturn/gamekit

## 0.8.3

### Patch Changes

- @openturn/core@0.8.3
- @openturn/json@0.8.3

## 0.8.2

### Patch Changes

- @openturn/core@0.8.2
- @openturn/json@0.8.2

## 0.8.1

### Patch Changes

- @openturn/core@0.8.1
- @openturn/json@0.8.1

## 0.8.0

### Minor Changes

- ba64788: Two TypeScript tightenings for games that declare a config schema:

  `GameDefinition.config` is now non-undefined when declared. Previously, accessing `game.config` after `defineGame({ config: { ... } })` typed as `Schema | undefined` — consumers like `<LobbyWithBots configSchema={game.config}>` had to use `game.config!` to satisfy the prop's `ConfigSchema` type. The interface now uses a conditional `ConfigFieldFor<TConfig>` that narrows: when `TConfig extends ConfigSchema`, the field is required and typed as the narrow schema; when `TConfig` is `undefined` (default), the field is absent. Games without `config` keep working unchanged; games that declare it can now pass `game.config` directly without `!`.

  Gamekit `phases:` accepts a callback form for typed `phase.onTimeout` dispatch:

  ```ts
  defineGame({
    moves: ({ move }) => ({ place: move.exec({ args: { x: number }, ... }) }),
    phases: ({ moves }) => ({           // NEW callback form
      play: {
        deadline: ctx => deadline.after(ctx, ctx.match.config.turnTimeoutMs),
        onTimeout: (ctx, moves) => moves.place({ x: 5 }),  // typed dispatch
      },
    }),
  });
  ```

  The existing object-literal form (`phases: { play: { ... } }`) continues to work unchanged. The callback form gets typed `BoundPhaseMoves<TMoves>` because TypeScript resolves the `moves:` field's return type before evaluating the callback. Games that pair `phase.onTimeout` with the inline-callback `moves:` factory and want compile-time arg validation should adopt the callback `phases:` form.

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
  - @openturn/json@0.8.0

## 0.7.0

### Minor Changes

- 2cabc4f: Remove move-level `canPlayer` predicates from gamekit and plugin move definitions. Turn-based gating now relies on the engine's `activePlayers` dispatch gate for standard round-robin turns, and games or plugins with custom rules should reject from `run` with `move.invalid(...)` or a plugin invalid outcome.

  Update `openturn create` starters from the counter demo to a styled tic-tac-toe game, including Tailwind CSS setup and multiplayer room UI.

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
