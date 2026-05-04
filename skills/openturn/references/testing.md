# Testing reference

Tests for an Openturn game definition use `createLocalSession` from `@openturn/core` plus `bun:test`. Each test constructs a fresh session, dispatches a sequence of moves via `applyEvent`, and asserts on `getState().G`, `getState().derived.activePlayers`, and `getState().meta.result`.

## Setup

```ts
import { describe, expect, test } from "bun:test";
import { createLocalSession } from "@openturn/core";
import { pigDice } from "./index";

const match = { players: pigDice.playerIDs };
```

One `match` constant per file. Build a fresh session inside every `test` — never share session state across tests.

## A passing-move test

```ts
test("rolling above one keeps the turn", () => {
  const session = createLocalSession(pigDice, { match });
  expect(session.applyEvent("0", "roll", { value: 5 }).ok).toBe(true);
  expect(session.getState().G.turnTotal).toBe(5);
  expect(session.getState().derived.activePlayers).toEqual(["0"]);
});
```

`applyEvent(playerID, eventName, payload)` returns `{ ok: true, ... }` on success. Always assert `.ok === true` before reading `getState()`, or the test will pass silently when the move is rejected.

## A rejected-move test

```ts
test("holding with empty turn is rejected", () => {
  const session = createLocalSession(pigDice, { match });
  expect(session.applyEvent("0", "hold", undefined)).toEqual({
    ok: false,
    error: "invalid_event",
    reason: "empty_turn",
    details: { turnTotal: 0 },
  });
});
```

Every `move.invalid({ reason, details })` produces this exact shape. `reason` is the string you passed; `details` is whatever payload you returned. Assert on both — `reason` alone is not enough to distinguish two rejections of the same move.

## A finishing-move test

```ts
test("reaching target score sets the winner", () => {
  const session = createLocalSession(pigDice, { match });
  session.applyEvent("0", "roll", { value: 6 });
  session.applyEvent("0", "roll", { value: 6 });
  session.applyEvent("0", "roll", { value: 6 });
  session.applyEvent("0", "roll", { value: 6 });
  session.applyEvent("0", "hold", undefined);

  expect(session.getResult()).toEqual({ winner: "0" });
  expect(session.getState().meta.result).toEqual({ winner: "0" });
});
```

`getResult()` is `null` until a move calls `move.finish(result)`. `getState().meta.result` mirrors it.

## Authoring discipline

- One test per move outcome (`endTurn`, `stay`, `finish`, `invalid`) before adding the next move.
- When you find a bug, write a test that reproduces it before fixing.
- Local sessions are fast — a small game's suite runs in tens of ms. Don't batch unrelated assertions into one test to "save time."

## Determinism in tests

Sessions are deterministic given the same seed. If the game uses `ctx.rng`, fix the seed via `createLocalSession(game, { match, seed: "test-seed" })`. The same seed plus the same action sequence always produces the same `G`. Default seed is `"default"` (see `packages/core/src/session.ts:116`).

## Bot tests

Two complementary patterns:

- **Unit-test `decide`** by passing a hand-built `DecideContext` (`{ G, playerID, legalActions, rng, ... }`) and asserting the chosen action is one of `legalActions`. This catches "bot returns a stale or illegal action" regressions cheaply.
- **Integration-test** by playing many random-vs-random matches in a loop and asserting every match terminates with `getState().meta.result` set (no infinite games, no deadlocks).

See `examples/games/tic-tac-toe/bots/src/index.test.ts` and `examples/games/splendor/bots/src/index.test.ts`.

## See also

- `examples/games/pig-dice/game/src/pig-dice.test.ts`
- `examples/games/tic-tac-toe/game/src/tic-tac-toe.test.ts`
- `examples/games/splendor/game/src/splendor.test.ts`
