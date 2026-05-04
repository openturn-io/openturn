# Bots reference

Bots are first-class players. They see the same `views.player` as humans and dispatch through the same `applyEvent` path. A bot is `defineBot({ name, decide })`. The runtime calls `decide` whenever the bot's seat is active, with a `DecideContext` containing `legalActions`, `rng`, `view`, and `simulate`.

You never call `decide` yourself. The runner subscribes to snapshot changes and fires `decide` automatically when it's the bot's turn. Stale decisions (snapshot moved on while thinking) are dropped.

## The legal-actions contract

Bots need an enumeration of the moves a seat may legally play. Two ways to provide it:

**Game-side (preferred):** add `legalActions` to `defineGame`. The hook receives `{ G, derived, match, now, position }` and the active `playerID`, returns `LegalAction[]`.

```ts
defineGame({
  legalActions: ({ G, derived }, playerID) => {
    if (!derived.activePlayers.includes(playerID)) return [];
    return G.openSlots.map((slot) => ({
      event: "place",
      payload: { slot },
      label: `slot ${slot}`,
    }));
  },
  // ...
});
```

**Bot-side (fallback):** if the game doesn't declare `legalActions`, the bot can ship `enumerate({ view, snapshot, playerID }) => LegalAction[]`.

Resolution order (`packages/bot/src/legal.ts:20-45`):
1. Game's `legalActions` hook.
2. Bot's `enumerate`.
3. Empty array (bot must rely entirely on `simulate` exploration, or refuse).

The engine never reads `legalActions`. Only the bot runtime does. Authors who don't ship bots can omit it. A `LegalAction` is `{ event: string; payload: unknown; label?: string }`.

## defineBot signature

```ts
import { defineBot } from "@openturn/bot";

interface Bot<TGame> {
  readonly name: string;
  readonly thinkingBudgetMs?: number;   // default 5_000
  readonly actionDelayMs?: number;      // presentation pacing; default 0
  readonly enumerate?: EnumerateActions<TGame>;   // fallback only
  decide(ctx: DecideContext<TGame>): LegalAction | Promise<LegalAction>;
  init?(ctx: BotLifecycleContext): void | Promise<void>;
  dispose?(): void;
}
```

`thinkingBudgetMs` is a soft budget — surfaced via `ctx.deadline.remainingMs()`. The runner does not kill the bot if it overruns; check the deadline yourself in search loops.

## DecideContext

```ts
interface DecideContext<TGame> {
  readonly playerID: GamePlayers<TGame>[number];
  readonly view: GamePlayerView<TGame>;
  readonly snapshot: GameSnapshotOf<TGame> | null;   // null on hosted clients
  readonly legalActions: ReadonlyArray<LegalAction>;
  readonly rng: BotRng;                              // forked, salted by name+seat+turn
  readonly deadline: DeadlineToken;                  // remainingMs(), expired()
  readonly signal: AbortSignal;                      // aborts when decision is stale
  readonly simulate: SimulateFn<TGame>;              // (action) => SimulateResult, sugar for the
                                                     //   imported simulate(); local hosts only
}
```

Notes:
- `snapshot` is `null` on hosted (network) clients. Search bots that need the full state must run as local processes.
- `ctx.simulate(action)` is sugar — game/snapshot/playerID are pre-bound. The standalone `simulate(game, snapshot, playerID, action)` exported from `@openturn/bot` is the same thing without the binding (use it from non-`decide` code, e.g. recursive `search` helpers).
- `rng` is forked from `snapshot.meta.rng` and salted by `(bot.name, playerID, turn)`. Two bots on the same snapshot get different but reproducible streams. Only the methods on `DeterministicRng` are valid (`int`, `bool`, `pick`, `dice`, `d4`–`d100`, `advantage`, `disadvantage`, `next`).
- `signal` aborts when a new snapshot arrives mid-think. Long search loops should poll `signal.aborted` (or `deadline.expired()`) and bail.

## Random bot

```ts
export const randomBot = defineBot<typeof game>({
  name: "random",
  decide: ({ legalActions, rng }) => rng.pick(legalActions),
});
```

## Heuristic bot

Score, sort, take the top. Tie-break with `rng.pick` over the top-scored subset if you want non-determinism between equally-good moves.

```ts
export const heuristicBot = defineBot<typeof ticTacToe>({
  name: "heuristic",
  decide({ legalActions }) {
    const score = (a: LegalAction) => {
      const { row, col } = a.payload as { row: number; col: number };
      if (row === 1 && col === 1) return 3;     // center
      if (row !== 1 && col !== 1) return 2;     // corners
      return 1;                                  // edges
    };
    return [...legalActions].sort((a, b) => score(b) - score(a))[0]!;
  },
});
```

## Search-based bot with simulate

`simulate(game, snapshot, playerID, action)` returns `{ ok: true, outcome: "endTurn" | "stay" | "finish", next } | { ok: false, reason }`. It rehydrates a clone of the snapshot, applies the action, and reads the result — the original is untouched. Cheap enough for thousands of rollouts per turn.

```ts
import { defineBot, simulate } from "@openturn/bot";
import { ticTacToe } from "../game";

const OTHER: Record<string, string> = { "0": "1", "1": "0" };

function search(snap, toMove, me, depth, alpha, beta) {
  const r = snap.meta.result;
  if (r?.draw) return 0;
  if (r?.winner) return r.winner === me ? 10 - depth : depth - 10;  // closer wins score higher
  const moves = ticTacToe.legalActions({ G: snap.G, derived: snap.derived }, toMove);
  if (moves.length === 0) return 0;
  const maxing = toMove === me;
  let best = maxing ? -Infinity : Infinity;
  for (const m of moves) {
    const sim = simulate(ticTacToe, snap, toMove, m);
    if (!sim.ok) continue;
    const s = search(sim.next, OTHER[toMove]!, me, depth + 1, alpha, beta);
    best = maxing ? Math.max(best, s) : Math.min(best, s);
    if (maxing) alpha = Math.max(alpha, best); else beta = Math.min(beta, best);
    if (alpha >= beta) break;
  }
  return best;
}

export const minimaxBot = defineBot<typeof ticTacToe>({
  name: "minimax",
  decide({ legalActions, snapshot, playerID }) {
    if (snapshot === null) return legalActions[0]!;   // hosted: no full snapshot
    let bestAction = legalActions[0]!, bestScore = -Infinity;
    for (const action of legalActions) {
      const sim = simulate(ticTacToe, snapshot, playerID, action);
      if (!sim.ok) continue;
      const s = search(sim.next, OTHER[playerID]!, playerID, 1, -Infinity, Infinity);
      if (s > bestScore) { bestScore = s; bestAction = action; }
    }
    return bestAction;
  },
});
```

`simulate` is unavailable on hosted clients (returns `{ ok: false, reason: "simulate_unavailable_for_host" }`). Search bots run as local processes — CLI driver, server-side sidecar — where the full snapshot is reachable. See `examples/games/tic-tac-toe/bots/` for `random` and `minimax`, and `examples/games/splendor/bots/` for a `random`/`greedy`/`strategic` tier on a 2–4 player game (the `greedy` bot there is the canonical heuristic example).

## Attaching bots

```ts
import { attachLocalBots } from "@openturn/bot";

const { session, isBot, whenIdle, detachAll } = attachLocalBots({
  session: rawSession,
  game,
  bots: { "1": myBot },               // seat "1" is the computer
});
```

Use the returned `session`, **not the raw one**, in your game loop. The facade notifies the runner on every dispatch — humans or bots. Drive the loop:

```ts
while (true) {
  const snap = session.getState();
  if (snap.meta.result !== null) break;
  const active = snap.derived.activePlayers[0]!;
  if (isBot(active)) {
    await whenIdle(active);           // resolves when bot has dispatched
    continue;
  }
  const move = await readHumanMove();
  session.applyEvent(active, move.event, move.payload);
}
detachAll();
```

`whenIdle(playerID)` waits for any in-flight `decide` for that seat to settle. The bot watches the snapshot autonomously — never call `decide` yourself.

For a single seat, `attachLocalBot({ session, game, playerID, bot })` returns `{ runner, session, bus }`. To bind multiple bots one-by-one, pass the returned `bus` into subsequent calls so every host hears every dispatch — or just use `attachLocalBots`.

## Hosted topology

In cloud play, bots run as separate processes that connect to the room over WebSocket using the same protocol as a human. Use `attachHostedBot({ client, playerID, bot, game })` against a `HostedClient` from `@openturn/client`.

```ts
import { createHostedClient } from "@openturn/client";
import { attachHostedBot } from "@openturn/bot";

const client = createHostedClient({ /* roomID, playerID, getRoomToken */ });
await client.connect();
const runner = attachHostedBot({ client, playerID: "1", bot: randomBot, game });
//   game?: optional. Omit only if your bot ships its own `enumerate` —
//          without `game`, the runner cannot resolve game.legalActions.
```

`simulate` is not available on hosted clients (`snapshot === null`, calls return `{ ok: false, reason: "simulate_unavailable_for_host" }` — see `packages/bot/src/runner.ts:114`). Search-based bots stay in-process on a CLI or sidecar host where the full snapshot is reachable. See https://openturn.io/docs/concepts/bots#cloud-deployment for the supervisor pattern.

## See also

- https://openturn.io/docs/how-to/add-a-bot
- https://openturn.io/docs/tutorials/tic-tac-toe-bot
- https://openturn.io/docs/reference/bot
- `examples/games/tic-tac-toe/bots/`
- `examples/games/splendor/bots/`
