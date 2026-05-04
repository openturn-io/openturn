# Gamekit reference

This reference covers `@openturn/gamekit`'s `defineGame` API. Use it when authoring a game's state, moves, phases, turns, or `legalActions`. For lower-level state-graph control, see `core.md`. For randomness specifically, see `randomness.md`.

## defineGame fields

- `playerIDs: readonly string[]` — fixed set of seat IDs (e.g. `["0", "1"] as const`). Required for typed `playerID` in moves and views.
- `maxPlayers?: number`, `minPlayers?: number` — used by lobby; pure metadata for local play.
- `setup({ match, now, profiles, seed }) => TState` — initial `G`. `match` includes `players`. `seed` is the deterministic RNG seed (use it for any setup-time randomness so replays match). `profiles` is the per-player profile snapshot. Use `roster.record(match, defaultValue)` from `@openturn/core` to build a per-player record.
- `moves: ({ move }) => Record<string, GamekitMoveDefinition>` — factory; receives the `move` helper.
- `views?: { public?, player? }` — see `views.md`.
- `phases?: Record<TPhase, GamekitPhaseConfig>`, `initialPhase?: TPhase` — see "Phases" below.
- `turn?: TurnPolicy` — only `turn.roundRobin()` is built-in today.
- `legalActions?: ({ G, derived }, playerID) => readonly LegalAction[]` — bot enumeration contract. Required if any bot will use a game-defined enumerator. See `bots.md`.
- `computed?: ComputedMap` — derived values exposed as `C` in move/view contexts.
- `profile?: GameProfileConfig` — replay-safe per-player progression across matches.
- `core?: GamekitCoreDefinition` — escape hatch into `@openturn/core`. Avoid unless you've hit a wall.

## The move() helper

```ts
moves: ({ move }) => ({
  myMove: move<{ amount: number }>({
    run(ctx) {
      return ctx.move.endTurn({ score: ctx.G.score + ctx.args.amount });
    },
  }),
}),
```

The type parameter on `move<TArgs>(...)` declares the payload type passed via `applyEvent(playerID, "myMove", payload)`. Omit it for `args: undefined`.

## MoveRunContext

Fields available inside `run(ctx)`:

- `G: DeepReadonly<TState>` — current state. **Never mutate.**
- `args: TArgs` — payload from `applyEvent`.
- `move: MoveHelpers` — outcome helpers (next section).
- `player: { id: PlayerID }` — who is dispatching this move.
- `rng: DeterministicRng` — randomness (see `randomness.md`).
- `profile: ProfileMutation` — for committing replay-safe progression (advanced).
- Plus `C` (computed values), `phase` (current phase), `turn` (turn context), and `profiles` (per-player profile snapshot) for read-only reference. **Note:** there is no `derived` field on `MoveRunContext` — `derived` only exists on rule contexts like `legalActions`.

## Move outcomes (move.*)

- `move.endTurn(patch?, options?)` — apply `patch` (shallow merge into `G`) and pass turn to next active player per turn policy.
- `move.stay(patch?, options?)` — apply `patch` and keep the turn on the current player. Use for multi-step moves within a turn (pig-dice "roll again") or to wait for other players in a simultaneous phase.
- `move.goto(phase, patch?, options?)` — change phase. Pass `options.endTurn: true` to also pass the turn.
- `move.finish({ winner?, draw? }, patch?, options?)` — terminal outcome. Ends the match: `winner` (a `PlayerID`) and/or `draw: true` set the result; `patch` shallow-merges into `G` for the final state.
- `move.invalid(reason?, details?)` — reject the dispatch. `applyEvent` returns `{ ok: false, error: "invalid_event", reason, details }`. Use for rule violations like "you can't hold without rolling."
- **`move.continue` does not exist.** If the user mentions it, they're thinking of `move.stay`.

## Phases

`phases: Record<TPhase, { activePlayers?, label? }>`. `initialPhase` selects the starting phase. Each phase's `activePlayers` filters who can dispatch moves. **Phases are for distinct rule sets, not intra-turn steps.**

```ts
phases: {
  plan:   { activePlayers: ({ G }) => G.pendingPlanners },
  battle: {},
},
initialPhase: "plan",
moves: ({ move }) => ({
  submitPlan: move<{ plan: string }>({
    run({ G, args, player, move }) {
      const plans = { ...G.plans, [player.id]: args.plan };
      const remaining = G.pendingPlanners.filter((id) => id !== player.id);
      if (remaining.length > 0) return move.stay({ plans, pendingPlanners: remaining });
      return move.goto("battle", { plans, pendingPlanners: remaining }, { endTurn: true });
    },
  }),
}),
```

## Turns

`turn: turn.roundRobin()` is the only built-in policy. Import from `@openturn/gamekit`:

```ts
import { turn } from "@openturn/gamekit";
```

For custom turn order, drop to `core` (see `core.md`).

## Common mistakes

- Mutating `G` (`G.scores[id] += 1`). Always spread: `{ ...G.scores, [id]: (G.scores[id] ?? 0) + 1 }`.
- Returning bare `G` from a move instead of a `move.*` outcome.
- Putting `Date`, `Map`, `Set`, or class instances in `G`. Use plain JSON shapes only.
- Using `Math.random` / `Date.now` inside a move (replays diverge). Use `ctx.rng` — see `randomness.md`.
- Modeling intra-turn state as a phase. Use `G` for that; phases are for rule changes.
- Trying to use `move.continue` (doesn't exist). Use `move.stay`.

## See also

- Full pig-dice example: [`examples/games/pig-dice/game/src/index.ts`](https://github.com/openturn-io/openturn/tree/main/examples/games/pig-dice/game/src/index.ts)
- Tic-tac-toe with phases: [`examples/games/tic-tac-toe/game/src/`](https://github.com/openturn-io/openturn/tree/main/examples/games/tic-tac-toe/game/src/)
- Splendor (full-scale): [`examples/games/splendor/`](https://github.com/openturn-io/openturn/tree/main/examples/games/splendor/)
- Human docs: https://openturn.io/docs/how-to/author-with-gamekit
- Reference: https://openturn.io/docs/reference/gamekit
