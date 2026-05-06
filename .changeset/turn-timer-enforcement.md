---
"@openturn/cli": minor
"@openturn/core": minor
"@openturn/gamekit": minor
"@openturn/protocol": minor
"@openturn/replay": minor
"@openturn/server": minor
---

Add server-authoritative turn-timer enforcement. When a state declares `deadline`, the server fires a trigger when wall-clock elapses; the game decides the response. Works the same in cloud DO (`ctx.storage.setAlarm` multiplexed with the existing idle-reap) and the CLI dev shell (`setTimeout` per `DeadlineKey`).

`GameTransitionConfig` is now a discriminated union with a new `kind: "timeout"` variant. Core games declare `transition({ kind: "timeout", from, to, resolve, turn? })`; the runtime fires it at the elapsed instant via the same dispatch path used for player events. The action log records timeout-dispatched events as `type: "internal"` with `playerID: null` and a `"__timeout"` sentinel event name (matches the existing `ProtocolInternalEventRecordSchema`). `LocalGameSession.fireTimeout(now?)` does an idempotency check, finds the matching transition with parent-fallback, applies it, and returns the resulting batch — so `RoomRuntime.fireTimeout()` emits the same `batch_applied` envelopes a regular event would.

Gamekit games declare `phase.onTimeout?: (ctx, moves) => MoveOutcome | null` directly on the phase config. The handler receives the same `ctx` and `moves` a regular move handler gets and returns the same `MoveOutcome` shape (`stay` / `goto` / `finish` / `null`); gamekit's `defineGame` synthesizes the underlying `kind: "timeout"` core transition during compilation and reuses the existing move-result interpreter. Validation throws at definition time if `onTimeout` is declared without `deadline`.

A new `DeadlineScheduler` interface (`@openturn/core`) decouples the host from the runtime. `RoomRuntime` accepts an optional `scheduler` and calls `setDeadline("turn-timeout", session.getNextDeadline())` after every event. The cloud DO worker implements it by persisting a `deadlines: { "turn-timeout"?, "idle-reap"? }` record in `ctx.storage`, recomputing `min()` for `setAlarm`, and forward-compat-handling persisted DOs that pre-date this deploy. The CLI dev shell implements it with in-memory `setTimeout` handles per key.

The replay parser now accepts `type: "internal"` records and re-fires `__timeout` records via `session.fireTimeout` during materialization, so saved replays of matches that include timeouts round-trip cleanly.
