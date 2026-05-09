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

> The snippets below target the in-tree `examples/games/pig-dice` (whose `roll` move takes `{ value }` as `args`). If you adopted the SKILL.md inline-`rng.d6()` variant of pig-dice, drop the `{ value }` payloads (`session.applyEvent("0", "roll", undefined)`) and pin a deterministic seed via `createLocalSession(pigDice, { match, seed: "test" })` so the rolls are reproducible.

## A passing-move test

```ts
test("rolling above one keeps the turn", () => {
  const session = createLocalSession(pigDice, { match });
  expect(session.applyEvent("0", "roll", { value: 5 }).ok).toBe(true);
  expect(session.getState().G.turnTotal).toBe(5);
  expect(session.getState().derived.activePlayers).toEqual(["0"]);
});
```

`applyEvent(playerID, eventName, payload)` returns `{ ok: true, ... }` on success. Always assert `.ok === true` before reading `getState()` — otherwise a rejected event leaves `G` unchanged and your downstream assertions read pre-move state, producing confusing "expected 5, got 0" failures with no hint that the dispatch was the culprit.

> **Gotcha — the auto-injected `__gamekit` field.** After `setup`, `getState().G` includes a `__gamekit: { result: null }` field that gamekit injects to track terminal status. Full-equality assertions (`expect(state.G).toEqual({ ... })`) must include it, or they fail with a confusing "extra property" diff. Prefer **partial assertions** on the fields you actually care about (`expect(state.G.board[5][3]).toBe("0")`) rather than `toEqual` on the full `G`. If you do need a full-state assertion, see `examples/games/pig-dice/game/src/pig-dice.test.ts` — it includes `__gamekit: { result: null }` explicitly.

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

`LocalGameSessionOptions` also accepts `now: number` (default `0`). `now` is the recorded wall time for the initial snapshot — only matters if your game reads `ctx.now` (e.g. for deadline scoring). Pin it explicitly for any test that exercises time-dependent logic.

## Bot tests

Use the integration pattern that the in-tree examples use — `attachLocalBots` plus a `playToCompletion` helper that loops `whenIdle` until `meta.result` is set. Hand-constructing a `DecideContext` to unit-test `decide` directly is possible but rarely worth it: the context has 8 fields including a forked `BotRng`, a `DeadlineToken`, an `AbortSignal`, and a pre-bound `simulate`. Stubbing all of them realistically is more work than just running the bot in a real session.

```ts
import { attachLocalBots, type Bot } from "@openturn/bot";
import { createLocalSession } from "@openturn/core";

async function playToCompletion(
  rawSession: ReturnType<typeof createLocalSession<typeof game, typeof match>>,
  bots: Record<string, Bot<typeof game>>,
) {
  const { session, isBot, whenIdle, detachAll } = attachLocalBots({ session: rawSession, game, bots });
  for (let i = 0; i < 100; i++) {
    const snap = session.getState();
    if (snap.meta.result) break;
    const active = snap.derived.activePlayers[0]!;
    if (isBot(active)) await whenIdle(active);
  }
  const final = session.getState().meta.result;
  detachAll();
  return final;
}

test("1000 random-vs-random matches terminate", async () => {
  for (let i = 0; i < 1000; i++) {
    const session = createLocalSession(game, { match, seed: `match-${i}` });
    const result = await playToCompletion(session, { "0": randomBot, "1": randomBot });
    expect(result).not.toBeNull();
  }
}, 30_000);
```

This catches infinite-loop bugs, illegal-action regressions, and deadlock conditions in one suite. See `examples/games/tic-tac-toe/bots/src/index.test.ts` and `examples/games/splendor/bots/src/index.test.ts` for the canonical implementations.

## See also

- `examples/games/pig-dice/game/src/pig-dice.test.ts`
- `examples/games/tic-tac-toe/game/src/tic-tac-toe.test.ts`
- `examples/games/splendor/game/src/splendor.test.ts`
