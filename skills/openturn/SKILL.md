---
name: openturn
description: Use when authoring an Openturn turn-based or board game — when the workspace has @openturn/gamekit, @openturn/core, @openturn/bot, or @openturn/react in package.json, contains defineGame(...) or createOpenturnBindings(...), or when the user mentions openturn, gamekit, defineGame, or asks to build a turn-based / board game in TypeScript. Covers game state, moves, views, phases, turns, hidden info, randomness, simultaneous moves, bots, testing, and the contracts that connect a game to its running app (CLI entry, React reactivity, build pipeline).
---

# Authoring Openturn games

Openturn is a TypeScript framework where one `defineGame(...)` value drives local play, hosted multiplayer, the inspector, replays, and bots. This skill calibrates you on the game-definition layer (`@openturn/gamekit`, `@openturn/core`, `@openturn/bot`) and the seams that connect a game to a running app (CLI entry, React reactivity, build pipeline). Deeper React / lobby / hosting authoring lives at https://openturn.io/docs.

## Before you write code: read three working examples

**Imperative — do this first.** Docs explain *what* a pattern is; in-tree examples reveal the assumptions docs leave implicit. Before scaffolding any new openturn project, and before adopting an unfamiliar pattern from `openturn.io/docs`, Read these files end-to-end (don't just `ls` them):

1. **CLI entry contract** — `Read examples/games/splendor/app/app/game.ts`, `Read examples/games/splendor/app/app/openturn.ts`, and `Read examples/games/splendor/app/app/page.tsx`. The first is a one-line re-export; missing it produces `Missing app/game.ts` at dev start. The contract is enforced at CLI startup, not in any markdown doc.
2. **Lobby + bots wiring** — `Read examples/games/tic-tac-toe/app/src/components/LocalLobbyTicTacToe.tsx`. Canonical lobby + bots + React-bindings wiring (Pattern C from `play-against-bots.mdx`). Read this if your app has any lobby or any bot. Do NOT default to Pattern A (`useBotAttachOnTransition` with a raw session) — see "App layer essentials" for why.
3. **Import style** — `Read examples/games/splendor/app/src/lib/utils.ts` plus one component that imports it. Confirms the actual import style (relative `../lib/utils`, NOT the `@/*` alias from tsconfig).

The discipline: if you're about to copy a pattern from docs into a spec or plan, find the in-tree example that uses it first. If no example uses the pattern, treat it as load-bearing and ask before adopting.

## When to use this skill

Use this skill when:
- The workspace `package.json` has `@openturn/gamekit`, `@openturn/core`, `@openturn/bot`, or `@openturn/react` in dependencies.
- A file in the workspace contains `defineGame(` or `createOpenturnBindings(`.
- The user asks to build a turn-based or board game in TypeScript, or mentions Openturn, gamekit, or `defineGame` by name.
- You're scaffolding the `app/`, `bots/`, or `game/` package of an Openturn example.

Do NOT use this skill for:
- Realtime/action games (Openturn is turn-based).
- Hosting infrastructure / multiplayer infra deep dives — defer to `https://openturn.io/docs/how-to/deploy-to-openturn-cloud` and `https://openturn.io/docs/how-to/run-local-hosted`.
- Inspector internals or replay-as-product UX — defer to `https://openturn.io/docs/how-to/`.

## Core rules-of-thumb

These are the rules the engine will silently let you violate. Most produce subtle bugs (replay drift, leaked state, validation errors at startup) rather than loud crashes.

- **Game state `G` is plain JSON.** No class instances, no `Date`, `Map`, `Set`, `RegExp`, or functions in `G`. If you need a map, use a record. If you need a set, use a record-of-booleans or a sorted array.
  ```ts
  // ❌ G.timestamps = new Map();
  // ✅ G.timestamps = {};
  ```

- **Moves are pure reducers.** Return next state via one of: `move.endTurn(patch)`, `move.stay(patch)`, `move.goto(phase, patch)`, `move.finish({ winner }, patch)`, `move.invalid(reason, details)`. **Never mutate `G`.** There is no `move.continue` — use `move.stay`.
  ```ts
  // ❌ G.scores[player.id]++; return move.endTurn();
  // ✅ return move.endTurn({ scores: { ...G.scores, [player.id]: G.scores[player.id] + 1 } });
  ```

- **At least one move must reach `move.finish(...)`.** A game with only `stay`/`endTurn` outcomes throws `InvalidGameDefinitionError: State "__gamekit_finished" is unreachable` at definition time.

- **All randomness goes through the move context's `rng` field** (a `DeterministicRng`). Methods: `rng.int(maxExclusive)`, `rng.bool()`, `rng.pick(arr)`, `rng.dice(count, sides)`, `rng.d4()` … `rng.d100()`, `rng.advantage()`, `rng.disadvantage()`, `rng.next()`. Never call `Math.random`, `Date.now`, or `crypto.*` inside a move or a bot's `decide` — replays will diverge.
  ```ts
  // ❌ const dice = Math.floor(Math.random() * 6) + 1;
  // ✅ const dice = rng.d6();
  ```

- **Hidden info lives inside `G`.** `views.public` and `views.player` decide what leaves the server. If a secret can be derived from the public view, it's leaked. **Default behavior: omitted `views.public` returns full `G` to spectators; omitted `views.player` returns full `G` to every player** (not the public view — defining only `public` does NOT hide state from players). Always set both for any game with hidden state. **Before authoring views with hidden info, Read `references/views.md`.**

- **Computed values are read inside views via `C`, not `derived`.** View contexts expose the `computed` block as `C`. Rule contexts (`legalActions`, etc.) expose `derived`. The two are distinct.
  ```ts
  // ❌ views: { public: ({ G, derived }) => ({ winner: derived.winner }) }
  // ✅ views: { public: ({ G, C }) => ({ winner: C.winner }) }
  ```

- **Choose `@openturn/gamekit` before `@openturn/core`.** Drop to core only when the state graph genuinely needs custom transitions (rare).

- **Phases are for distinct rule sets** (planning, bidding, battle), not for "current step inside a turn." Use `G` to track intra-turn state. The only built-in turn policy is `turn.roundRobin()`.

- **Author one move at a time and verify it before adding the next.** Use `createLocalSession` + `applyEvent` in a `bun:test` to exercise each move in isolation. **Before writing your first test, Read `references/testing.md`.**

## Canonical example — pig-dice

A complete two-player game with hidden-from-yourself randomness (the next roll), a clear win condition, and per-turn state. Adapted from `examples/games/pig-dice/game/src/index.ts` — the live example takes the rolled value as an argument; this version uses `rng.d6()` inline to demonstrate replay-safe randomness in a single snippet.

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

## App layer essentials

The skill stays narrow on game definition, but three contracts on the seam between game and running app produce most of the visible failures. Read this section before scaffolding `app/` or wiring a React UI.

### CLI entry contract — three required files in `app/app/`

```ts
// app/app/game.ts — REQUIRED. The CLI looks for this exact symbol at startup.
export { yourGameWithBots as game } from "@openturn/example-your-game-bots";
// Or if no bots:
// export { yourGame as game } from "@openturn/example-your-game-game";

// app/app/openturn.ts — metadata.
export const metadata = {
  name: "Your Game",
  runtime: "multiplayer",   // or "local"
  multiplayer: { gameKey: "your-game", schemaVersion: "1" },
};

// app/app/page.tsx — the React entry.
import "../src/styles.css";
export default function Page() { return <YourExperience />; }
```

Without `app/app/game.ts`, `openturn dev` hard-fails at startup: `Missing app/game.ts. Openturn deployments require a canonical game entry that exports "game"`. The contract is enforced by the CLI, not documented anywhere else.

### React reactivity contract

A raw `LocalGameSession` does NOT notify React. `applyEvent` updates state but does not trigger a re-render. The visible failure: clicking the board does nothing.

For any React UI that drives game state, use `createOpenturnBindings({ runtime: "local" })` and read state via `useMatch()`:

```tsx
const { OpenturnProvider, useMatch } = createOpenturnBindings(game, { runtime: "local", match });

function Game() {
  const { dispatch, snapshot } = useMatch().state;
  return <button onClick={() => dispatch.dropDisc(active, { col })}>...</button>;
}

// ❌ Anti-pattern — UI will not re-render after dispatch
const [session] = useState(() => createLocalSession(game, { match }));
onClick={() => session.applyEvent(active, "dropDisc", { col })}  // bug
```

`useBotAttachOnTransition` ("Pattern A" in `play-against-bots.mdx`) is **only correct when you wrap the session in your own external store**. For typical apps, use Pattern C: bindings + a `useBotDriver` `useEffect` keyed on `snapshot`. See `examples/games/tic-tac-toe/app/src/components/LocalLobbyTicTacToe.tsx`.

`runtime: "multiplayer"` apps MUST wrap their tree explicitly in `<OpenturnProvider>` — the multiplayer dev shell does NOT auto-wrap. `runtime: "local"` apps are auto-wrapped by `LocalDevShell`.

**Before authoring a bot in any topology, Read `references/bots.md`** for the `decide` contract and the simulate-vs-view distinction.

### Build pipeline

The Openturn CLI's Vite config does **not** read tsconfig `paths`. Use relative imports (`../lib/utils`), not `@/lib/utils`. The `@/*` aliases in `tsconfig.json` and `components.json` are shadcn leftovers; no in-tree app actually imports through them.

Sanity check before committing your scaffold:
```bash
grep -rE 'from "@/' examples/games/splendor/app/src/   # returns nothing
grep -rE 'from "@/' your-app/src/                       # should also return nothing
```

## Decision tree — when to read which reference

Read references when you reach the relevant moment of need (the moment the question becomes load-bearing for your code, not before).

- **Writing the core game definition** (state, moves, phases, turn) → `references/gamekit.md`
- **Need state-graph control beyond gamekit** → `references/core.md`
- **Designing what each player sees** (hidden info, fog of war, sealed bids) → `references/views.md`
- **Anything involving dice, decks, shuffles, random picks** → `references/randomness.md`
- **Players act simultaneously** (planning phases, sealed bids) → `references/simultaneous-moves.md`
- **Building a bot to play a seat** → `references/bots.md`
- **Writing tests for a game definition** → `references/testing.md`

## Common mistakes (symptom index)

When something breaks, search this table by error message or visible symptom — the agent's first stop when stuck:

| Symptom | Likely cause | Fix |
|---|---|---|
| `Missing app/game.ts. Openturn deployments require…` at dev start | No `app/app/game.ts` re-export | Add the one-line `export { withBots as game } from "...-bots"` |
| `Failed to run dependency scan… @/lib/* could not be resolved` | Used `@/*` import alias | Switch all imports to relative paths (`../lib/utils`) |
| Clicking the board does nothing; state doesn't update | Raw `createLocalSession` instead of bindings | Switch to `createOpenturnBindings` + `useMatch()` |
| Bot moves never appear after lobby start | Same root cause as above; or missing `useBotDriver` | Use `createOpenturnBindings` + a `useBotDriver` `useEffect` keyed on `snapshot` |
| `useMatch must be used within an OpenturnProvider` | Multiplayer app didn't wrap explicitly | Wrap your tree in `<OpenturnProvider>` (multiplayer dev shell does not auto-wrap) |
| Replays diverge from a recorded match | `Math.random` / `Date.now` / `crypto.*` inside a move or bot `decide` | Use `rng.*`; never read live clocks in reducers |
| Hidden state leaks to a player | Defined `views.public` but omitted `views.player` | Define BOTH views; defaults leak full `G` to players |
| `InvalidGameDefinitionError: State "__gamekit_finished" is unreachable` | All moves return `move.endTurn`/`move.stay`; no terminal path | At least one move must reach `move.finish(...)` |
| `derived.X is undefined` inside a view | Reading computed via `derived` instead of `C` | Use `C.X` in `views.public`/`views.player`; `derived` is for rule contexts only |
| Move's `move.invalid(...)` reasons not propagating | Move handler threw instead of returning | Always `return` from a move's `run`; never throw |
| Bot search recurses but doesn't terminate in a hosted topology | Bot called `simulate(...)` in a host that doesn't expose full snapshot | Make the bot view-only (operate on `view.board`); `simulate` is local-only |

## Verifying your work

- Run `bunx openturn dev` and exercise each move in the inspector.
- For pure unit tests: `bun test` after writing tests with `createLocalSession` + `applyEvent` (see `references/testing.md`).
- After every move you author, dispatch it once via `applyEvent` and assert on `getState().G` and `getState().derived.activePlayers` before moving on.
- For React UIs: confirm the board responds to clicks in a browser before claiming "done." A typechecked UI can still be unresponsive (raw-session reactivity bug — see "Common mistakes").
- Pre-commit greps:
  - `grep -rE '(Math\.random|Date\.now|crypto\.)' game/src/ bots/src/` should return nothing.
  - `grep -rE 'from "@/' app/src/` should return nothing.
  - `grep -rE 'style=' app/src/components/` should return nothing if you're using Tailwind utilities only.

## Deeper authoring (out of scope here)

For React bindings beyond `createOpenturnBindings`, lobby UX customization, multiplayer hosting infrastructure, Openturn Cloud deploy, the inspector internals, and replays-as-product, see https://openturn.io/docs/how-to/.
