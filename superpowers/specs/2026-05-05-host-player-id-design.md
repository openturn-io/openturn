# Host PlayerID Primitive — Design

**Date:** 2026-05-05
**Status:** Approved for implementation
**Scope:** Slice A of a larger thread (turn timers, host-only flows). Slice B (deadline enforcement) is deferred.

## Goal

Surface host identity inside running games as a stable, replayable `PlayerID`, so games can author host-only flows — config-as-state, settings forms, draft phases — without the runtime needing a dedicated config system.

The lobby already tracks `hostUserID`. Once the game starts, the runtime sees a list of equal players and has no concept of "host." This bridges that gap with the smallest possible primitive.

## Non-Goals

- A typed config schema or validation system.
- Auto-rendered settings forms.
- Lobby-side `host:set_config` protocol messages.
- Turn timer / deadline enforcement.
- Host handoff during a running game.
- A "facilitator" role for spectating hosts to control the game.

These are independently valuable but out of scope. The primitive in this slice is what makes most of them possible later if needed; for now, games that want host-only flows implement them as normal game states.

## Design

### Type change

`MatchInput` (in `packages/core/src/types.ts`) gains one optional field:

```ts
export interface MatchInput<TPlayers, TMatchData = ReplayValue> {
  data?: TMatchData;
  players: readonly [TPlayers[number], ...TPlayers[number][]];
  profiles?: Partial<Readonly<PlayerRecord<TPlayers, ReplayValue>>>;
  hostPlayerID?: TPlayers[number] | null;   // NEW
}
```

After validation, the field is treated as `PlayerID | null` everywhere it's read. `null` means "no host." The validator normalizes `undefined` (field absent) to `null`, so consumers never see `undefined` and don't need to handle three states. Existing games that never set the field continue to receive `null`.

**Terminology note:** "spectating host" in this document means the lobby has a `hostUserID` but that user has not taken a seat — they intend to watch the match without playing.

The field is reachable from any context that has `match`:
- `ctx.match.hostPlayerID` in state configs (`activePlayers`, `control`, `deadline`, etc.)
- `ctx.match.hostPlayerID` in transition resolvers
- `ctx.match.hostPlayerID` in view functions
- `snapshot.meta.match.hostPlayerID` from outside the runtime (clients, replays, inspector)

### Resolution rule (lobby at `start()`)

In `packages/server/src/lobby-runtime.ts`'s `start()`, after the `#userToPlayer` map is built and `assignments` are computed, derive `hostPlayerID` and pass it through to the engine's `MatchInput`:

```ts
const hostPlayerID =
  assignments.length === 1
    ? null                                                    // single-player → no host
    : (this.#userToPlayer.get(this.env.hostUserID) ?? null);  // seated host or null
```

Three null-producing cases collapse cleanly:
- **Single-player session.** Even if the only seated player is also the lobby's `hostUserID`, `hostPlayerID` is `null`. Game authors don't need to think about a host concept that's redundant with "the player."
- **Multi-player with host spectating.** Host has a `userID` known to the lobby but never took a seat.
- **Multi-player where host left before Start.** Host had a seat, freed it, and `hostUserID → playerID` lookup misses.

All three semantically mean "no one has setup authority." Game authors who write `if (match.hostPlayerID === null) { ...fallback }` handle all three the same way, which is what we want.

`LobbyStartAssignment` (or whatever shape carries the start handoff) needs to carry `hostPlayerID` from `start()` through to wherever `MatchInput` is constructed.

### Validation

In `packages/core/src/validation.ts`, the MatchInput validator gains two checks:

| Condition | Error code |
|-----------|-----------|
| `hostPlayerID` is non-null but not in `players` | `invalid_host_player` |
| `players.length === 1` and `hostPlayerID` is non-null | `single_player_host_set` |

The first prevents malformed input. The second enforces the single-player invariant — single-player games must always have `null`, never a player ID.

Existing games that don't set the field pass `undefined`, normalize to `null`, and pass both checks.

### Immutability and replay

`hostPlayerID` is set once at `lobby:start`, baked into `meta.match`. The replay layer reads it from `MatchInput` verbatim, giving fully deterministic replays.

**Host identity does not change after Start.** If the original host disconnects, leaves, or "hands off" in a future feature, `match.hostPlayerID` stays the same. The runtime's view of "who is the host" is fixed at game-start. Game logic that needs to detect host absence reads it from the existing presence/disconnect channel — not from `match`.

This is the load-bearing invariant. `match` is immutable, replay-deterministic state. Putting "current host" there would break replay determinism. Putting "host at game-start" there does not.

### Edge case behaviors

| Case | `hostPlayerID` | Notes / game-author guidance |
|------|---------------|------------------------------|
| Single-player session | `null` | Don't use the host pattern; just `activePlayers: [players[0]]` |
| Multi-player, host seated | host's playerID | Use `activePlayers: ctx => ctx.match.hostPlayerID ? [ctx.match.hostPlayerID] : []` for setup states |
| Multi-player, host spectating | `null` | Game chooses fallback (e.g., `match.hostPlayerID ?? players[0]`), or refuses to enter the setup state |
| Host disconnects mid-game | unchanged | Game stalls if host is the sole active player. Slice B (deadline enforcement) is what unblocks this; until then, accept the stall |
| Host leaves lobby pre-Start, freed seat | `null` at Start | Maps to "host spectating" case |
| Host leaves lobby pre-Start, kept seat | host's playerID at Start | Game starts stalled on the disconnected host. Mirrors existing lobby behavior — Slice A does not change lobby Start preconditions |
| All-bot match | impossible | Lobbies require a human host |
| Bot host | impossible | Hosts are users, not bots |

The "host kept their seat but is disconnected at Start" case is intentionally not blocked by validation — it matches what would happen with any other disconnected player. Slice A does not enforce host presence at Start; if that turns out to matter, it's a follow-up.

### Game-author API

Primary: direct read.

```ts
// state config
state("setup", {
  activePlayers: ctx =>
    ctx.match.hostPlayerID !== null ? [ctx.match.hostPlayerID] : [],
  // ...
});

// view
view({
  forPlayer: (G, ctx, playerID) => ({
    isHost: playerID === ctx.match.hostPlayerID,
    // ...
  }),
});
```

Optional helper exported from `@openturn/core` to make the pattern discoverable:

```ts
export function isHost(match: MatchInput, playerID: PlayerID): boolean {
  return match.hostPlayerID !== null && match.hostPlayerID === playerID;
}
```

`isHost` returns `false` when `hostPlayerID` is `null` — single-player and spectating-host cases produce the right "no, you are not the host" answer for any caller.

### Lobby UI changes

None for Slice A. The existing `isHost` UI logic in `packages/lobby/src/react/lobby.tsx` (line 254) operates at the `userID` level during the lobby phase, which is correct and unchanged. The new `match.hostPlayerID` is a runtime-side concept that doesn't affect lobby rendering.

A "host is spectating — they will not be able to control setup" warning before Start is optional polish and deferred.

## Tests

### Type-level

- `MatchInput<["alice", "bob"]>.hostPlayerID` accepts `"alice" | "bob" | null | undefined`, rejects `"carol"` or other strings.
- `ctx.match.hostPlayerID` in a state config is correctly inferred as `TPlayers[number] | null`.

### Resolution (in `lobby-runtime` tests)

- Multiplayer, host seated → `hostPlayerID = host's seat playerID`
- Multiplayer, host spectating → `null`
- Single-player session (one seated assignment) → `null`, even when seated player is the host user
- Multiplayer, host had seat then freed it → `null` at Start

### Validation (in `validation` tests)

- `hostPlayerID` not in `players` → `invalid_host_player`
- Single-player with non-null `hostPlayerID` → `single_player_host_set`
- Existing snapshots / fixtures with no `hostPlayerID` field → still validate (back-compat)

### Replay determinism

- A snapshot at turn N matches between (a) a session where the host disconnected and reconnected and (b) a session where they stayed connected — assuming the same input log.
- `meta.match.hostPlayerID` survives serialize → replay → deserialize.

### Game-author read

- State config reading `ctx.match.hostPlayerID` returns the resolved value at every state evaluation (not undefined).
- `isHost(match, playerID)` returns `false` for all `playerID` when `match.hostPlayerID` is `null`.

## Implementation surface

Files expected to change:

| File | Change |
|------|--------|
| `packages/core/src/types.ts` | Add `hostPlayerID?` to `MatchInput` |
| `packages/core/src/validation.ts` | Two new validation cases (`invalid_host_player`, `single_player_host_set`) |
| `packages/core/src/index.ts` | Export `isHost` helper |
| `packages/core/src/runtime.ts` (or wherever helpers live) | Implement `isHost` |
| `packages/server/src/lobby-runtime.ts` | Compute `hostPlayerID` in `start()`; surface it via `LobbyStartResult` / `LobbyStartAssignment` |
| `packages/server/src/worker.ts` (and any other host that constructs `MatchInput` from `LobbyStartResult`) | Thread `hostPlayerID` from start result into `MatchInput` |
| `packages/lobby/src/react/use-local-lobby.ts` | If it constructs `MatchInput` directly, plumb `hostPlayerID` through |
| Test files alongside the above | Coverage per the test list |

The change is type-additive throughout; no existing game's behavior changes unless it opts in by reading the new field.
