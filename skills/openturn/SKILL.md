---
name: openturn
description: Use when authoring an Openturn turn-based or board game — when the workspace has @openturn/gamekit or @openturn/core in package.json, contains defineGame(...), or when the user mentions openturn, gamekit, defineGame, or asks to build a turn-based / board game in TypeScript. Covers game state, moves, views, phases, turns, hidden info, randomness, simultaneous moves, bots, and testing.
---

# Authoring Openturn games

Openturn is a TypeScript framework where one `defineGame(...)` value drives local play, hosted multiplayer, the inspector, replays, and bots. This skill calibrates you on the game-definition layer (`@openturn/gamekit`, `@openturn/core`, `@openturn/bot`). Out of scope: React bindings, lobby, hosting, deploy, the inspector — point users at https://openturn.io/docs for those.

## When to use this skill

Use this skill when:
- The workspace `package.json` has `@openturn/gamekit`, `@openturn/core`, or `@openturn/bot` in dependencies.
- A file in the workspace contains `defineGame(`.
- The user asks to build a turn-based or board game in TypeScript, or mentions Openturn, gamekit, or `defineGame` by name.

Do NOT use this skill for:
- Realtime/action games (Openturn is turn-based).
- Hosting, deploy, multiplayer infrastructure questions — defer to `https://openturn.io/docs/how-to/deploy-to-openturn-cloud` and `https://openturn.io/docs/how-to/run-local-hosted`.
- React UI / inspector / lobby questions — defer to `https://openturn.io/docs/how-to/`.

## Core rules-of-thumb

- **Game state `G` is plain JSON.** No class instances, no `Date`, `Map`, `Set`, `RegExp`, or functions in `G`. If you need a map, use a record. If you need a set, use a record-of-booleans or a sorted array.
- **Moves are pure reducers.** Return next state via one of: `move.endTurn(patch)`, `move.stay(patch)`, `move.goto(phase, patch)`, `move.finish({ winner }, patch)`, `move.invalid(reason, details)`. **Never mutate `G`.** There is no `move.continue` — use `move.stay`.
- **All randomness goes through `ctx.rng`** (a `DeterministicRng`). Methods: `rng.int(maxExclusive)`, `rng.bool()`, `rng.pick(arr)`, `rng.dice(count, sides)`, `rng.d4()` … `rng.d100()`, `rng.advantage()`, `rng.disadvantage()`, `rng.next()`. Never call `Math.random`, `Date.now`, or `crypto.*` inside a move or a bot's `decide` — replays will diverge.
- **Hidden info lives inside `G`.** `views.public` and `views.player` decide what leaves the server. If a secret can be derived from the public view, it's leaked. Default behavior: omitted `views.public` returns full `G`; omitted `views.player` returns the public view. Always set both for any game with hidden state.
- **Choose `@openturn/gamekit` before `@openturn/core`.** Drop to core only when the state graph genuinely needs custom transitions (rare).
- **Phases are for distinct rule sets** (planning, bidding, battle), not for "current step inside a turn." Use `G` to track intra-turn state. The only built-in turn policy is `turn.roundRobin()`.
- **Author one move at a time and verify it before adding the next.** Use `createLocalSession` + `applyEvent` in a `bun:test` to exercise each move in isolation.

## Canonical example — pig-dice

A complete two-player game with hidden-from-yourself randomness (the next roll), a clear win condition, and per-turn state. Distilled from `examples/games/pig-dice/game/src/index.ts`.

```ts
import { roster, type PlayerRecord } from "@openturn/core";
import { defineGame, turn } from "@openturn/gamekit";

const PLAYERS = ["0", "1"] as const;
const TARGET = 20;

interface State {
  lastRoll: number | null;
  scores: PlayerRecord<typeof PLAYERS, number>;
  turnTotal: number;
}

export const pigDice = defineGame({
  playerIDs: PLAYERS,
  setup: ({ match }): State => ({
    lastRoll: null,
    scores: roster.record(match, 0),
    turnTotal: 0,
  }),
  moves: ({ move }) => ({
    roll: move({
      run({ G, move, rng }) {
        const value = rng.d6();                         // deterministic, replay-safe
        if (value === 1) return move.endTurn({ lastRoll: 1, turnTotal: 0 });
        return move.stay({ lastRoll: value, turnTotal: G.turnTotal + value });
      },
    }),
    hold: move({
      run({ G, move, player }) {
        if (G.turnTotal === 0) return move.invalid("empty_turn", { turnTotal: 0 });
        const next = { ...G.scores, [player.id]: (G.scores[player.id] ?? 0) + G.turnTotal };
        if ((next[player.id] ?? 0) >= TARGET) {
          return move.finish({ winner: player.id }, { lastRoll: null, scores: next, turnTotal: 0 });
        }
        return move.endTurn({ lastRoll: null, scores: next, turnTotal: 0 });
      },
    }),
  }),
  turn: turn.roundRobin(),
  views: {
    public: ({ G, turn }) => ({
      currentPlayer: turn.currentPlayer,
      lastRoll: G.lastRoll,
      scores: G.scores,
      turnTotal: G.turnTotal,
    }),
  },
});
```

What each piece maps to:
- `playerIDs`, `setup`: game shape and initial `G`.
- `moves`: pure reducers; `move.invalid` rejects, `move.stay` keeps the turn, `move.endTurn` passes it, `move.finish` ends the match.
- `rng.d6()`: replay-safe randomness.
- `turn.roundRobin()`: built-in turn policy.
- `views.public`: what spectators and both players see (this game has no hidden info — every roll is public).

## Decision tree — when to read which reference

- Writing the core game definition (state, moves, phases, turn)? → `references/gamekit.md`
- Need lower-level state-graph control beyond what gamekit can express? → `references/core.md`
- Designing what each player sees (hidden info, fog of war, sealed bids)? → `references/views.md`
- Anything involving dice, decks, shuffles, random picks? → `references/randomness.md`
- Players act at the same time (planning phases, simultaneous bids)? → `references/simultaneous-moves.md`
- Building a bot to play a seat? → `references/bots.md`
- Writing tests for a game definition? → `references/testing.md`

## Out of scope

This skill does not cover React bindings, lobby, multiplayer hosting, Openturn Cloud deploy, the inspector, or replays-as-product. For those, point the user to https://openturn.io/docs/how-to/.

## Verifying your work

- Run `bunx openturn dev` and exercise the move in the inspector.
- For pure unit tests: `bun test` after writing tests with `createLocalSession` + `applyEvent` (see `references/testing.md`).
- After every move you author, dispatch it once via `applyEvent` and assert on `getState().G` and `getState().derived.activePlayers` before moving on.
