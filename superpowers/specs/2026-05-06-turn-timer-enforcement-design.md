# Turn Timer Enforcement — Design

**Date:** 2026-05-06
**Status:** Approved for implementation
**Scope:** Slice B of a thread (Slice A `hostPlayerID` shipped; Slice C `match.config` shipped). This slice depends on Slice C — the canonical use case is `state.deadline = ctx => deadline.after(ctx, ctx.match.config.turnTimeoutMs)`.

## Goal

When a state declares a `deadline`, fire a server-authoritative trigger when wall-clock elapses past it. Let the game decide the response — via `transition({ kind: "timeout", ... })` at the core layer or `phase.onTimeout` at the gamekit layer. Works the same in cloud DO and CLI dev shell.

The runtime contributes the **trigger**; the game contributes the **response**. No defaults, no validation warnings, no helpers — at either layer.

This slice is bundled across both `@openturn/core` and `@openturn/gamekit` so authors at the dominant gamekit surface get the feature day one without dropping into core's vocabulary.

## Non-Goals

- Runtime-picked default behaviors for unhandled timeouts (skip / forfeit / random).
- Per-player deadlines (one deadline per state, applies to whoever is active).
- Mid-state deadline updates without a state transition.
- Reconnect grace windows.
- Round-level / match-level timers.
- Inspector / replay metadata distinguishing timeout-dispatched vs player-dispatched events.
- Ergonomic helpers like `timeoutSkip()` or `timeoutRandom()`.

These are deferable. The primitives below support them as future extensions.

## Design

### 1. Trigger mechanism — discriminated transition

`GameTransitionConfig` becomes a discriminated union:

```ts
export type GameTransitionConfig<...> =
  | GameEventTransition<...>      // existing — keyed by event name
  | GameTimeoutTransition<...>;   // new — fires on deadline elapsed

interface GameEventTransition<...> {
  event: keyof TEvents & string;
  from: TNode;
  to: TNode;
  resolve?: GameTransitionResolver<...>;
  turn?: "increment" | "preserve";
  label?: string;
}

interface GameTimeoutTransition<...> {
  kind: "timeout";
  from: TNode;
  to: TNode;
  resolve?: GameTransitionResolver<...>;
  turn?: "increment" | "preserve";
  label?: string;
}
```

Game code:

```ts
transition({
  kind: "timeout",
  from: "playing",
  to: "playing",
  resolve: (ctx) => {
    const actions = ctx.legalActions();
    return actions[Math.floor(ctx.rng() * actions.length)];
  },
  turn: "increment",
});
```

The `resolve` shape and execution context are identical to event-driven transitions. `ctx.legalActions()` and `ctx.rng()` (already exposed for the bot system) compose for "random legal action" patterns; the resolver may return any typed game event input or `null`.

**Matching rules:**
- When the runtime fires a timeout, it searches for a `kind: "timeout"` transition whose `from` matches the current state, with parent-fallback per existing transition matching rules.
- If exactly one matches, the runtime applies it through the same dispatch path as event-driven transitions.
- If none matches, the runtime no-ops. Game stalls. (Author's choice; explicit handling required.)
- If multiple match (e.g., parent and child both declare timeout transitions), the most-specific match wins, mirroring how event transitions resolve today.

The `events: keyof TEvents & string` constraint on event-driven transitions remains untouched. Games that don't use timeouts see no API change.

### 2. Scheduler abstraction

Core defines an interface; hosts implement.

```ts
// in @openturn/core
export type DeadlineKey = "turn-timeout" | "idle-reap";

export interface DeadlineScheduler {
  /** Set or update a named deadline. `at: null` clears it. */
  setDeadline(key: DeadlineKey, at: number | null): void;
}
```

Core stays scheduler-agnostic. After every move/event handled by `RoomRuntime` (including timeout-fired ones), the runtime reads the new snapshot's `controlMeta.deadline` and calls `scheduler.setDeadline("turn-timeout", deadline)` — passing `null` when no deadline is declared. The host implementation owns whatever wall-clock mechanism it has access to (`setAlarm`, `setTimeout`, etc).

When a host's underlying timer fires the `"turn-timeout"` deadline, the host calls `runtime.fireTimeout()`. Core checks idempotency, looks up the matching `kind: "timeout"` transition, and applies it. The result triggers another `setDeadline` call (potentially `null` if the new state has no deadline).

### 3. Cloud DO scheduler implementation

Two persisted timestamps in `ctx.storage`. The DO already has a `setAlarm` slot used today for idle-reap; this slice generalizes that into a multiplexer.

**Storage shape:**
```ts
type DeadlinesRecord = Partial<Record<DeadlineKey, number>>;
const DEADLINES_KEY = "deadlines";
```

**Setting a deadline:**
```ts
async setDeadline(key: DeadlineKey, at: number | null) {
  const stored = (await this.ctx.storage.get<DeadlinesRecord>(DEADLINES_KEY)) ?? {};
  if (at === null) delete stored[key];
  else stored[key] = at;
  await this.ctx.storage.put(DEADLINES_KEY, stored);

  const next = minDeadline(stored);
  if (next === null) {
    await this.ctx.storage.deleteAlarm();
  } else {
    await this.ctx.storage.setAlarm(next);
  }
}

function minDeadline(record: DeadlinesRecord): number | null {
  const values = Object.values(record).filter((v): v is number => v !== undefined);
  return values.length === 0 ? null : Math.min(...values);
}
```

**Alarm handler:**
```ts
async alarm() {
  const now = Date.now();
  const stored = (await this.ctx.storage.get<DeadlinesRecord>(DEADLINES_KEY)) ?? {};

  const elapsed: DeadlineKey[] = [];
  for (const [key, at] of Object.entries(stored) as Array<[DeadlineKey, number]>) {
    if (at <= now) {
      elapsed.push(key);
      delete stored[key];
    }
  }
  await this.ctx.storage.put(DEADLINES_KEY, stored);

  for (const key of elapsed) await this.dispatchDeadline(key);

  // Re-arm in case dispatchDeadline added new deadlines.
  const refreshed = (await this.ctx.storage.get<DeadlinesRecord>(DEADLINES_KEY)) ?? {};
  const next = minDeadline(refreshed);
  if (next !== null) await this.ctx.storage.setAlarm(next);
}

async dispatchDeadline(key: DeadlineKey) {
  if (key === "idle-reap") { /* existing reap logic, factored out */ }
  if (key === "turn-timeout") {
    if (this.#runtime !== null) await this.#runtime.fireTimeout();
    // fireTimeout calls setDeadline internally to re-arm if a new deadline emerges
  }
}
```

**Idempotency** lives in `runtime.fireTimeout()` — it re-reads the current snapshot, only fires if `controlMeta.deadline !== null && controlMeta.deadline <= now`. Otherwise no-op. This guards against alarms in flight for stale deadlines (player moved at t=29.95 but t=30 alarm was already in queue).

**Migration:** the existing idle-reap stores its timestamp implicitly via `setAlarm` (no separate key). On first deploy, persisted DOs that were rehydrated under the old scheme have no `DEADLINES_KEY`; the new code reads `{}` and re-arms `idle-reap` on the next event. The previous in-flight `setAlarm` value, if any, fires once with the old `alarm()` handler — but that handler is being replaced. **The new `alarm()` handler is forward-compatible**: when it fires for an old DO with no `deadlines` record, it sees `stored = {}`, no elapsed deadlines, no dispatch, and re-arms only if there's a new record (which there won't be unless a fresh event creates one). Net effect: in-flight legacy alarms are silently absorbed; the new system takes over from the next event.

To keep idle-reap behavior identical, every DO event handler that today calls `scheduleIdleReap()` will instead call `scheduler.setDeadline("idle-reap", Date.now() + idleReapMs)`.

### 4. CLI scheduler implementation

Single-process Node/Bun, in-memory `setTimeout` handles per key.

```ts
class CliScheduler implements DeadlineScheduler {
  #handles = new Map<DeadlineKey, NodeJS.Timeout>();
  #onDispatch: (key: DeadlineKey) => Promise<void>;

  constructor(onDispatch: (key: DeadlineKey) => Promise<void>) {
    this.#onDispatch = onDispatch;
  }

  setDeadline(key: DeadlineKey, at: number | null): void {
    const existing = this.#handles.get(key);
    if (existing !== undefined) clearTimeout(existing);
    this.#handles.delete(key);
    if (at === null) return;
    const ms = Math.max(0, at - Date.now());
    const handle = setTimeout(() => {
      this.#handles.delete(key);
      void this.#onDispatch(key);
    }, ms);
    this.#handles.set(key, handle);
  }
}
```

The CLI dev shell already has idle-reap logic; this absorbs it. The dev shell wires `onDispatch` to call `runtime.fireTimeout()` for `"turn-timeout"` and the existing reap logic for `"idle-reap"`.

### 5. Edge case behaviors (locked)

| Case | Behavior |
|---|---|
| Simultaneous active players | One deadline fires for the state. Resolver inspects existing control state (who has/hasn't moved) and decides what to do for each. Game owns the per-player logic. |
| Player disconnects mid-turn | Timer keeps running. No pause, no grace. |
| Reconnect mid-turn | Player picks up wherever the clock is. |
| Alarm fires fractionally after a state-advancing move | `runtime.fireTimeout()` re-reads snapshot; if `controlMeta.deadline` is no longer at-or-before `now`, no-ops. |
| State entry sets the timer | `controlMeta.deadline` is computed at state entry as it already is. RoomRuntime calls `setDeadline("turn-timeout", deadline)` after every event. |
| Active player is a bot | Same rules apply. No special case for bot-controlled active players. |
| State has `deadline` but no matching `kind: "timeout"` transition | Runtime fires; no transition matches; game stalls. Author's choice. |
| Game ends (terminal state) | Terminal states have no `deadline`; `setDeadline("turn-timeout", null)` clears the alarm. |
| Multi-deadline race (turn-timeout AND idle-reap elapsed at the same alarm tick) | Both dispatch in `alarm()`, in iteration order of `Object.entries`. Order doesn't matter for correctness — each dispatch is independent. |
| Active state not in the running phase (lobby phase, etc.) | No `state.deadline` is computed (the state machine is not running yet); `setDeadline` is never called with a non-null turn-timeout. |

### 6. Replay and determinism

Timeout-dispatched events go into the action log as normal events. No `cause: "timeout"` metadata field in v1 (could be added later for inspector polish).

Determinism follows from the existing model: the log captures the resolved event verbatim. On replay, the engine applies actions from the log; the timeout-fire mechanism does not re-run. RNG used inside a `kind: "timeout"` resolver consumes the same seed as in live play because the resolver runs once at fire-time and its output is logged.

This means **replays are time-independent**: a replay 24 hours later that doesn't actually wait 30 seconds still produces identical state, because the action log carries the resolver's output, not just "timeout fired here."

### 7. Game-author API surface (full)

#### Core layer (`@openturn/core`)

```ts
defineGame({
  // ...
  config: {
    turnTimeoutMs: { type: "number", default: 30_000, min: 5_000, max: 300_000, label: "Turn time" },
  } as const satisfies ConfigSchema,
  states: {
    playing: {
      deadline: (ctx) => deadline.after(ctx, ctx.match.config.turnTimeoutMs),
      activePlayers: (ctx) => [currentPlayer(ctx)],
    },
    "game-over": { activePlayers: () => [] },
  },
  transitions: [
    transition({ event: "place", from: "playing", to: "playing", turn: "increment", resolve: ... }),
    transition({
      kind: "timeout",
      from: "playing",
      to: "playing",
      turn: "increment",
      resolve: (ctx) => {
        const actions = ctx.legalActions();
        return actions[Math.floor(ctx.rng() * actions.length)];
      },
    }),
  ],
});
```

#### Gamekit layer (`@openturn/gamekit`)

```ts
defineGame({
  // ...
  config: {
    turnTimeoutMs: { type: "number", default: 30_000, min: 5_000, max: 300_000, label: "Turn time" },
  } as const satisfies ConfigSchema,
  phases: {
    play: {
      deadline: (ctx) => deadline.after(ctx, ctx.match.config.turnTimeoutMs),
      onTimeout: (ctx, moves) => {
        // Random legal action — same `ctx` and `moves` as a regular handler.
        const legal = ctx.legalActions();
        const pick = legal[Math.floor(ctx.rng() * legal.length)];
        return moves[pick.name](pick.args);
      },
    },
    endgame: {
      // No deadline declared in this phase — no timer.
    },
  },
  moves: { /* ... */ },
});
```

No new exports beyond:

- Core: the `kind: "timeout"` variant of `GameTransitionConfig`, the `DeadlineScheduler` interface, and the `DeadlineKey` type.
- Gamekit: the `onTimeout?` field on `GamekitPhaseConfig`. No new factory function or type.

### 8. RoomRuntime integration

`RoomRuntimeOptions` gains an optional `scheduler?: DeadlineScheduler`. When present:

- After every event applied (player-dispatched or timeout-dispatched), the runtime calls `scheduler.setDeadline("turn-timeout", session.getNextDeadline())`. `getNextDeadline()` returns `controlMeta.deadline` from the current snapshot (or `null` if absent).
- The `RoomRuntime` exposes `fireTimeout()` for hosts to call when their underlying timer fires. Implementation:

```ts
async fireTimeout(): Promise<void> {
  const snapshot = this.session.getState();
  const deadline = snapshot.derived.controlMeta.deadline;
  const now = this.now();  // injectable for tests; default Date.now
  if (deadline === null || deadline > now) return;  // idempotency

  const transition = this.findTimeoutTransition(snapshot.position.name);
  if (transition === undefined) return;  // game stalls intentionally

  await this.applyTransition(transition);  // same dispatch path as events
}
```

`findTimeoutTransition` uses the existing transition-matching infrastructure with the new `kind: "timeout"` discriminator.

When `scheduler` is undefined (e.g., legacy callers, replay materializers), turn-timeout is not enforced. Game still works; deadlines remain informational. Back-compat preserved.

### 9. Gamekit support — `phase.onTimeout`

Most game authors use `@openturn/gamekit`, which abstracts core's transitions / events / states behind moves and phases. Without gamekit support, gamekit authors would have to reach into core's `transitions` array to wire timeout handling — unidiomatic and exposes core vocabulary they otherwise don't see. Gamekit gets a native primitive that synthesizes the core-level transition under the hood.

#### Gamekit phase config addition

```ts
interface GamekitPhaseConfig<TState, TComputed, TPhase, TPlayers> {
  // ...existing fields including the already-supported `deadline?` ...
  onTimeout?: (
    ctx: GamekitMoveContext<TState, TComputed, TPhase, TPlayers>,
    moves: BoundMoves<TMoves, TState, ...>,
  ) => GamekitMoveResult | null;
}
```

- `ctx` is the same shape a regular move handler receives (`G`, `match`, `turn`, `legalActions()`, `rng()`, `activePlayer(s)`, computed values, etc.).
- `moves` is the typed factory object that move handlers already get — calling `moves.<name>(args)` returns a `GamekitMoveResult`. This is what makes "trigger an existing move with chosen args" idiomatic.
- Return value is the same `GamekitMoveResult` union regular handlers return: `{ kind: "stay", endTurn?, patch?, enqueue?, profile? }`, `{ kind: "goto", phase, ... }`, `{ kind: "finish", result, ... }`, or the same shape a `moves.X(args)` call produces. `null` means "no-op; consume the timeout but make no state change."

#### Synthesis to core-level transition

For each phase that declares `onTimeout`, gamekit synthesizes a core-level `transition({ kind: "timeout", from: <phase-state>, to: <phase-state>, resolve })` during `defineGame` compilation. The `resolve` function:

1. Wraps the core `ctx` into the gamekit move context (existing helper — same wrapper used for normal move handlers).
2. Binds the gamekit `moves` registry to the wrapped context (existing helper).
3. Calls `phaseConfig.onTimeout(ctx, moves)`.
4. Pipes the return through gamekit's existing `interpretMoveResult` interpreter — which translates `{ kind: "stay" | "goto" | "finish", ... }` into core events / state changes / patches / queued events / profile deltas, exactly as it does for regular move dispatches.
5. Returns the resolved core event input to the core transition machinery, which applies it via the same dispatch path.

No new gamekit-internal interpreter; reuse the existing one.

#### Behaviors at the gamekit layer

| Pattern | Code |
|---|---|
| Random legal action | `(ctx, moves) => { const a = ctx.legalActions(); const pick = a[Math.floor(ctx.rng() * a.length)]; return moves[pick.name](pick.args); }` |
| Forfeit / lose on time | `(ctx, moves) => moves.resign({ player: ctx.activePlayer })` (assuming a `resign` move exists) — or directly `(ctx) => ({ kind: "finish", result: { winner: otherPlayer(ctx.activePlayer) } })` |
| Auto-play lowest legal card | `(ctx, moves) => moves.play({ card: ctx.G.hand[ctx.activePlayer].sort(byRank)[0] })` |
| Skip turn | `(ctx) => ({ kind: "stay", endTurn: true })` |
| No-op (let other things resolve it) | `() => null` |
| Conditional behavior | `(ctx, moves) => ctx.G.scoreLeader >= 90 ? moves.resign(...) : moves.passTurn()` |

Per-phase `deadline` and `onTimeout` are independent functions — different phases can have different deadlines AND different responses. Within a phase, both functions receive `ctx` so they can branch on game state or match config (e.g., "first turn gets 60s, late game gets 15s," or "endgame timeouts forfeit but mid-game timeouts auto-play").

#### Edge cases at the gamekit layer

- **Phase declares `deadline` but no `onTimeout`:** core transition lookup finds no match; game stalls. Same outcome as core-only.
- **Phase declares `onTimeout` but no `deadline`:** the handler will never fire (no timer is set). Gamekit emits a validation warning at definition-time (`getGamekitValidationReport` if it exists, otherwise added alongside the core validator). Not a hard error — author may be wiring config-driven deadlines that haven't landed yet.
- **Multi-phase game:** each phase's `(deadline, onTimeout)` pair is independent. Synthesizing one core-level timeout transition per phase that declares `onTimeout`.
- **Simultaneous-move phase:** the timeout fires once for the phase. `ctx.activePlayers` is plural; the resolver inspects who has/hasn't moved (existing gamekit machinery surfaces this) and decides per-player handling. If the resolver returns multiple `moves.X(...)` dispatches in sequence, the existing interpreter applies each as a separate event in the action log.
- **`__gamekit_finished` state:** gamekit's terminal state has no `deadline`, no `onTimeout`. `setDeadline` clears.

#### Tests at the gamekit layer

- Phase with `onTimeout` returning a `moves.X(args)` dispatch fires the move's handler.
- Phase with `onTimeout` returning `{ kind: "finish", result }` ends the game.
- Phase with `onTimeout` returning `null` no-ops.
- Phase with `deadline` but no `onTimeout` → game stalls; runtime no-ops at `fireTimeout`.
- Phase with `onTimeout` but no `deadline` → validation warning emitted.
- Multi-phase game: each phase's `onTimeout` invoked only when its deadline elapses; phases without `onTimeout` are skipped.
- Conditional `onTimeout` reads `ctx.G` and dispatches different moves correctly.

### 10. Out of scope (re-stated)

- Default behaviors for unhandled timeouts
- Validation warnings for missing timeout transitions
- Reconnect grace windows
- Round / match timers
- Inspector or replay UI metadata distinguishing timeout-fired actions
- Ergonomic helpers (`timeoutSkip`, `timeoutRandom`, `timeoutForfeit`)
- Per-player deadlines

## Tests

### Type-level

- `defineGame({ transitions: [transition({ kind: "timeout", from: "X", to: "Y", resolve: ctx => ... })] })` typechecks with the same `ctx` shape and same allowed return type as event-driven transitions.
- `transition({ kind: "timeout", event: "..." })` is a TS error (the union forbids both).
- `transition({ event: "...", kind: "timeout" })` is a TS error (same).

### Core (`@openturn/core`)

- `fireTimeout()` with current `controlMeta.deadline` null → no-op.
- `fireTimeout()` with current `controlMeta.deadline > now` → no-op (idempotency).
- `fireTimeout()` with elapsed deadline + matching transition → applies transition.
- `fireTimeout()` with elapsed deadline + no matching transition → no-op (stall).
- `fireTimeout()` with parent-fallback timeout transition → applies parent's.
- Multi-player simultaneous-move state: `fireTimeout()` called once; resolver decides per-player handling.
- Replay determinism: a session that received a `kind: "timeout"` dispatch produces an identical snapshot when replayed from the action log without re-firing.

### Server (`@openturn/server`)

- `RoomRuntime` calls `scheduler.setDeadline("turn-timeout", X)` after every event.
- DO scheduler: setting both `turn-timeout` and `idle-reap` produces a single `setAlarm` at the min.
- DO scheduler: clearing one keeps the other.
- DO `alarm()` handler: dispatches each elapsed key, re-arms.
- DO `alarm()` handler: a stale alarm fires for `turn-timeout` after the player already moved → `fireTimeout` no-ops via idempotency.
- DO migration: a persisted DO with no `DEADLINES_KEY` rehydrates cleanly; first event populates the record.

### CLI (`@openturn/cli`)

- `CliScheduler.setDeadline` cancels existing handle when called for the same key.
- `CliScheduler.setDeadline(key, null)` clears.
- Multi-key independent timers fire independently.
- Vitest fake timers exercise the timeout path end-to-end.

### Gamekit (`@openturn/gamekit`)

See §9 for the full list — covers move-dispatch returns, `{ kind: "finish" }` returns, `null` returns, missing-`onTimeout` stall, missing-`deadline` validation warning, multi-phase independence, and conditional `onTimeout` behavior reading `ctx.G`.

## Implementation surface

| File | Change |
|---|---|
| `packages/core/src/types.ts` | Make `GameTransitionConfig` a discriminated union. Add `GameTimeoutTransition` interface. Update `defineTransition` overloads. |
| `packages/core/src/session.ts` | Add `getNextDeadline(): number \| null` to `LocalGameSession` (returns `controlMeta.deadline` from current snapshot). |
| `packages/core/src/topology.ts` | Update transition graph compilation to handle the new kind (timeout transitions don't appear in the event-keyed map; need a parallel index keyed by state). |
| `packages/core/src/validation.ts` | Validate that `kind: "timeout"` transitions don't also have an `event` field; validate `from`/`to` reference real states. |
| `packages/core/src/runtime.ts` | Export `DeadlineScheduler` interface and `DeadlineKey` type. |
| `packages/core/src/index.ts` | Re-export new types. |
| `packages/server/src/index.ts` | `RoomRuntimeOptions.scheduler?`. After every dispatched event, call `setDeadline("turn-timeout", session.getNextDeadline())`. Add `fireTimeout()` method on `RoomRuntime` — re-checks idempotency, finds matching `kind: "timeout"` transition, applies it via existing dispatch path, then re-arms `setDeadline`. |
| `packages/server/src/worker.ts` | Replace single-slot idle-reap with two-slot multiplexer. Implement `DeadlineScheduler` against `ctx.storage`. New `alarm()` dispatcher. Wire `RoomRuntime` with the scheduler. |
| `packages/cli/src/index.ts` | Implement `CliScheduler`. Wire into runtime construction at lobby:start. Replace existing setTimeout-based idle-reap with the multiplexed version. |
| `packages/gamekit/src/index.ts` | Add `onTimeout?` to `GamekitPhaseConfig`. In `defineGame` (gamekit) compilation, synthesize a core-level `transition({ kind: "timeout", from: <phase-state>, to: <phase-state>, resolve })` for each phase that declares `onTimeout`. The `resolve` reuses the existing gamekit context-wrapping + move-binding + `interpretMoveResult` pipeline. Add validation warning for `onTimeout` without `deadline`. |
| `packages/gamekit/src/types.test-d.ts` | Type-level tests confirming `(ctx, moves) => MoveResult \| null` shape on `phase.onTimeout`. |
| `packages/core/src/index.test.ts` | Type-level + behavioral tests for timeout dispatch. |
| `packages/gamekit/src/index.test.ts` (or extend existing) | Behavioral tests per the gamekit test list above. |
| `packages/server/src/worker.ts` test (or new test file) | DO scheduler unit tests. |
| `packages/cli/src/index.ts` test | CLI scheduler unit tests with fake timers. |

The change is type-additive at the public surface — every existing `defineTransition` callsite works unchanged because the union's first variant matches the existing shape. Games that don't declare timeout transitions and don't supply `state.deadline` see zero behavior change. Games that supply `state.deadline` without a matching timeout transition see only "game stalls when deadline elapses" — a clear failure mode they can fix by adding the transition.
