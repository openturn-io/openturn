# Host PlayerID Primitive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose host identity to running games as a stable, replayable `PlayerID` via `match.hostPlayerID`, populated by the lobby at game-start.

**Architecture:** Add an optional `hostPlayerID` field to `MatchInput`. Lobby's `start()` computes it (single-player → null; multiplayer → seated host's playerID, or null if host is spectating/absent). Cloud worker persists it on `InitMeta` and threads it into the `match` override when constructing the room runtime. Local lobby surfaces it via the `onTransitionToGame` callback. Core normalizes `undefined → null` and validates that any non-null value appears in `match.players` and is not set for single-player matches.

**Tech Stack:** TypeScript, `bun test` (vitest-style globals via `bun:test`), Cloudflare Durable Objects (cloud worker), React (local lobby hook).

**Spec:** `openturn/superpowers/specs/2026-05-05-host-player-id-design.md`

---

## File Map

| File | Role |
|------|------|
| `packages/core/src/types.ts` | Add `hostPlayerID?: TPlayers[number] \| null` to `MatchInput` interface. |
| `packages/core/src/validation.ts` | Add `normalizeMatchInput()` that validates and normalizes. Add error codes `invalid_host_player`, `single_player_host_set` to `GameValidationCode`. |
| `packages/core/src/session.ts` | Call `normalizeMatchInput()` in `createLocalSession` and `createLocalSessionFromSnapshot` before `hydrateMatchProfiles`. |
| `packages/core/src/runtime.ts` | Implement `isHost(match, playerID)` helper. |
| `packages/core/src/index.ts` | Export `isHost`. |
| `packages/core/src/index.test.ts` | Tests: validation (single-player + non-null reject; out-of-pool reject), normalization (undefined → null), helper behavior, ctx read in state config. |
| `packages/server/src/lobby-runtime.ts` | Add `hostPlayerID: string \| null` to `LobbyStartResult.ok=true` variant. Compute in `start()`. |
| `packages/server/src/lobby-runtime.test.ts` | Tests: multiplayer host seated → host's playerID; multiplayer host spectating → null; single-player → null; host left lobby (freed seat) → null. |
| `packages/server/src/worker.ts` | Add `hostPlayerID: string \| null` to `InitMeta`. Persist it in `handleStart`. Apply it in `getOrCreateRuntime`'s `activeDeployment` override. |
| `packages/lobby/src/react/use-local-lobby.ts` | Pass `hostPlayerID` through `onTransitionToGame` callback shape. |

---

## Task 1: Add `hostPlayerID` field to MatchInput type

**Files:**
- Modify: `packages/core/src/types.ts:91-102`

- [ ] **Step 1: Read current MatchInput definition**

Open `packages/core/src/types.ts` lines 85-103 to confirm current shape. The interface looks like:

```ts
export interface MatchInput<TPlayers extends PlayerList = PlayerList, TMatchData = ReplayValue> {
  data?: TMatchData;
  players: readonly [TPlayers[number], ...TPlayers[number][]];
  profiles?: Partial<Readonly<PlayerRecord<TPlayers, ReplayValue>>>;
}
```

- [ ] **Step 2: Add `hostPlayerID` field**

Edit `packages/core/src/types.ts` to add the field with a documenting comment:

```ts
export interface MatchInput<TPlayers extends PlayerList = PlayerList, TMatchData = ReplayValue> {
  data?: TMatchData;
  players: readonly [TPlayers[number], ...TPlayers[number][]];
  profiles?: Partial<Readonly<PlayerRecord<TPlayers, ReplayValue>>>;
  /**
   * The seated player who acted as host of the lobby that started this match.
   * `null` for single-player matches, when the lobby host was spectating, or
   * when no host was present at start. Locked at game-start and replayed
   * verbatim. Game logic accesses via `ctx.match.hostPlayerID`.
   */
  hostPlayerID?: TPlayers[number] | null;
}
```

- [ ] **Step 3: Typecheck**

Run: `bun run --filter @openturn/core typecheck`

Expected: PASS. Adding an optional field is type-additive, no existing code should break.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/types.ts
git commit -m "core: add MatchInput.hostPlayerID field"
```

---

## Task 2: Implement validation + normalization

**Files:**
- Modify: `packages/core/src/validation.ts`
- Modify: `packages/core/src/session.ts:118-121` and `:161-164`
- Test: `packages/core/src/index.test.ts`

- [ ] **Step 1: Write failing tests for validation/normalization**

Append to `packages/core/src/index.test.ts` inside the existing `describe("@openturn/core")` block:

```ts
test("rejects MatchInput.hostPlayerID not in players", () => {
  expect(() => {
    createLocalSession(
      defineGame({
        playerIDs: ["0", "1"],
        events: { noop: undefined },
        initial: "play",
        setup: () => ({}),
        states: { play: { activePlayers: () => ["0"] } },
        transitions: [],
      }),
      { match: { players: ["0", "1"] as const, hostPlayerID: "carol" as never } },
    );
  }).toThrow(InvalidGameDefinitionError);
});

test("rejects single-player MatchInput with non-null hostPlayerID", () => {
  expect(() => {
    createLocalSession(
      defineGame({
        playerIDs: ["0"],
        events: { noop: undefined },
        initial: "play",
        setup: () => ({}),
        states: { play: { activePlayers: () => ["0"] } },
        transitions: [],
      }),
      { match: { players: ["0"] as const, hostPlayerID: "0" } },
    );
  }).toThrow(InvalidGameDefinitionError);
});

test("normalizes missing MatchInput.hostPlayerID to null", () => {
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
  expect(session.snapshot.meta.match.hostPlayerID).toBe(null);
});

test("preserves valid MatchInput.hostPlayerID", () => {
  const session = createLocalSession(
    defineGame({
      playerIDs: ["0", "1"],
      events: { noop: undefined },
      initial: "play",
      setup: () => ({}),
      states: { play: { activePlayers: () => ["0"] } },
      transitions: [],
    }),
    { match: { players: ["0", "1"] as const, hostPlayerID: "0" } },
  );
  expect(session.snapshot.meta.match.hostPlayerID).toBe("0");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run --filter @openturn/core test`

Expected: FAIL on the four new tests — they should fail because validation doesn't exist yet (the first two will pass-through without throwing; the third will return `undefined` not `null`).

- [ ] **Step 3: Add `normalizeMatchInput` to validation.ts**

Edit `packages/core/src/validation.ts`. After the `InvalidGameDefinitionError` class declaration (around line 80-85), add:

```ts
/**
 * Validate and normalize a MatchInput before it enters the runtime.
 *
 * - Coerces `hostPlayerID: undefined` to `null` so consumers see a 2-state field.
 * - Rejects `hostPlayerID` that is not in `match.players`.
 * - Rejects non-null `hostPlayerID` for single-player matches.
 *
 * Throws `InvalidGameDefinitionError` on validation failure. Returns the
 * normalized match (a shallow copy when normalization changed anything).
 */
export function normalizeMatchInput<TMatch extends MatchInput>(match: TMatch): TMatch {
  const hostPlayerID = match.hostPlayerID ?? null;

  if (hostPlayerID !== null) {
    if (!(match.players as readonly string[]).includes(hostPlayerID as string)) {
      throw new InvalidGameDefinitionError(
        `match.hostPlayerID "${String(hostPlayerID)}" is not in match.players (invalid_host_player)`,
      );
    }
    if (match.players.length === 1) {
      throw new InvalidGameDefinitionError(
        `match.hostPlayerID must be null for single-player matches (single_player_host_set)`,
      );
    }
  }

  if (match.hostPlayerID === hostPlayerID) return match;
  return { ...match, hostPlayerID } as TMatch;
}
```

Also add the two new codes to the `GameValidationCode` union (lines 20-44) by inserting them alphabetically:

```ts
export type GameValidationCode =
  | "active_players_duplicate"
  // ... existing entries ...
  | "invalid_deadline"
  | "invalid_hierarchy"
  | "invalid_host_player"           // NEW
  | "invalid_label"
  // ... existing entries ...
  | "single_player_host_set"        // NEW
  | "state_derivation_failed"
  // ... rest ...
```

(The codes are documented in the error message; we don't need to wire them into `getGameValidationReport` because `normalizeMatchInput` throws directly. The union is updated for documentation/exhaustiveness consistency.)

- [ ] **Step 4: Export `normalizeMatchInput` from validation.ts and re-export it**

Edit `packages/core/src/index.ts` lines 61-70 to include the new export:

```ts
export {
  getGameValidationReport,
  InvalidGameDefinitionError,
  normalizeMatchInput,
  validateGameDefinition,
  type GameValidationCode,
  type GameValidationDiagnostic,
  type GameValidationReport,
  type GameValidationReportSummary,
  type GameValidationSeverity,
} from "./validation";
```

- [ ] **Step 5: Wire `normalizeMatchInput` into session.ts**

Edit `packages/core/src/session.ts`:

In `createLocalSession` around line 118, change:

```ts
const match = hydrateMatchProfiles(
  machine,
  cloneJsonValue(parseJsonValue(options.match, "match")) as unknown as TMatch,
);
```

to:

```ts
const match = hydrateMatchProfiles(
  machine,
  normalizeMatchInput(
    cloneJsonValue(parseJsonValue(options.match, "match")) as unknown as TMatch,
  ),
);
```

Apply the same change in `createLocalSessionFromSnapshot` around line 161.

Add the import to `session.ts` if not already present:

```ts
import { normalizeMatchInput, validateGameDefinition } from "./validation";
```

(Find the existing `validateGameDefinition` import line and add `normalizeMatchInput` to it.)

- [ ] **Step 6: Run tests and typecheck**

Run: `bun run --filter @openturn/core test && bun run --filter @openturn/core typecheck`

Expected: All four new tests PASS. All existing tests PASS. Typecheck PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/validation.ts packages/core/src/session.ts packages/core/src/index.ts packages/core/src/index.test.ts
git commit -m "core: validate and normalize MatchInput.hostPlayerID"
```

---

## Task 3: Add `isHost` helper and verify ctx read

**Files:**
- Modify: `packages/core/src/runtime.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/src/index.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `packages/core/src/index.test.ts`:

```ts
test("isHost returns true only for matching, non-null hostPlayerID", () => {
  expect(isHost({ players: ["0", "1"] as const, hostPlayerID: "0" }, "0")).toBe(true);
  expect(isHost({ players: ["0", "1"] as const, hostPlayerID: "0" }, "1")).toBe(false);
  expect(isHost({ players: ["0", "1"] as const, hostPlayerID: null }, "0")).toBe(false);
  expect(isHost({ players: ["0", "1"] as const }, "0")).toBe(false);
});

test("state config reads ctx.match.hostPlayerID", () => {
  const game = defineGame({
    playerIDs: ["0", "1"],
    events: { noop: undefined },
    initial: "play",
    setup: () => ({}),
    states: {
      play: {
        activePlayers: ({ match: m }) =>
          m.hostPlayerID !== null ? [m.hostPlayerID] : [],
      },
    },
    transitions: [],
  });
  const session = createLocalSession(game, {
    match: { players: ["0", "1"] as const, hostPlayerID: "1" },
  });
  expect(session.snapshot.derived.activePlayers).toEqual(["1"]);
});
```

Update the import line at the top of `index.test.ts` to add `isHost`:

```ts
import {
  compileGameGraph,
  createLocalSession,
  createRng,
  defineGame,
  getGameValidationReport,
  getGameControlSummary,
  InvalidGameDefinitionError,
  isHost,
  rejectTransition,
  resolveRoundRobinTurn,
  roundRobin,
} from "./index";
```

- [ ] **Step 2: Run tests to verify failure**

Run: `bun run --filter @openturn/core test`

Expected: FAIL on `isHost returns true only for matching...` with `isHost is not a function` or import error. State-config test should pass already (just confirming) — if it fails for any other reason, fix the test.

- [ ] **Step 3: Implement `isHost`**

Edit `packages/core/src/runtime.ts`. After the `deadline` export (around line 143-147), add:

```ts
/**
 * Returns true when `playerID` is the match's host. Returns false when
 * `match.hostPlayerID` is null (single-player, spectating host, etc.) for
 * any caller, so it's safe to use as a permission gate.
 */
export function isHost(
  match: { hostPlayerID?: string | null },
  playerID: string,
): boolean {
  const hostPlayerID = match.hostPlayerID ?? null;
  return hostPlayerID !== null && hostPlayerID === playerID;
}
```

- [ ] **Step 4: Export `isHost`**

Edit `packages/core/src/index.ts` lines 48-60. Add `isHost` to the export list:

```ts
export {
  createRng,
  deadline,
  isHost,
  resolveRoundRobinTurn,
  resolveTimeValue,
  roundRobin,
  type DeterministicRng,
  type RngSnapshot,
  type TimeContext,
  type TimeValue,
  type TurnContext,
  type TurnPlayers,
} from "./runtime";
```

- [ ] **Step 5: Run tests + typecheck**

Run: `bun run --filter @openturn/core test && bun run --filter @openturn/core typecheck`

Expected: All tests PASS. Typecheck PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/runtime.ts packages/core/src/index.ts packages/core/src/index.test.ts
git commit -m "core: add isHost helper"
```

---

## Task 4: Compute `hostPlayerID` in LobbyRuntime.start()

**Files:**
- Modify: `packages/server/src/lobby-runtime.ts:86-88` (LobbyStartResult), `:369-430` (start method)
- Test: `packages/server/src/lobby-runtime.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `packages/server/src/lobby-runtime.test.ts`:

```ts
describe("LobbyRuntime.start() — hostPlayerID resolution", () => {
  test("multiplayer with seated host returns host's playerID", () => {
    const runtime = new LobbyRuntime(env());
    runtime.takeSeat(HOST, "Host", 0);
    runtime.takeSeat(BOB, "Bob", 1);
    runtime.setReady(HOST, true);
    runtime.setReady(BOB, true);
    const result = runtime.start(HOST);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.hostPlayerID).toBe("0");
  });

  test("multiplayer with spectating host returns null", () => {
    const runtime = new LobbyRuntime(env());
    // Host does not take a seat — only ALICE and BOB.
    runtime.takeSeat(ALICE, "Alice", 0);
    runtime.takeSeat(BOB, "Bob", 1);
    runtime.setReady(ALICE, true);
    runtime.setReady(BOB, true);
    const result = runtime.start(HOST);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.hostPlayerID).toBe(null);
  });

  test("single-player session returns null even when host is seated", () => {
    const runtime = new LobbyRuntime(env({ minPlayers: 1, maxPlayers: 1, playerIDs: ["0"] }));
    runtime.takeSeat(HOST, "Host", 0);
    runtime.setReady(HOST, true);
    const result = runtime.start(HOST);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.hostPlayerID).toBe(null);
  });

  test("host had a seat but freed it before start returns null", () => {
    const runtime = new LobbyRuntime(env());
    runtime.takeSeat(HOST, "Host", 0);
    runtime.takeSeat(BOB, "Bob", 1);
    runtime.leaveSeat(HOST);
    runtime.takeSeat(ALICE, "Alice", 0);
    runtime.setReady(ALICE, true);
    runtime.setReady(BOB, true);
    const result = runtime.start(HOST);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.hostPlayerID).toBe(null);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `bun run --filter @openturn/server test`

Expected: FAIL on all four — `hostPlayerID` does not yet exist on `LobbyStartResult`.

- [ ] **Step 3: Update `LobbyStartResult` type**

Edit `packages/server/src/lobby-runtime.ts:86-88`:

```ts
export type LobbyStartResult =
  | { ok: true; assignments: readonly LobbyStartAssignment[]; hostPlayerID: string | null }
  | { ok: false; reason: LobbyRejectionReason };
```

- [ ] **Step 4: Compute `hostPlayerID` in `start()`**

Edit `packages/server/src/lobby-runtime.ts` around line 423-430. Replace the trailing block of `start()`:

```ts
    this.#mode = "active";
    this.#userToPlayer = new Map(
      assignments
        .filter((a): a is LobbyStartAssignment & { userID: string } => a.userID !== null)
        .map((a) => [a.userID, a.playerID]),
    );
    return { ok: true, assignments };
```

with:

```ts
    this.#mode = "active";
    this.#userToPlayer = new Map(
      assignments
        .filter((a): a is LobbyStartAssignment & { userID: string } => a.userID !== null)
        .map((a) => [a.userID, a.playerID]),
    );

    const hostPlayerID =
      assignments.length === 1
        ? null
        : (this.#userToPlayer.get(this.env.hostUserID) ?? null);

    return { ok: true, assignments, hostPlayerID };
```

- [ ] **Step 5: Update existing tests in lobby-runtime.test.ts that asserted on result shape**

Search for any existing test that does `expect(result).toEqual({ ok: true, assignments: [...] })` — those will now fail because the result has an extra `hostPlayerID` field.

The existing test at line 64-70 (in `start() requires both players seated and ready`) checks `result.assignments` after a narrow check. That should still pass. But if any test does a full `toEqual` on the result object, update it to include `hostPlayerID`.

Run: `bun run --filter @openturn/server test 2>&1 | head -100`

Expected: Identify and fix any test expecting an exact result shape. Update those tests to assert `hostPlayerID` explicitly per the resolution rule.

- [ ] **Step 6: Run tests + typecheck**

Run: `bun run --filter @openturn/server test && bun run --filter @openturn/server typecheck`

Expected: All tests PASS. Typecheck PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/lobby-runtime.ts packages/server/src/lobby-runtime.test.ts
git commit -m "server: compute hostPlayerID in LobbyRuntime.start()"
```

---

## Task 5: Persist hostPlayerID on InitMeta and propagate to runtime

**Files:**
- Modify: `packages/server/src/worker.ts:80-108` (InitMeta), `:546-560` (meta init), `:672-795` (handleStart), `:1190-1212` (getOrCreateRuntime activeDeployment)

- [ ] **Step 1: Add `hostPlayerID` to `InitMeta`**

Edit `packages/server/src/worker.ts:80-108`. In the `InitMeta` interface, after `activePlayerIDs`, add:

```ts
interface InitMeta {
  initialNow: number;
  roomID: MatchID;
  hostUserID: string;
  minPlayers: number;
  maxPlayers: number;
  initialTargetCapacity: number;
  playerIDs: readonly string[];
  activePlayerIDs: readonly string[] | null;
  /**
   * Resolved at `lobby:start` per LobbyRuntime's rule (see lobby-runtime.ts).
   * Threaded into `match.hostPlayerID` when the room runtime is constructed.
   * Null pre-start; set permanently at start.
   */
  hostPlayerID: string | null;
  websocketURLBase: string | null;
  cloudAPIBase: string | null;
}
```

- [ ] **Step 2: Initialize `hostPlayerID` to `null` in meta-init**

Edit `packages/server/src/worker.ts:546-557`. Add `hostPlayerID: null` to the meta object literal:

```ts
const meta: InitMeta = {
  initialNow: input.initialNow ?? Date.now(),
  roomID: input.roomID,
  hostUserID: input.hostUserID,
  minPlayers: deploymentMinPlayers,
  maxPlayers: deploymentMaxPlayers,
  initialTargetCapacity: deploymentMaxPlayers,
  playerIDs: deploymentPlayers,
  activePlayerIDs: null,
  hostPlayerID: null,
  websocketURLBase: input.websocketURLBase ?? null,
  cloudAPIBase: input.cloudAPIBase ?? null,
};
```

- [ ] **Step 3: Persist `hostPlayerID` in `handleStart`**

Edit `packages/server/src/worker.ts:693-698`. Currently:

```ts
const activePlayerIDs = startResult.assignments
  .slice()
  .sort((a, b) => a.seatIndex - b.seatIndex)
  .map((a) => a.playerID);
meta = { ...meta, activePlayerIDs };
await this.ctx.storage.put(META_KEY, meta);
```

Change to:

```ts
const activePlayerIDs = startResult.assignments
  .slice()
  .sort((a, b) => a.seatIndex - b.seatIndex)
  .map((a) => a.playerID);
meta = { ...meta, activePlayerIDs, hostPlayerID: startResult.hostPlayerID };
await this.ctx.storage.put(META_KEY, meta);
```

- [ ] **Step 4: Apply `hostPlayerID` in `getOrCreateRuntime`'s activeDeployment**

Edit `packages/server/src/worker.ts:1202-1211`. Replace the `activeDeployment` const with:

```ts
const activeDeployment =
  meta.activePlayerIDs === null
    ? hydratedDeployment
    : {
        ...hydratedDeployment,
        match: {
          ...(hydratedDeployment.match ?? { players: hydratedDeployment.game.playerIDs }),
          players:
            meta.activePlayerIDs.length === meta.maxPlayers
              ? (hydratedDeployment.match?.players ?? hydratedDeployment.game.playerIDs)
              : meta.activePlayerIDs,
          hostPlayerID: meta.hostPlayerID,
        } as NonNullable<typeof hydratedDeployment.match>,
      };
```

(Note: when `activePlayerIDs.length === meta.maxPlayers` we still apply `hostPlayerID` but keep the original `players`, preserving the prior optimization for the no-subset case.)

- [ ] **Step 5: Typecheck**

Run: `bun run --filter @openturn/server typecheck`

Expected: PASS. If a type error fires because `hydratedDeployment.match` doesn't accept `hostPlayerID`, double-check that Task 1's `MatchInput` change is on disk.

- [ ] **Step 6: Run tests**

Run: `bun run --filter @openturn/server test`

Expected: All existing tests PASS. (No new tests in this task — the next task adds a worker-level integration test if useful, but the lobby-runtime tests + core tests already cover behavior end-to-end.)

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/worker.ts
git commit -m "server: thread hostPlayerID from lobby start into match"
```

---

## Task 6: Plumb hostPlayerID through local lobby's onTransitionToGame

**Files:**
- Modify: `packages/lobby/src/react/use-local-lobby.ts:60-67` (onTransitionToGame option), `:170-213` (start handler)

- [ ] **Step 1: Update `onTransitionToGame` callback shape**

Edit `packages/lobby/src/react/use-local-lobby.ts:60-67`. Change:

```ts
onTransitionToGame?: (input: {
  roomID: string;
  assignments: ReadonlyArray<LobbyStartAssignment>;
}) => void;
```

to:

```ts
onTransitionToGame?: (input: {
  roomID: string;
  assignments: ReadonlyArray<LobbyStartAssignment>;
  /**
   * Host's playerID at start (per LobbyRuntime's resolution rule). Null for
   * single-player, spectating host, or absent host. Consumers writing
   * MatchInput should pass this through to `match.hostPlayerID`.
   */
  hostPlayerID: string | null;
}) => void;
```

- [ ] **Step 2: Pass `hostPlayerID` from the start result**

Edit `packages/lobby/src/react/use-local-lobby.ts:170-213`. In the `start: () => { ... }` handler, find the `onTransitionRef.current?.(...)` call near line 209 and update it to include `hostPlayerID`:

```ts
onTransitionRef.current?.({
  roomID: LOCAL_ROOM_ID,
  assignments: result.assignments,
  hostPlayerID: result.hostPlayerID,
});
```

- [ ] **Step 3: Typecheck**

Run: `bun run --filter @openturn/lobby typecheck`

Expected: PASS. The `LobbyStartResult.hostPlayerID` field added in Task 4 makes this typecheck cleanly.

- [ ] **Step 4: Run lobby tests**

Run: `bun run --filter @openturn/lobby test`

Expected: PASS. (No existing lobby tests should depend on the shape of `onTransitionToGame`'s argument since it's a callback signature.)

- [ ] **Step 5: Commit**

```bash
git add packages/lobby/src/react/use-local-lobby.ts
git commit -m "lobby: pass hostPlayerID through onTransitionToGame callback"
```

---

## Task 7: Full-monorepo verification

**Files:** All modified files from Tasks 1-6.

- [ ] **Step 1: Run full typecheck**

Run from `openturn/` root: `bun run typecheck`

Expected: PASS for every workspace. Any failure here is a missed plumb-through (e.g., an example game referencing `MatchInput` with a tighter shape).

- [ ] **Step 2: Run full test suite**

Run from `openturn/` root: `bun run test`

Expected: PASS for every workspace.

- [ ] **Step 3: Spot-check the spec checklist**

Manually verify against `openturn/superpowers/specs/2026-05-05-host-player-id-design.md`:

- [ ] `MatchInput.hostPlayerID` field added (Task 1)
- [ ] `undefined → null` normalization (Task 2)
- [ ] `invalid_host_player` error (Task 2)
- [ ] `single_player_host_set` error (Task 2)
- [ ] `isHost(match, playerID)` exported (Task 3)
- [ ] Lobby resolution rule: single-player → null (Task 4)
- [ ] Lobby resolution rule: seated host → playerID (Task 4)
- [ ] Lobby resolution rule: spectating host → null (Task 4)
- [ ] `hostPlayerID` flows from `LobbyStartResult` → `InitMeta` → `match.hostPlayerID` (Task 5)
- [ ] Local lobby surfaces `hostPlayerID` to `onTransitionToGame` consumers (Task 6)

- [ ] **Step 4: Commit any final fixes if Step 1 or 2 surfaced issues**

```bash
git add <modified files>
git commit -m "fix: <description of integration-level fix>"
```

If the full suite was clean on the first try, no commit needed.

---

## Notes for the executing engineer

- **Read order:** `packages/core/src/types.ts:91-102` → spec → this plan.
- **Replay determinism**: `match.hostPlayerID` lives in `meta.match` (snapshot's match), which is replayed verbatim. No change needed to the replay layer.
- **Backwards compatibility**: existing games that don't set `hostPlayerID` continue to work — they receive `null` after normalization. Existing matches stored before this change deserialize correctly (the field is absent → normalized to null on session creation).
- **What's intentionally NOT here**: cloud worker code does not validate "host must be seated at start" (per spec, Slice A leaves lobby Start preconditions unchanged). If host kept their seat but disconnected, the game starts with a stalled active player — Slice B (deadline enforcement) is what unblocks that.

---

## Self-review notes

Cross-checked against the spec:

- **Spec coverage:** Every spec section maps to a task. Checked off in Task 7's spot-check.
- **Placeholder scan:** No TBDs, TODOs, or "implement appropriate X" steps. All code blocks are complete.
- **Type consistency:** `match.hostPlayerID` typed as `TPlayers[number] | null` in input, `string | null` in lobby/worker (where the player union is erased). `isHost` accepts `string | null` to match. Field name spelled identically across Tasks 1, 2, 3, 4, 5, 6.
- **Test coverage:** Unit tests for validation (Task 2), helper (Task 3), and lobby resolution (Task 4) hit each branch of the resolution rule and each validation error code. Integration coverage at the worker layer is implicit — the existing worker tests run with the new `match.hostPlayerID` plumbing and remain green (verified in Task 5 Step 6 and Task 7).
