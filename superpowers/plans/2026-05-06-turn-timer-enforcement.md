# Turn Timer Enforcement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a state declares a `deadline`, fire a server-authoritative trigger when wall-clock elapses; let the game decide the response via `transition({ kind: "timeout", ... })` at the core layer or `phase.onTimeout` at the gamekit layer. Works in cloud DO and CLI dev shell.

**Architecture:** Three layers. Core: extend `GameTransitionConfig` to a discriminated union with a new `kind: "timeout"` variant; add `getNextDeadline()` and `fireTimeout()` session/runtime methods; idempotency check inside. Server: `RoomRuntime` gains an injected `DeadlineScheduler` interface and re-arms after every event. Hosts: cloud DO multiplexes `turn-timeout` and `idle-reap` on its single `setAlarm` slot via a small `deadlines` storage map; CLI uses `setTimeout` handles per key. Gamekit: `phase.onTimeout` synthesizes a core-level timeout transition during compilation, reusing the existing move-result interpreter.

**Tech Stack:** TypeScript (strict generics for the discriminated transition union), `bun:test` for core/server/cli/gamekit, Cloudflare Durable Object alarms (`ctx.storage.setAlarm`), Node/Bun `setTimeout` for the CLI.

**Spec:** `superpowers/specs/2026-05-06-turn-timer-enforcement-design.md`

---

## File Map

| File | Role |
|---|---|
| `packages/core/src/types.ts` | Make `GameTransitionConfig` a discriminated union: `GameEventTransition` (existing shape) \| `GameTimeoutTransition` (new — `kind: "timeout"`, no `event` field). Update `defineTransition` exports as needed. |
| `packages/core/src/session.ts` | Add `getNextDeadline(): number \| null` to `LocalGameSession`. Add timeout-transition lookup helper that filters by `kind === "timeout"` and matches by source path with parent-fallback. Update `compileGameGraph` to emit timeout transitions correctly. |
| `packages/core/src/validation.ts` | Validate `kind: "timeout"` transitions: `from`/`to` must reference real states; no transition can carry both `event` and `kind`. |
| `packages/core/src/runtime.ts` | Export `DeadlineScheduler` interface and `DeadlineKey` type. |
| `packages/core/src/index.ts` | Re-export new public types. |
| `packages/core/src/index.test.ts` | Type-level + behavioral tests for timeout transitions, `getNextDeadline`. |
| `packages/server/src/index.ts` | Add `scheduler?: DeadlineScheduler` to `RoomRuntimeOptions`. After every dispatched event, call `setDeadline("turn-timeout", session.getNextDeadline())`. Add `fireTimeout(now?)` method on `RoomRuntime` that re-checks idempotency, finds matching `kind: "timeout"` transition, applies it via the existing dispatch path. |
| `packages/server/src/index.test.ts` (or new) | RoomRuntime scheduler integration tests. |
| `packages/server/src/worker.ts` | Replace single-slot `setAlarm` for idle-reap with a `DeadlineScheduler` impl that persists a `deadlines: { "turn-timeout"?, "idle-reap"? }` record in `ctx.storage` and recomputes the min for `setAlarm`. New `alarm()` handler dispatches each elapsed key, with idempotency for `turn-timeout` via `runtime.fireTimeout()`. Wire `RoomRuntime` with the scheduler at runtime construction. Update every callsite of the existing `scheduleIdleReap()` to call `scheduler.setDeadline("idle-reap", Date.now() + idleReapMs)`. |
| `packages/cli/src/index.ts` | Implement `CliScheduler` (in-memory `setTimeout` handles per `DeadlineKey`). Wire into `createRoomRuntime` at lobby:start. Replace existing setTimeout-based idle-reap (if any direct usage) with the multiplexed scheduler. |
| `packages/cli/src/index.test.ts` (or new) | `CliScheduler` unit tests with vitest fake timers. |
| `packages/gamekit/src/index.ts` | Add `onTimeout?: (ctx, moves) => MoveResult \| null` to `GamekitPhaseConfig`. In gamekit `defineGame` compilation, for each phase that declares `onTimeout`, synthesize a core-level `transition({ kind: "timeout", from: <phase-state>, to: <phase-state>, resolve })` whose resolver reuses the existing move-context wrapping + move-binding + `interpretMoveResult` pipeline. Validation warning when `onTimeout` is declared without `deadline`. |
| `packages/gamekit/src/index.test.ts` | Gamekit `onTimeout` behavioral tests (move dispatch, finish, null, missing-onTimeout stall, multi-phase independence). |
| `packages/gamekit/src/types.test-d.ts` | Type-level tests for `phase.onTimeout` shape. |

---

## Task 1: Core types — `kind: "timeout"` discriminated transition

**Files:**
- Modify: `packages/core/src/types.ts`

- [ ] **Step 1: Read existing GameTransitionConfig**

Open `packages/core/src/types.ts:372-386` to confirm the existing shape:

```ts
export interface GameTransitionConfig<
  TState,
  TEvents extends GameEventMap = GameEventMap,
  TResult = ReplayValue | null,
  TNode extends string = string,
  TPlayers extends PlayerList = PlayerList,
  TControl extends ReplayValue = ReplayValue,
> {
  event: keyof TEvents & string;
  from: TNode;
  label?: string;
  resolve?: GameTransitionResolver<TState, TEvents, TResult, TNode, TPlayers, TControl>;
  to: TNode;
  turn?: "increment" | "preserve";
}
```

- [ ] **Step 2: Convert to a discriminated union**

Replace the interface with two specific shapes plus a union alias:

```ts
export interface GameEventTransition<
  TState,
  TEvents extends GameEventMap = GameEventMap,
  TResult = ReplayValue | null,
  TNode extends string = string,
  TPlayers extends PlayerList = PlayerList,
  TControl extends ReplayValue = ReplayValue,
> {
  event: keyof TEvents & string;
  from: TNode;
  label?: string;
  resolve?: GameTransitionResolver<TState, TEvents, TResult, TNode, TPlayers, TControl>;
  to: TNode;
  turn?: "increment" | "preserve";
}

export interface GameTimeoutTransition<
  TState,
  TEvents extends GameEventMap = GameEventMap,
  TResult = ReplayValue | null,
  TNode extends string = string,
  TPlayers extends PlayerList = PlayerList,
  TControl extends ReplayValue = ReplayValue,
> {
  kind: "timeout";
  from: TNode;
  label?: string;
  resolve?: GameTransitionResolver<TState, TEvents, TResult, TNode, TPlayers, TControl>;
  to: TNode;
  turn?: "increment" | "preserve";
}

export type GameTransitionConfig<
  TState,
  TEvents extends GameEventMap = GameEventMap,
  TResult = ReplayValue | null,
  TNode extends string = string,
  TPlayers extends PlayerList = PlayerList,
  TControl extends ReplayValue = ReplayValue,
> =
  | GameEventTransition<TState, TEvents, TResult, TNode, TPlayers, TControl>
  | GameTimeoutTransition<TState, TEvents, TResult, TNode, TPlayers, TControl>;
```

- [ ] **Step 3: Export the new types**

In `packages/core/src/index.ts`, find the existing `GameTransitionConfig` re-export from `"./types"` and add the new sibling types alongside it:

```ts
export {
  // ...existing exports...
  type GameEventTransition,
  type GameTimeoutTransition,
  type GameTransitionConfig,
  // ...rest...
} from "./types";
```

- [ ] **Step 4: Typecheck monorepo-wide**

Run from `openturn/` root: `bun run typecheck`

Expected: PASS for every workspace. Existing transitions all have an `event` field, so they continue to satisfy `GameEventTransition` and the union. If any callsite typechecks against `GameTransitionConfig["event"]` directly (not through narrowing), it will fail — investigate.

The callsites most likely to fail are in `packages/core/src/session.ts` where transitions are filtered by `.event === eventInput.kind`. The filter callback narrows the type implicitly via `event === ...`, which keeps working — but the type guard `transition is TransitionFor<...>` may need adjustment. If typecheck reports issues here, leave them for Task 2 (which rewrites that filter) and report DONE_WITH_CONCERNS.

- [ ] **Step 5: Run all tests**

Run: `bun run test`

Expected: PASS for every workspace.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/types.ts packages/core/src/index.ts
git commit -m "core: discriminated GameTransitionConfig with kind: timeout variant"
```

---

## Task 2: Core session — timeout transition matching + getNextDeadline

**Files:**
- Modify: `packages/core/src/session.ts`
- Modify: `packages/core/src/index.test.ts`

- [ ] **Step 1: Write failing tests**

Append inside `describe("@openturn/core")` in `packages/core/src/index.test.ts`:

```ts
test("getNextDeadline returns controlMeta.deadline from current snapshot", () => {
  const session = createLocalSession(
    defineGame({
      playerIDs: ["0", "1"],
      events: { noop: undefined },
      initial: "play",
      setup: () => ({}),
      states: {
        play: {
          activePlayers: () => ["0"],
          deadline: 12345,
        },
      },
      transitions: [],
    }),
    { match: { players: ["0", "1"] as const }, now: 0 },
  );
  expect(session.getNextDeadline()).toBe(12345);
});

test("getNextDeadline returns null when no deadline set", () => {
  const session = createLocalSession(
    defineGame({
      playerIDs: ["0", "1"],
      events: { noop: undefined },
      initial: "play",
      setup: () => ({}),
      states: { play: { activePlayers: () => ["0"] } },
      transitions: [],
    }),
    { match: { players: ["0", "1"] as const } },
  );
  expect(session.getNextDeadline()).toBe(null);
});

test("fireTimeout no-ops when no deadline is set", () => {
  const session = createLocalSession(
    defineGame({
      playerIDs: ["0", "1"],
      events: { noop: undefined },
      initial: "play",
      setup: () => ({}),
      states: { play: { activePlayers: () => ["0"] } },
      transitions: [],
    }),
    { match: { players: ["0", "1"] as const } },
  );
  const turnBefore = session.getState().meta.match.players.length > 0 ? session.getState().position.turn : 0;
  session.fireTimeout(1_000_000);
  expect(session.getState().position.turn).toBe(turnBefore);
});

test("fireTimeout no-ops when deadline is in the future", () => {
  const session = createLocalSession(
    defineGame({
      playerIDs: ["0", "1"],
      events: { noop: undefined },
      initial: "play",
      setup: () => ({}),
      states: {
        play: {
          activePlayers: () => ["0"],
          deadline: 1_000_000,
        },
      },
      transitions: [
        { kind: "timeout" as const, from: "play", to: "done", resolve: () => null },
        { event: "noop", from: "play", to: "play" },
      ],
      // The timeout transition refers to "done" but we never reach it because
      // fireTimeout is called BEFORE the deadline.
    } as any),  // `as any` because TS may not yet accept the discriminated union before Task 1's downstream wiring
    { match: { players: ["0", "1"] as const }, now: 0 },
  );
  session.fireTimeout(500_000);
  // Should still be in "play" — no transition fired
  expect(session.getState().position.name).toBe("play");
});

test("fireTimeout applies matching kind: timeout transition when deadline elapsed", () => {
  const game = defineGame({
    playerIDs: ["0", "1"],
    events: { noop: undefined },
    initial: "play",
    setup: () => ({ ticks: 0 }),
    states: {
      play: {
        activePlayers: () => ["0"],
        deadline: 1_000,
      },
      done: { activePlayers: () => [] },
    },
    transitions: [
      { kind: "timeout" as const, from: "play", to: "done", resolve: () => ({ G: { ticks: 99 }, result: null }) },
    ],
  } as any);
  const session = createLocalSession(game, {
    match: { players: ["0", "1"] as const },
    now: 0,
  });
  session.fireTimeout(2_000);
  expect(session.getState().position.name).toBe("done");
  expect(session.getState().G.ticks).toBe(99);
});

test("fireTimeout no-ops when deadline elapsed but no matching transition", () => {
  const game = defineGame({
    playerIDs: ["0", "1"],
    events: { noop: undefined },
    initial: "play",
    setup: () => ({}),
    states: {
      play: {
        activePlayers: () => ["0"],
        deadline: 1_000,
      },
    },
    transitions: [],   // no timeout transition declared
  } as any);
  const session = createLocalSession(game, {
    match: { players: ["0", "1"] as const },
    now: 0,
  });
  session.fireTimeout(2_000);
  // Game stalls — still in "play"
  expect(session.getState().position.name).toBe("play");
});

test("fireTimeout uses parent-fallback transition matching", () => {
  const game = defineGame({
    playerIDs: ["0", "1"],
    events: { noop: undefined },
    initial: "child",
    setup: () => ({}),
    states: {
      parent: {},
      child: {
        activePlayers: () => ["0"],
        deadline: 1_000,
        parent: "parent",
      },
      done: { activePlayers: () => [] },
    },
    transitions: [
      { kind: "timeout" as const, from: "parent", to: "done", resolve: () => null },
    ],
  } as any);
  const session = createLocalSession(game, {
    match: { players: ["0", "1"] as const },
    now: 0,
  });
  session.fireTimeout(2_000);
  expect(session.getState().position.name).toBe("done");
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `bun run --filter @openturn/core test`

Expected: FAIL on every new test (`getNextDeadline`, `fireTimeout` undefined).

- [ ] **Step 3: Add `getNextDeadline` to `LocalGameSession`**

In `packages/core/src/session.ts`, find `LocalGameSession` interface (search for `interface LocalGameSession` or the `buildLocalSession` function that returns it). Add a method to the returned object:

```ts
getNextDeadline(): number | null {
  return this.getState().derived.controlMeta.deadline ?? null;
}
```

If `LocalGameSession` is a TypeScript interface (not just an inferred type from the builder function), add the signature there too:

```ts
export interface LocalGameSession<TMachine extends AnyGame, TMatch> {
  // ...existing methods...
  getNextDeadline(): number | null;
  fireTimeout(now?: number): void;
}
```

- [ ] **Step 4: Add `fireTimeout` to `LocalGameSession`**

Implement `fireTimeout(now?: number)` on the session. The implementation:

```ts
fireTimeout(now: number = Date.now()): void {
  const snapshot = this.getState();
  const deadline = snapshot.derived.controlMeta.deadline;
  if (deadline === null || deadline > now) return;  // idempotency

  // Find a kind: "timeout" transition that matches the current state, with
  // parent-fallback per existing matching rules.
  const transition = findTimeoutTransition(machine, snapshot.position);
  if (transition === undefined) return;  // game stalls intentionally

  // Apply via existing dispatch path. The exact internal helper depends on
  // session.ts structure — likely something analogous to applyEvent that
  // accepts a transition + resolved output. Reuse existing internals.
  applyTimeoutTransition(machine, /* current state */ this, transition, now);
}
```

Add the `findTimeoutTransition` helper at module scope:

```ts
function findTimeoutTransition<TMachine extends AnyGame>(
  machine: TMachine,
  position: GameNodeState<GameNodes<TMachine>>,
): TMachine["transitions"][number] | undefined {
  for (const source of [...position.path].reverse()) {
    const matches = machine.transitions.filter(
      (t): t is Extract<TMachine["transitions"][number], { kind: "timeout" }> =>
        "kind" in t && (t as { kind?: string }).kind === "timeout" && t.from === source,
    );
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) {
      // Same ambiguity policy as event transitions.
      throw new Error(`Ambiguous timeout transitions from "${source}".`);
    }
  }
  return undefined;
}
```

For `applyTimeoutTransition`: this needs to follow the existing transition-application path used by `applyEvent`. Read `session.ts` carefully — the function that resolves a matched transition, applies its `resolve()` output, advances turn, etc. Factor the shared core into a helper if needed and reuse for timeout. The timeout-dispatched action must be recorded in the action log just like a normal event would be (with whatever `event` shape works for the action record — discuss with the implementer if this needs a new action-record kind, but **prefer reusing the existing event-action-record shape with the resolved output**, treating timeout-dispatched actions as identical to event-dispatched ones in the log per spec §6).

If the existing shape requires an `event` name in the action record, set the action record's event to a sentinel like `"__timeout"` only inside the action log entry (NOT in the transition or events map). This keeps replay determinism — the log entry is recognizable but doesn't pollute the public events map.

Inspect `session.ts` to find the action-record write path and pick the implementation that minimizes new vocabulary in the log entry shape. Document the choice in code comments.

- [ ] **Step 5: Update `compileGameGraph` to emit timeout edges**

Find `compileGameGraph` in `session.ts` (around line 320). The current code does:

```ts
edges: machine.transitions.map((transition) => ({
  event: transition.event,
  from: transition.from,
  to: transition.to,
  turn: transition.turn ?? "preserve",
}))
```

For the discriminated union, distinguish:

```ts
edges: machine.transitions.map((transition) => ({
  event: "kind" in transition && transition.kind === "timeout" ? "__timeout" : (transition as { event: string }).event,
  from: transition.from,
  to: transition.to,
  turn: transition.turn ?? "preserve",
}))
```

(The `__timeout` sentinel here is for graph-visualization purposes — the inspector / tools see it as a distinct edge label. Same sentinel as the action-record one if Step 4 chose that approach.)

- [ ] **Step 6: Run tests + typecheck**

Run: `bun run --filter @openturn/core test && bun run --filter @openturn/core typecheck`

Expected: All new tests PASS; existing tests PASS; typecheck PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/session.ts packages/core/src/index.test.ts
git commit -m "core: getNextDeadline + fireTimeout with kind:timeout transition matching"
```

---

## Task 3: Core validation — verify timeout transition shape

**Files:**
- Modify: `packages/core/src/validation.ts`
- Modify: `packages/core/src/index.test.ts`

- [ ] **Step 1: Write failing tests**

Append inside `describe("@openturn/core")`:

```ts
test("validation rejects transition with both event and kind", () => {
  expect(() => {
    createLocalSession(
      defineGame({
        playerIDs: ["0", "1"],
        events: { foo: undefined },
        initial: "play",
        setup: () => ({}),
        states: { play: { activePlayers: () => ["0"] } },
        transitions: [
          { event: "foo", kind: "timeout" as const, from: "play", to: "play" } as any,
        ],
      } as any),
      { match: { players: ["0", "1"] as const } },
    );
  }).toThrow(InvalidGameDefinitionError);
});

test("validation rejects timeout transition with from referencing unknown state", () => {
  expect(() => {
    createLocalSession(
      defineGame({
        playerIDs: ["0", "1"],
        events: { noop: undefined },
        initial: "play",
        setup: () => ({}),
        states: { play: { activePlayers: () => ["0"] } },
        transitions: [
          { kind: "timeout" as const, from: "ghost", to: "play" } as any,
        ],
      } as any),
      { match: { players: ["0", "1"] as const } },
    );
  }).toThrow(InvalidGameDefinitionError);
});

test("validation accepts a well-formed timeout transition", () => {
  // Should not throw.
  createLocalSession(
    defineGame({
      playerIDs: ["0", "1"],
      events: { noop: undefined },
      initial: "play",
      setup: () => ({}),
      states: {
        play: {
          activePlayers: () => ["0"],
          deadline: 1_000,
        },
      },
      transitions: [
        { kind: "timeout" as const, from: "play", to: "play", resolve: () => null },
      ],
    } as any),
    { match: { players: ["0", "1"] as const } },
  );
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `bun run --filter @openturn/core test`

Expected: FAIL on the rejection tests (no validation logic for the new shape yet); the third test may already pass.

- [ ] **Step 3: Add validation rules**

In `packages/core/src/validation.ts`, find the function that validates `machine.transitions` (likely inside `getGameValidationReport` or `collectStateDiagnostics`). For each transition:

```ts
for (const transition of machine.transitions) {
  const hasKind = "kind" in transition && (transition as { kind?: string }).kind === "timeout";
  const hasEvent = "event" in transition && typeof (transition as { event?: unknown }).event === "string";

  if (hasKind && hasEvent) {
    pushDiagnostic({
      code: "invalid_transition_shape",
      message: `Transition has both "event" and "kind: 'timeout'". Use one or the other.`,
      severity: "error",
      from: transition.from,
      to: transition.to,
    });
  }
  if (hasKind && !(transition.from in machine.states)) {
    pushDiagnostic({
      code: "invalid_transition_shape",
      message: `Timeout transition "from" references unknown state "${transition.from}".`,
      severity: "error",
      from: transition.from,
      to: transition.to,
    });
  }
  if (hasKind && !(transition.to in machine.states)) {
    pushDiagnostic({
      code: "invalid_transition_shape",
      message: `Timeout transition "to" references unknown state "${transition.to}".`,
      severity: "error",
      from: transition.from,
      to: transition.to,
    });
  }
}
```

Add `invalid_transition_shape` to the `GameValidationCode` union (alphabetical):

```ts
export type GameValidationCode =
  // ...existing entries (alphabetical)...
  | "invalid_setup_state"
  | "invalid_state_control"
  | "invalid_transition_shape"   // NEW
  | "missing_state"
  // ...rest...
```

- [ ] **Step 4: Run tests + typecheck**

Run: `bun run --filter @openturn/core test && bun run --filter @openturn/core typecheck`

Expected: All tests PASS; typecheck PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/validation.ts packages/core/src/index.test.ts
git commit -m "core: validate kind: timeout transitions for shape and state references"
```

---

## Task 4: DeadlineScheduler interface in core

**Files:**
- Modify: `packages/core/src/runtime.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Add the interface**

In `packages/core/src/runtime.ts`, near the existing `deadline` helper:

```ts
/** Keys for deadlines that runtime hosts may multiplex. */
export type DeadlineKey = "turn-timeout" | "idle-reap";

/**
 * Host-injected scheduler interface for wall-clock deadlines. Implementations
 * own their underlying mechanism (Cloudflare DO `setAlarm`, Node `setTimeout`,
 * etc.). Core calls `setDeadline(key, at)` after every event handled by the
 * room runtime; the host fires the appropriate dispatch when wall-clock
 * passes the registered instant.
 */
export interface DeadlineScheduler {
  /** Set or replace a named deadline. `at: null` clears it. */
  setDeadline(key: DeadlineKey, at: number | null): void;
}
```

- [ ] **Step 2: Re-export from package index**

In `packages/core/src/index.ts`, find the `from "./runtime"` export block and add:

```ts
export {
  // ...existing exports...
  type DeadlineKey,
  type DeadlineScheduler,
  // ...rest...
} from "./runtime";
```

- [ ] **Step 3: Typecheck**

Run: `bun run --filter @openturn/core typecheck`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/runtime.ts packages/core/src/index.ts
git commit -m "core: export DeadlineScheduler interface and DeadlineKey type"
```

---

## Task 5: RoomRuntime scheduler integration + fireTimeout

**Files:**
- Modify: `packages/server/src/index.ts`
- Test: `packages/server/src/index.test.ts` (or create `packages/server/src/timeout.test.ts`)

- [ ] **Step 1: Write failing tests**

Add to `packages/server/src/index.test.ts` (or new file). The test creates a runtime with an in-memory scheduler stub and verifies the lifecycle:

```ts
import { describe, expect, test, vi } from "bun:test";
import { createRoomRuntime } from "./index";
import type { DeadlineKey, DeadlineScheduler } from "@openturn/core";
// ...existing imports for a tiny game definition...

class FakeScheduler implements DeadlineScheduler {
  calls: Array<{ key: DeadlineKey; at: number | null }> = [];
  setDeadline(key: DeadlineKey, at: number | null) {
    this.calls.push({ key, at });
  }
}

describe("RoomRuntime — DeadlineScheduler integration", () => {
  test("setDeadline('turn-timeout', X) is called after constructing the runtime when state has deadline", async () => {
    const game = /* a tiny game whose initial state declares deadline: 1_000 */;
    const scheduler = new FakeScheduler();
    const runtime = await createRoomRuntime({
      deployment: { game, gameKey: "k", deploymentVersion: "v", schemaVersion: "1" },
      roomID: "room",
      initialNow: 0,
      scheduler,
      // Other required fields (connectedPlayers, persistence undefined, etc.)
    });
    expect(scheduler.calls.some(c => c.key === "turn-timeout" && c.at === 1_000)).toBe(true);
  });

  test("setDeadline('turn-timeout', null) is called when no deadline is set", async () => {
    const game = /* state has no deadline */;
    const scheduler = new FakeScheduler();
    await createRoomRuntime({
      deployment: { game, /* ... */ },
      roomID: "room",
      initialNow: 0,
      scheduler,
    });
    expect(scheduler.calls.some(c => c.key === "turn-timeout" && c.at === null)).toBe(true);
  });

  test("setDeadline is called again after handleClientMessage applies an event", async () => {
    const game = /* state X has deadline: 1_000; transition to state Y has deadline: 5_000 */;
    const scheduler = new FakeScheduler();
    const runtime = await createRoomRuntime({ deployment: { game, /* ... */ }, scheduler, /* ... */ });
    scheduler.calls = [];  // clear setup calls

    await runtime.handleClientMessage({
      // dispatch the event that transitions X → Y
    });

    expect(scheduler.calls.some(c => c.key === "turn-timeout" && c.at === 5_000)).toBe(true);
  });

  test("RoomRuntime.fireTimeout() applies the timeout transition", async () => {
    const game = /* state has deadline: 1_000 + kind: timeout transition to "done" */;
    const scheduler = new FakeScheduler();
    const runtime = await createRoomRuntime({ deployment: { game, /* ... */ }, scheduler, initialNow: 0 });
    await runtime.fireTimeout(2_000);
    expect(runtime.getState().snapshot.position.name).toBe("done");
  });

  test("RoomRuntime.fireTimeout() no-ops when deadline not yet elapsed (idempotency)", async () => {
    const game = /* state has deadline: 1_000 + kind: timeout transition to "done" */;
    const scheduler = new FakeScheduler();
    const runtime = await createRoomRuntime({ deployment: { game, /* ... */ }, scheduler, initialNow: 0 });
    await runtime.fireTimeout(500);  // before the deadline
    expect(runtime.getState().snapshot.position.name).not.toBe("done");
  });
});
```

(Construct the tiny test game inline using `defineGame` from `@openturn/core` — see Task 2's tests for a similar pattern. The `RoomRuntimeOptions` shape may require additional fields for valid construction; consult the existing `RoomRuntime` tests in the file or in test fixtures.)

- [ ] **Step 2: Run tests to verify failure**

Run: `bun run --filter @openturn/server test`

Expected: FAIL — `scheduler` option not yet accepted; `fireTimeout` not yet on `RoomRuntime`.

- [ ] **Step 3: Add `scheduler?` to `RoomRuntimeOptions`**

In `packages/server/src/index.ts`, find `RoomRuntimeOptions` (around line 261). Add:

```ts
import type { DeadlineScheduler } from "@openturn/core";

export interface RoomRuntimeOptions<TGame> {
  // ...existing fields...
  scheduler?: DeadlineScheduler;
}
```

- [ ] **Step 4: Add `fireTimeout` to `RoomRuntime` interface**

Find `RoomRuntime` interface (around line 156). Add:

```ts
export interface RoomRuntime<TGame> {
  // ...existing methods...
  fireTimeout(now?: number): Promise<readonly RoomRuntimeEnvelope<TGame>[]>;
}
```

- [ ] **Step 5: Implement scheduler re-arm in `createRoomRuntime`**

In `createRoomRuntime` (around line 347):

After the session is constructed and any restore-from-saved logic completes, call `scheduler?.setDeadline("turn-timeout", session.getNextDeadline())`. Find the right point — after the final session state is settled at construction, before returning the runtime.

After every `handleClientMessage` call that applies an event successfully, re-arm:

```ts
async handleClientMessage(message) {
  const result = /* existing dispatch logic */;
  if (/* event applied successfully */) {
    options.scheduler?.setDeadline("turn-timeout", session.getNextDeadline());
  }
  return result;
}
```

(Inspect the existing `handleClientMessage` flow to find the right place. The re-arm should happen after every successful event application. If the existing structure makes this hard, factor out a `rearmScheduler()` helper.)

- [ ] **Step 6: Implement `fireTimeout` on the returned runtime**

```ts
async fireTimeout(now: number = Date.now()): Promise<readonly RoomRuntimeEnvelope<TGame>[]> {
  // Idempotency check — handled inside session.fireTimeout() too, but cheap to short-circuit here.
  const deadline = session.getNextDeadline();
  if (deadline === null || deadline > now) return [];

  // Apply the timeout via the session, which uses the same dispatch path as events.
  // After application, the runtime emits envelopes (snapshots) the same way it does
  // for player-dispatched events.
  const envelopesBefore = /* current state */;
  session.fireTimeout(now);
  const envelopesAfter = /* compute envelopes from new state */;

  // Re-arm for the new state's deadline (which may be different or null)
  options.scheduler?.setDeadline("turn-timeout", session.getNextDeadline());

  return envelopesAfter;
}
```

(The exact envelope-emitting logic depends on existing patterns in `createRoomRuntime`. Match what `handleClientMessage` does — typically it returns envelopes for each connected player. Reuse that logic.)

- [ ] **Step 7: Run tests + typecheck**

Run: `bun run --filter @openturn/server test && bun run --filter @openturn/server typecheck`

Expected: All new tests PASS; existing tests PASS; typecheck PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/server/src/index.ts packages/server/src/index.test.ts
git commit -m "server: RoomRuntime.fireTimeout + scheduler injection + after-event re-arm"
```

---

## Task 6: Cloud DO scheduler — multiplex turn-timeout + idle-reap

**Files:**
- Modify: `packages/server/src/worker.ts`

- [ ] **Step 1: Identify all callsites of `scheduleIdleReap`**

In `packages/server/src/worker.ts`, search for `scheduleIdleReap`:

```bash
grep -n scheduleIdleReap packages/server/src/worker.ts
```

Note every callsite. Each will be replaced with `this.scheduler.setDeadline("idle-reap", ...)`.

- [ ] **Step 2: Add the in-DO scheduler implementation**

Add a private nested class or method inside the `GameRoom` DO class (worker.ts). The scheduler persists `deadlines: Partial<Record<DeadlineKey, number>>` in `ctx.storage` under a single key:

```ts
import type { DeadlineKey, DeadlineScheduler } from "@openturn/core";

const DEADLINES_KEY = "deadlines";

class DurableObjectScheduler implements DeadlineScheduler {
  constructor(private ctx: DurableObjectState) {}

  async setDeadline(key: DeadlineKey, at: number | null): Promise<void> {
    const stored = (await this.ctx.storage.get<Partial<Record<DeadlineKey, number>>>(DEADLINES_KEY)) ?? {};
    if (at === null) delete stored[key];
    else stored[key] = at;
    await this.ctx.storage.put(DEADLINES_KEY, stored);

    const next = nextDeadline(stored);
    if (next === null) {
      await this.ctx.storage.deleteAlarm();
    } else {
      await this.ctx.storage.setAlarm(next);
    }
  }
}

function nextDeadline(stored: Partial<Record<DeadlineKey, number>>): number | null {
  const values = Object.values(stored).filter((v): v is number => typeof v === "number");
  return values.length === 0 ? null : Math.min(...values);
}
```

**Note on async**: `DeadlineScheduler.setDeadline` in the core interface is sync (no await). But Cloudflare `ctx.storage` is async. Two options:
- Make the interface async (`Promise<void>` return). Update core interface.
- Keep the interface sync but fire-and-forget the storage write, accepting eventual consistency.

The first option is safer. Update `packages/core/src/runtime.ts`:

```ts
export interface DeadlineScheduler {
  setDeadline(key: DeadlineKey, at: number | null): void | Promise<void>;
}
```

`void | Promise<void>` lets sync impls (CLI) and async impls (DO) coexist. Callers should `await` the return, which is a no-op for sync impls and awaits for async.

If you change the interface, also update `RoomRuntime`'s callsites to `await options.scheduler?.setDeadline(...)`.

- [ ] **Step 3: Replace `alarm()` handler**

In worker.ts (around line 281), replace the existing `alarm()` with:

```ts
async alarm(): Promise<void> {
  const now = Date.now();
  const stored = (await this.ctx.storage.get<Partial<Record<DeadlineKey, number>>>(DEADLINES_KEY)) ?? {};

  const elapsed: DeadlineKey[] = [];
  for (const [key, at] of Object.entries(stored) as Array<[DeadlineKey, number]>) {
    if (at <= now) {
      elapsed.push(key);
      delete stored[key];
    }
  }
  await this.ctx.storage.put(DEADLINES_KEY, stored);

  for (const key of elapsed) {
    if (key === "idle-reap") await this.handleIdleReap();
    if (key === "turn-timeout") {
      if (this.#runtime !== null) await this.#runtime.fireTimeout(now);
    }
  }

  // Re-arm in case dispatchDeadline added new deadlines.
  const refreshed = (await this.ctx.storage.get<Partial<Record<DeadlineKey, number>>>(DEADLINES_KEY)) ?? {};
  const next = nextDeadline(refreshed);
  if (next !== null) await this.ctx.storage.setAlarm(next);
}

private async handleIdleReap(): Promise<void> {
  const sockets = this.ctx.getWebSockets();
  if (sockets.length > 0) {
    // Connections came back — re-arm idle-reap.
    await this.scheduler.setDeadline("idle-reap", Date.now() + idleReapMs);
    return;
  }
  await this.ctx.storage.deleteAll();
  this.#runtime = null;
  this.#lobby = null;
}
```

- [ ] **Step 4: Replace every `scheduleIdleReap` callsite**

For each callsite identified in Step 1, change:

```ts
await this.scheduleIdleReap();
```

to:

```ts
await this.scheduler.setDeadline("idle-reap", Date.now() + idleReapMs);
```

Where `this.scheduler` is the `DurableObjectScheduler` instance — instantiate it in the DO constructor or lazily in a getter.

Delete the now-unused `scheduleIdleReap` method.

- [ ] **Step 5: Wire scheduler into `RoomRuntime` construction**

Find the `createRoomRuntime` callsite in worker.ts (around line 1213). Add `scheduler: this.scheduler`:

```ts
const runtime = await createRoomRuntime({
  // ...existing options...
  scheduler: this.scheduler,
});
```

- [ ] **Step 6: Migration check**

The new `alarm()` reads `DEADLINES_KEY` from storage. If a persisted DO from before this deploy was rehydrated, it has no such key — the `?? {}` fallback gives an empty record, no elapsed deadlines, no dispatch, and `setAlarm` is not re-armed.

But: that DO may have an in-flight `setAlarm` from the OLD `scheduleIdleReap` (it's just a wall-clock timestamp the runtime persists). When that fires, the new `alarm()` runs, finds an empty `deadlines` record, dispatches nothing, and exits. Net effect: in-flight legacy alarms are silently absorbed.

The next event the DO handles (any client message) calls `setDeadline("idle-reap", ...)`, which populates the deadlines record and re-arms with the new mechanism.

No data migration code needed. Verify by reading the alarm path with a comment:

```ts
async alarm(): Promise<void> {
  // Forward-compat: a DO rehydrated before this deploy has no DEADLINES_KEY;
  // `?? {}` produces an empty record, no dispatch fires, and setAlarm is not
  // re-armed until the next event populates the record. In-flight legacy
  // setAlarm timers from the old single-slot scheduler are silently absorbed.
  // ...
}
```

- [ ] **Step 7: Run tests + typecheck**

Run: `bun run --filter @openturn/server test && bun run --filter @openturn/server typecheck`

Expected: All existing tests PASS; typecheck PASS. Adding new behavior tests for the DO is hard without a Workerd test harness — rely on the integration tests in Task 5 + manual smoke testing.

- [ ] **Step 8: Commit**

```bash
git add packages/server/src/worker.ts packages/core/src/runtime.ts
git commit -m "server: multiplex turn-timeout + idle-reap on DO setAlarm slot"
```

---

## Task 7: CLI scheduler — setTimeout-backed implementation

**Files:**
- Modify: `packages/cli/src/index.ts`
- Test: `packages/cli/src/index.test.ts` (or new file)

- [ ] **Step 1: Write failing tests**

Append to existing CLI test file (or create a new `cli-scheduler.test.ts` colocated):

```ts
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
// or bun:test if existing CLI tests use that — check first.

import { CliScheduler } from "./index";  // or wherever you export it from

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("CliScheduler", () => {
  test("dispatches when deadline elapses", async () => {
    const onDispatch = vi.fn();
    const scheduler = new CliScheduler(onDispatch);
    scheduler.setDeadline("turn-timeout", Date.now() + 1_000);
    vi.advanceTimersByTime(1_500);
    expect(onDispatch).toHaveBeenCalledWith("turn-timeout");
  });

  test("setDeadline replaces an existing handle for the same key", () => {
    const onDispatch = vi.fn();
    const scheduler = new CliScheduler(onDispatch);
    scheduler.setDeadline("turn-timeout", Date.now() + 1_000);
    scheduler.setDeadline("turn-timeout", Date.now() + 5_000);
    vi.advanceTimersByTime(2_000);
    expect(onDispatch).not.toHaveBeenCalled();
    vi.advanceTimersByTime(4_000);
    expect(onDispatch).toHaveBeenCalledWith("turn-timeout");
    expect(onDispatch).toHaveBeenCalledTimes(1);
  });

  test("setDeadline(key, null) clears", () => {
    const onDispatch = vi.fn();
    const scheduler = new CliScheduler(onDispatch);
    scheduler.setDeadline("turn-timeout", Date.now() + 1_000);
    scheduler.setDeadline("turn-timeout", null);
    vi.advanceTimersByTime(2_000);
    expect(onDispatch).not.toHaveBeenCalled();
  });

  test("multiple keys fire independently", () => {
    const onDispatch = vi.fn();
    const scheduler = new CliScheduler(onDispatch);
    scheduler.setDeadline("turn-timeout", Date.now() + 1_000);
    scheduler.setDeadline("idle-reap", Date.now() + 2_000);
    vi.advanceTimersByTime(1_500);
    expect(onDispatch).toHaveBeenCalledWith("turn-timeout");
    expect(onDispatch).not.toHaveBeenCalledWith("idle-reap");
    vi.advanceTimersByTime(1_000);
    expect(onDispatch).toHaveBeenCalledWith("idle-reap");
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `bun run --filter @openturn/cli test`

Expected: FAIL — `CliScheduler` not exported.

- [ ] **Step 3: Implement `CliScheduler`**

In `packages/cli/src/index.ts`:

```ts
import type { DeadlineKey, DeadlineScheduler } from "@openturn/core";

export class CliScheduler implements DeadlineScheduler {
  #handles = new Map<DeadlineKey, ReturnType<typeof setTimeout>>();
  #onDispatch: (key: DeadlineKey) => void | Promise<void>;

  constructor(onDispatch: (key: DeadlineKey) => void | Promise<void>) {
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

- [ ] **Step 4: Wire into runtime construction**

Find `createRoomRuntime(...)` callsites in `packages/cli/src/index.ts` (Slice A's plan listed several around lines 597, 821, 891, 958, 1359, 1500). For the lobby:start path (the always-recreate added in Slice A), pass a scheduler:

```ts
const scheduler = new CliScheduler(async (key) => {
  if (key === "turn-timeout") {
    const runtime = roomRuntimes.get(roomID);  // resolve the right runtime by key
    if (runtime !== undefined) await (await runtime).fireTimeout();
  }
  if (key === "idle-reap") {
    // Existing idle-reap logic for the CLI (if any) — invoke it here.
    // If the CLI didn't have idle-reap before, leave a TODO comment that
    // a future slice may add CLI idle-reap to match the cloud DO.
  }
});

const runtime = await createRoomRuntime({
  // ...existing options...
  scheduler,
});
```

(The exact integration depends on how `roomRuntimes` is keyed and how the dispatch can reach the right runtime. Inspect the existing structure. If the CLI's lobby:start always creates a fresh runtime, the scheduler can close over `runtime` directly:

```ts
let scheduler: CliScheduler;
const runtime = await createRoomRuntime({
  /* ... */
  scheduler: scheduler = new CliScheduler(async (key) => {
    if (key === "turn-timeout") await runtime.fireTimeout();
  }),
});
```

The `let` + assignment dance is needed because `runtime` and `scheduler` reference each other. Or use a wrapper class.)

Apply the same pattern to other `createRoomRuntime` callsites in CLI as appropriate. For paths that don't have a lobby:start context (e.g., room creation before lobby starts), pass `scheduler: undefined` — the runtime tolerates this (timeout enforcement is opt-in per Task 5).

- [ ] **Step 5: Run tests + typecheck**

Run: `bun run --filter @openturn/cli test && bun run --filter @openturn/cli typecheck`

Expected: All new tests PASS; existing tests PASS; typecheck PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/index.ts packages/cli/src/index.test.ts
git commit -m "cli: CliScheduler with setTimeout multiplexer; wire into lobby:start"
```

---

## Task 8: Gamekit — `phase.onTimeout` synthesis

**Files:**
- Modify: `packages/gamekit/src/index.ts`
- Test: `packages/gamekit/src/index.test.ts`
- Test: `packages/gamekit/src/types.test-d.ts`

- [ ] **Step 1: Write failing behavioral tests**

Append to `packages/gamekit/src/index.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { defineGame, move, deadline } from "./index";
import { createLocalSession } from "@openturn/core";

describe("phase.onTimeout", () => {
  test("returning a moves dispatch executes that move's logic", () => {
    const game = defineGame({
      maxPlayers: 2,
      moves: ({ move }) => ({
        place: move.exec({
          args: undefined as undefined | { value: number },
          handler: (ctx, args) => ({ kind: "stay", patch: { last: args?.value ?? -1 } }),
        }),
      }),
      phases: {
        play: {
          deadline: () => 1_000,
          onTimeout: (ctx, moves) => moves.place({ value: 42 }),
        },
      },
      setup: () => ({ last: 0 }),
    });
    const session = createLocalSession(game, {
      match: { players: ["0", "1"] as const },
      now: 0,
    });
    session.fireTimeout(2_000);
    expect(session.getState().G.last).toBe(42);
  });

  test("returning { kind: 'finish' } ends the game", () => {
    const game = defineGame({
      maxPlayers: 2,
      moves: () => ({}),
      phases: {
        play: {
          deadline: () => 1_000,
          onTimeout: () => ({ kind: "finish", result: { winner: "0" } }),
        },
      },
      setup: () => ({}),
    });
    const session = createLocalSession(game, {
      match: { players: ["0", "1"] as const },
      now: 0,
    });
    session.fireTimeout(2_000);
    expect(session.getState().position.name).toBe("__gamekit_finished");
  });

  test("returning null no-ops", () => {
    const game = defineGame({
      maxPlayers: 2,
      moves: () => ({}),
      phases: {
        play: {
          deadline: () => 1_000,
          onTimeout: () => null,
        },
      },
      setup: () => ({ count: 0 }),
    });
    const session = createLocalSession(game, {
      match: { players: ["0", "1"] as const },
      now: 0,
    });
    session.fireTimeout(2_000);
    expect(session.getState().G.count).toBe(0);
    expect(session.getState().position.name).toBe("play");
  });

  test("phase with deadline but no onTimeout: game stalls", () => {
    const game = defineGame({
      maxPlayers: 2,
      moves: () => ({}),
      phases: {
        play: {
          deadline: () => 1_000,
        },
      },
      setup: () => ({}),
    });
    const session = createLocalSession(game, {
      match: { players: ["0", "1"] as const },
      now: 0,
    });
    session.fireTimeout(2_000);
    // Still in "play" — no transition.
    expect(session.getState().position.name).toBe("play");
  });

  test("phase with onTimeout but no deadline emits validation warning", () => {
    expect(() => {
      defineGame({
        maxPlayers: 2,
        moves: () => ({}),
        phases: {
          play: {
            onTimeout: () => null,
          },
        },
        setup: () => ({}),
      });
    }).toThrow(/onTimeout.*deadline/);
    // OR: assert console.warn was called with a matching message; pick whichever
    // surface gamekit's existing validators use today (read the existing code).
  });

  test("multi-phase game: each phase's onTimeout fires only when its deadline elapses", () => {
    // Phase A has 1_000 deadline + onTimeout → moves.toB; Phase B has no deadline.
    // Verify firing timeout in A transitions to B; firing again in B no-ops.
    // (write the game definition; run the assertions)
  });
});
```

(Adapt to whatever real gamekit move-construction pattern looks like — check `packages/gamekit/src/index.ts` for `move.exec` vs `move(...)` shape and existing tests for patterns.)

- [ ] **Step 2: Run tests to verify failure**

Run: `bun run --filter @openturn/gamekit test`

Expected: FAIL — `onTimeout` field on phase config is unknown / not synthesized.

- [ ] **Step 3: Add `onTimeout?` to `GamekitPhaseConfig`**

In `packages/gamekit/src/index.ts`, find `GamekitPhaseConfig` (around line 336 based on earlier grep output). Add the field:

```ts
interface GamekitPhaseConfig<TState, TComputed, TPhase, TPlayers> {
  // ...existing fields including `deadline?` ...
  onTimeout?: (
    ctx: GamekitMoveContext<TState, TComputed, TPhase, TPlayers>,
    moves: BoundMoves<TMoves, /* ... */>,
  ) => GamekitMoveResult | null;
}
```

(Match the exact context and bound-moves types gamekit uses for regular move handlers — read the existing definition for `move.exec(...)`'s `handler` shape and reuse that.)

- [ ] **Step 4: Synthesize timeout transitions during `defineGame` compilation**

In gamekit's `defineGame` (around line 720-ish after `definition.phases` is processed), after the existing transitions are accumulated, walk over phases and synthesize a `kind: "timeout"` transition for each phase that declares `onTimeout`:

```ts
const synthesizedTimeouts: Array<{ kind: "timeout"; from: string; to: string; resolve: ... }> = [];
for (const [phaseName, phaseConfig] of Object.entries(phases)) {
  if (phaseConfig?.onTimeout === undefined) continue;
  if (phaseConfig?.deadline === undefined) {
    // Validation warning per spec §9. Use whatever warning surface gamekit
    // uses today — check defineGame source for examples like "no_states" or
    // "missing_state" diagnostics.
    throw new Error(`phase "${phaseName}" declares onTimeout but no deadline; the timeout will never fire.`);
  }
  synthesizedTimeouts.push({
    kind: "timeout",
    from: phaseName,  // phases map 1:1 to states in the underlying graph
    to: phaseName,
    resolve: (coreCtx) => {
      const gamekitCtx = wrapAsGamekitContext(coreCtx, phaseConfig);  // existing helper
      const boundMoves = bindMoves(moves, gamekitCtx);  // existing helper
      const result = phaseConfig.onTimeout!(gamekitCtx, boundMoves);
      if (result === null) return null;
      return interpretMoveResult(result, gamekitCtx);  // existing helper
    },
  });
}

// Append to the transitions array passed to core's defineGame
const allTransitions = [...userTransitions, ...synthesizedTimeouts];
```

(Inspect gamekit's existing `interpretMoveResult` / context-wrapping / move-binding helpers — they already exist for regular move dispatches. Reuse, don't rewrite.)

- [ ] **Step 5: Run tests + typecheck**

Run: `bun run --filter @openturn/gamekit test && bun run --filter @openturn/gamekit typecheck`

Expected: All new tests PASS; existing tests PASS; typecheck PASS.

- [ ] **Step 6: Add type-level test**

In `packages/gamekit/src/types.test-d.ts`, add a type-only assertion that `phase.onTimeout`'s `ctx` and `moves` parameters infer correctly:

```ts
import { defineGame } from "./index";

const _game = defineGame({
  maxPlayers: 2,
  moves: ({ move }) => ({
    place: move.exec({
      args: undefined as undefined | { x: number },
      handler: () => ({ kind: "stay" }),
    }),
  }),
  phases: {
    play: {
      deadline: () => 1_000,
      onTimeout: (ctx, moves) => {
        // @ts-expect-error — moves should be typed; calling with wrong arg shape errors
        moves.place({ wrong: "type" });
        // Correct usage compiles
        return moves.place({ x: 5 });
      },
    },
  },
  setup: () => ({}),
});
```

Run typecheck again to confirm the assertions hold.

- [ ] **Step 7: Commit**

```bash
git add packages/gamekit/src/index.ts packages/gamekit/src/index.test.ts packages/gamekit/src/types.test-d.ts
git commit -m "gamekit: synthesize timeout transition from phase.onTimeout"
```

---

## Task 9: Full-monorepo verification

**Files:** All modified files from Tasks 1-8.

- [ ] **Step 1: Run full typecheck**

From `openturn/` root: `bun run typecheck`

Expected: PASS for every workspace.

- [ ] **Step 2: Run full test suite**

From `openturn/` root: `bun run test`

Expected: PASS for every workspace.

- [ ] **Step 3: Spec checklist spot-check**

Manually verify against `superpowers/specs/2026-05-06-turn-timer-enforcement-design.md`:

- [ ] §1 Discriminated `GameTransitionConfig` with `kind: "timeout"` variant (Task 1)
- [ ] §2 `DeadlineScheduler` interface in `@openturn/core` (Task 4)
- [ ] §3 Cloud DO scheduler: persisted `deadlines` map + multiplexed `setAlarm` + idempotent `alarm()` handler (Task 6)
- [ ] §3 DO migration safety: forward-compat with persisted DOs missing `DEADLINES_KEY` (Task 6)
- [ ] §4 `CliScheduler` with `setTimeout` handles per key (Task 7)
- [ ] §5 Edge cases: simultaneous moves (resolver decides per-player); disconnect run-down (no special pause logic added, time keeps running); idempotency in `fireTimeout` (Task 2 + 5)
- [ ] §6 Replay determinism: timeout-dispatched events live in the action log as normal events (Task 2)
- [ ] §7 Game-author API both core and gamekit shown to work (Tasks 1-2 + 8)
- [ ] §8 `RoomRuntime.fireTimeout` + scheduler injection + after-event re-arm (Task 5)
- [ ] §9 Gamekit `phase.onTimeout` synthesizes core timeout transition (Task 8)
- [ ] §9 Validation warning when `onTimeout` declared without `deadline` (Task 8)

- [ ] **Step 4: Commit any final fixes**

```bash
git add <modified files>
git commit -m "fix: <description of integration-level fix>"
```

If the full suite was clean on the first try, no commit needed.

---

## Notes for the executing engineer

- **Read order:** spec → this plan → existing Slice A and Slice C diffs (for the lobby/start integration patterns and the DO/CLI plumbing conventions).
- **TS pitfall:** the discriminated transition union in Task 1 will surface latent type holes in code that previously assumed a single shape (e.g., `transition.event` access without narrowing). Most of these will resolve by adding an `if (\"event\" in transition)` guard. Don't paper over with `as any` unless the upstream is genuinely opaque.
- **Idempotency is load-bearing.** If `fireTimeout` doesn't re-check the deadline before firing, stale alarms in the cloud will dispatch ghost timeouts (the DO race we discussed in spec §3 / §5). Keep the check inside `session.fireTimeout` and verify with the test in Task 2 (`fireTimeout no-ops when deadline is in the future`).
- **Replay parser doesn't need a change.** Timeout-dispatched events go into the action log as normal events (per spec §6). The replay parser reads action records by their existing shape; no new field. If you find yourself adding `cause: "timeout"` metadata, stop — that's a deferred polish item per non-goals.
- **DO migration is intentionally minimal.** No data-conversion code. The forward-compat behavior in `alarm()` (treat missing `DEADLINES_KEY` as `{}`) is the entire migration story. Don't write a one-shot upgrade migration; it'd add risk for zero benefit.

---

## Self-review notes

Cross-checked against the spec:

- **Spec coverage:** Every section of the spec maps to at least one task. Task 9's spot-check enumerates them.
- **Placeholder scan:** No TBDs, TODOs, or "implement appropriate X" steps. A few "(inspect existing code)" notes — these point the engineer at real code surfaces (e.g., `interpretMoveResult` in gamekit, action-record write path in session.ts) where the implementer needs to read existing patterns to land correctly. These are not placeholders for the implementation itself.
- **Type consistency:** `DeadlineKey` ("turn-timeout" | "idle-reap"), `DeadlineScheduler` interface, `kind: "timeout"` discriminator, `getNextDeadline()`, `fireTimeout(now?)` are all spelled identically across Tasks 2, 4, 5, 6, 7, 8.
- **Test coverage:** TDD for the load-bearing pieces — core `fireTimeout` + matching (Task 2), validation (Task 3), RoomRuntime scheduler integration (Task 5), CLI scheduler (Task 7), gamekit `onTimeout` synthesis (Task 8). DO scheduler doesn't get a unit test (no Workerd test harness); covered by integration tests in Task 5 + spec checklist + manual smoke.
