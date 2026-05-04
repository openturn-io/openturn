# Randomness reference

Openturn games run on authoritative state with replays and remote bots. Every random value used by a move or a bot must be reproducible from the same RNG seed, or replays diverge and bot decisions become non-deterministic. Use `ctx.rng` from inside a move and `ctx.rng` from inside a bot's `decide`. **Never call `Math.random`, `Date.now`, or `crypto.*` from those contexts.**

## API

`DeterministicRng` (from `@openturn/core`) exposes only these methods:

```ts
rng.int(maxExclusive: number): number;        // 0..maxExclusive-1
rng.bool(probability?: number): boolean;      // default 0.5
rng.pick<T>(values: readonly T[]): T;
rng.dice(count: number, sides: number): number;
rng.d4(); rng.d6(); rng.d8(); rng.d10(); rng.d12(); rng.d20(); rng.d100();
rng.advantage(): number;                      // max of two d20 rolls
rng.disadvantage(): number;                   // min of two d20 rolls
rng.next(): number;                           // raw [0, 1)
rng.getSnapshot(): RngSnapshot;
```

There is no `rng.shuffle` and no `rng.float`. Build them from `rng.int` / `rng.next`.

## Inside a move

`rng` is on `MoveRunContext` — destructure it from the run args:

```ts
roll: move({
  run({ G, move, rng }) {
    const value = rng.d6();
    if (value === 1) return move.endTurn({ lastRoll: 1, turnTotal: 0 });
    return move.stay({ lastRoll: value, turnTotal: G.turnTotal + value });
  },
}),
```

(The in-tree `examples/games/pig-dice` takes the dice value as `args` so the client can show an animation, but rolling inside the move with `rng.d6()` is equally valid and stays deterministic.)

## Inside `setup`

`GamekitSetupContext` exposes `seed: string`, **not** a ready-made `rng`. Build one yourself with `createRng(seed)` from `@openturn/core` if your initial state needs randomness (shuffled deck, randomized starting positions, etc.):

```ts
import { createRng } from "@openturn/core";
import { defineGame } from "@openturn/gamekit";

defineGame({
  // ...
  setup: ({ match, seed }) => {
    const rng = createRng(seed);
    return { deck: shuffle(buildDeck(), rng), /* ... */ };
  },
});
```

`createRng(seed, snapshot?)` is at `packages/core/src/runtime.ts:25`. Splendor uses this pattern in `examples/games/splendor/game/src/index.ts` (search for `createRng`).

## Inside a bot

```ts
defineBot({
  name: "random",
  decide: ({ legalActions, rng }) => rng.pick(legalActions),
});
```

Bot RNG is forked from the snapshot's RNG and salted by bot name + seat + turn, so two bots running on the same snapshot get different — but reproducible — streams.

## Forbidden

Never call any of these from a move's `run` or a bot's `decide`:

- `Math.random()` — non-deterministic.
- `Date.now()`, `new Date()`, `performance.now()` — non-deterministic.
- `crypto.randomUUID()`, `crypto.getRandomValues()` — non-deterministic.
- Any external API call from inside a move (network fetches, file reads, env reads). Moves must be pure functions of `(G, args, ctx)`.

## Why this matters

**Replays.** Every match emits a JSON action log. To reproduce the exact end state, the engine re-dispatches the log against the same starting RNG. Any non-deterministic call breaks this and the replay diverges.

**Hosted authoritative state.** The server runs the same move and must produce the same `G` as the local optimistic dispatch. If the two RNG streams disagree, clients see a desync and the server's state wins — the local optimistic update is silently overwritten.

**Bot regression.** A bot's decisions are reproducible only if every random step uses the forked RNG. `Math.random` makes "fix the seed and replay" useless for catching regressions, because re-running the same input produces a different decision.

## Shuffling a deck

There is no `rng.shuffle` helper. Write Fisher-Yates with `rng.int`:

```ts
function shuffle<T>(arr: readonly T[], rng: DeterministicRng): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}
```

## See also

- https://openturn.io/docs/how-to/handle-randomness
- `packages/core/src/runtime.ts` — `DeterministicRng` source.
- `examples/games/splendor/game/src/setup.ts` — Fisher-Yates with `rng.int` during setup.
- `examples/games/splendor/bots/src/random.ts` and `examples/games/tic-tac-toe/bots/src/random.ts` — `rng.pick(legalActions)` inside `decide`.
- `examples/games/splendor/bots/src/strategic.ts` — `rng.next()` used as a deterministic tiebreaker.
- No in-tree game move calls `ctx.rng.*` directly today; pig-dice receives the rolled value as `args` from the client. Both patterns are valid as long as the value's source is deterministic.
