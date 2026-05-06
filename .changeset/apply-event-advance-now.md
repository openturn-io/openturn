---
"@openturn/core": patch
"@openturn/replay": patch
---

Fix: `applyEvent` now stamps every action record with `Date.now()` and hops the in-flight snapshot's `meta.now` to that value before applying, so per-state `deadline: ctx => ctx.now + N` declarations recompute correctly per turn.

Previously, `meta.now` only ever advanced via `fireTimeout`'s explicit hop, so player events stamped `at = snapshot.meta.now` (which was frozen at `initialNow` after session creation). State-context evaluations during dispatch saw the same `ctx.now` for the entire game, producing one global deadline window from game-start instead of a fresh window per turn. User-visible symptom: in a 1-bot game with a 10-second turn timer, the bot's deliberation consumed the human player's clock — by turn 3 the player had no time left.

Replay determinism is preserved by a new `applyEventAt(playerID, event, at, ...payload)` method on `LocalGameSession` that takes an explicit `at`. The replay materializer in `@openturn/replay` switches to it, feeding recorded `at` values back in so any `ctx.now`-dependent resolver evaluation reproduces deterministically across replay runs.

JSON wire format unchanged: action records still have a `number` `at` field; snapshot `meta.now` is still a `number`. Replays of logs saved before this fix continue to materialize correctly — the recorded (frozen) `at` values feed back through `applyEventAt` and reproduce the exact state evolution the original session produced.
