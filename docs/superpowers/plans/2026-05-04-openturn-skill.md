# Openturn Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a `skills/openturn/` Claude Code skill from the openturn-io/openturn repo that calibrates AI coding agents on how to author Openturn games, plus a Mintlify docs page and a repo README mention so users can install it via `npx skills add openturn-io/openturn`.

**Architecture:** Single SKILL.md entry point (~150-250 lines) plus seven focused reference files (`gamekit.md`, `core.md`, `views.md`, `randomness.md`, `simultaneous-moves.md`, `bots.md`, `testing.md`) under `skills/openturn/references/`. Layout matches the `skills/<name>/` convention that `vercel-labs/skills` (the `npx skills` CLI) auto-discovers. No build step. No npm package. Distribution is via skills.sh from a public GitHub repo.

**Tech Stack:** Markdown, Mintlify (`.mdx`), `@changesets/cli` for the changeset, `npx skills` for verification.

**Spec:** `docs/superpowers/specs/2026-05-04-openturn-skill-design.md`

---

## Conventions used in this plan

- **Working dir** is the repo root: `/Users/jameszhang_work/Github/openturn/openturn`. All paths are relative to that.
- **All API names cited below have been verified against the source** (recon completed before writing this plan). Do not invent additional API names. If a downstream task seems to need an API not cited here, stop and grep the relevant package first.
- **Don't write** marker means: if you find yourself adding this content, the plan is wrong or the source has changed. Stop and re-verify.
- **Voice** for skill content: written *for an LLM author*, denser than the human docs. Prefer rules ("Always ...", "Never ...") and short worked snippets over prose explanations.
- **Commit messages** use the same style as recent commits (lowercase, present-tense, concise — see `git log --oneline`). Each task ends with one commit unless noted.

---

## Verified API surface (single source for all reference files)

These are quoted verbatim from `packages/` recon. Reference files cite from this list — they do not extend it without re-grepping.

### Gamekit (`packages/gamekit/src/index.ts`)

```ts
// defineGame input fields (the ones authors actually use):
{
  playerIDs?: readonly PlayerID[];           // e.g. ["0", "1"] as const
  maxPlayers?: number;
  minPlayers?: number;
  setup: (context: GamekitSetupContext) => TState;
  moves: ({ move }) => Record<string, GamekitMoveDefinition>;
  views?: { public?: (ctx) => TPublic; player?: (ctx, player) => TPlayer };
  phases?: Record<TPhase, GamekitPhaseConfig>;
  initialPhase?: TPhase;
  turn?: TurnPolicy;                         // turn.roundRobin() is the only built-in
  legalActions?: (ctx: GamekitCoreRuleContext, playerID) => readonly LegalAction[];
  computed?: ComputedMap<TState, TPhase, TPlayers>;
  profile?: GameProfileConfig;
  core?: GamekitCoreDefinition;              // escape hatch into core
}

// GamekitSetupContext fields:
{ match: MatchInput<TPlayers>; now: number; profiles; seed: string }

// GamekitCoreRuleContext (used by legalActions, views.player/public on the core escape):
//   inherits from GameRuleContext: { G, position, derived, match, now }
//   so legalActions destructure is `({ G, derived }, playerID)` —
//   `derived.activePlayers` is the standard pattern.

// move() factory:
move<TArgs = undefined>({
  args?: TArgs,                              // optional schema marker; runtime arg is in ctx.args
  run: (ctx: MoveRunContext) => MoveOutcome,
})

// MoveRunContext fields (the ones authors use). MoveRunContext extends MovePermissionContext:
{
  G: DeepReadonly<TState>;                   // current state — never mutate
  args: TArgs;                               // payload passed to applyEvent
  move: MoveHelpers;                         // the outcome helpers
  player: { id: PlayerID };                  // who is playing
  rng: DeterministicRng;                     // forked, replay-safe randomness
  profile: ProfileMutation;                  // for committing replay-safe progression
  // From MovePermissionContext:
  C: TComputed;                              // computed values
  phase: TPhase;                             // current phase
  turn: TurnContext<PlayerID>;
  profiles: Readonly<Record<PlayerID, TProfile>>;  // per-player profile snapshot (read-only)
  // ⚠️ NO `derived` field on MoveRunContext. `derived` only appears on
  //   rule contexts (legalActions, views via core escape).
}

// MoveHelpers (the move.* outcome helpers):
move.endTurn(patch?, options?)               // apply patch and pass turn to next player
move.stay(patch?, options?)                  // apply patch and stay on current player
move.goto(phase, patch?, options?)           // change phase; pass options.endTurn to also pass turn
move.finish({ winner?, draw? }, patch?, opts?)  // end the match
move.invalid(reason?, details?)              // reject this dispatch (returned to applyEvent caller)
// ⚠️ There is NO move.continue. Use move.stay.

// Views:
views: {
  public?: ({ G, C, phase, turn }) => TPublic,           // omit → full G
  player?: ({ G, C, phase, turn }, { id }) => TPlayer,   // omit → public view
}

// Turn policies:
import { turn } from "@openturn/gamekit";
turn.roundRobin();                          // only built-in policy today

// Phase config:
phases: {
  myPhase: {
    activePlayers?: ({ G, C, phase, turn }) => readonly PlayerID[],
    label?: string | ((ctx) => string | null),
  },
}
```

### Core (`packages/core/src/index.ts`, `packages/core/src/runtime.ts`)

```ts
// DeterministicRng (accessed via ctx.rng inside a move):
rng.int(maxExclusive: number): number;
rng.bool(probability?: number): boolean;
rng.pick<T>(values: readonly T[]): T;
rng.dice(count: number, sides: number): number;
rng.d4(); rng.d6(); rng.d8(); rng.d10(); rng.d12(); rng.d20(); rng.d100();
rng.advantage(); rng.disadvantage();
rng.next(): number;                          // raw [0, 1)
rng.getSnapshot(): RngSnapshot;
// ⚠️ Never call Math.random / Date.now / crypto.* from a move or decide.

// Local session (for tests and local play):
import { createLocalSession } from "@openturn/core";
const session = createLocalSession(game, { match: { players: game.playerIDs } });
session.applyEvent(playerID, "moveName", payload);
//   → { ok: true, ... } | { ok: false, error: "invalid_event", reason, details }
session.getState();                          // { G, derived: { activePlayers, ... }, meta: { result }, ... }
session.getPublicView();
session.getPlayerView(playerID);

// defineGame from @openturn/core is a SEPARATE function for low-level state
// graphs (transitions/events). Authors should prefer @openturn/gamekit.
```

### Bot (`packages/bot/src/...`)

```ts
import { defineBot, attachLocalBots, attachLocalBot, attachHostedBot, simulate } from "@openturn/bot";

defineBot<typeof game>({
  name: string,
  thinkingBudgetMs?: number,
  actionDelayMs?: number,
  enumerate?: EnumerateActions<TGame>,       // fallback if game has no legalActions
  decide({ playerID, view, snapshot, legalActions, rng, deadline, signal, simulate }): LegalAction | Promise<LegalAction>,
  init?, dispose?,
});

// Game-side legal-action enumerator (preferred over bot.enumerate):
defineGame({
  legalActions: ({ G, derived }, playerID) => readonly LegalAction[],
  // ...
});

attachLocalBots({ session, game, bots: { [seat]: bot } })
//   → { session, isBot, whenIdle, detachAll, ... }

simulate(game, snapshot, playerID, action)
//   → { ok: true, outcome: "endTurn" | "stay" | "finish", next } | { ok: false, reason }
```

### Pig-dice canonical example (verbatim from `examples/games/pig-dice/game/src/index.ts`)

The SKILL.md canonical example is distilled from this file. Use the same names and shape — do not invent variants.

```ts
import { roster, type PlayerID, type PlayerRecord } from "@openturn/core";
import { defineGame, turn } from "@openturn/gamekit";

export const PIG_DICE_TARGET_SCORE = 20;
const PIG_DICE_PLAYERS = ["0", "1"] as const;

export interface PigDiceState {
  lastRoll: number | null;
  scores: PlayerRecord<typeof PIG_DICE_PLAYERS, number>;
  turnTotal: number;
}

export const pigDice = defineGame({
  playerIDs: PIG_DICE_PLAYERS,
  setup: ({ match }): PigDiceState => ({
    lastRoll: null,
    scores: roster.record(match, 0),
    turnTotal: 0,
  }),
  moves: ({ move }) => ({
    hold: move({
      run({ G, move, player }) {
        if (G.turnTotal === 0) return move.invalid("empty_turn", { turnTotal: 0 });
        const nextScores = { ...G.scores, [player.id]: (G.scores[player.id] ?? 0) + G.turnTotal };
        if ((nextScores[player.id] ?? 0) >= PIG_DICE_TARGET_SCORE) {
          return move.finish({ winner: player.id }, { lastRoll: null, scores: nextScores, turnTotal: 0 });
        }
        return move.endTurn({ lastRoll: null, scores: nextScores, turnTotal: 0 });
      },
    }),
    roll: move<{ value: number }>({
      run({ G, args, move }) {
        if (!Number.isInteger(args.value) || args.value < 1 || args.value > 6) {
          return move.invalid("invalid_roll", { value: args.value });
        }
        if (args.value === 1) return move.endTurn({ lastRoll: 1, turnTotal: 0 });
        return move.stay({ lastRoll: args.value, turnTotal: G.turnTotal + args.value });
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

> Note on the `roll` move: pig-dice takes the rolled value as `args` (caller supplies it) rather than rolling internally. This is the canonical example's idiomatic pattern. For an example of using `ctx.rng` inside a move, see `references/randomness.md` (Task 6) — recon there will check whether any in-tree game does so, and if not, the reference will provide a hand-rolled snippet using `rng.d6()`.

### Simultaneous-moves canonical (verbatim from `examples/simultaneous-moves/paper-scissors-rock/game/src/index.ts`)

```ts
phases: {
  plan: {
    activePlayers: ({ G }) => PLAYERS.filter((id) => G.submissions[id] === null),
    label: ({ G }) => `Round ${G.round}`,
  },
},
moves: ({ move }) => ({
  submitChoice: move<PaperScissorsRockChoice>({
    run({ G, args, move, player }) {
      const submissions = { ...G.submissions, [player.id]: args };
      const stillPending = PLAYERS.filter((id) => submissions[id] === null);
      if (stillPending.length > 0) return move.stay({ submissions });
      // last submitter resolves the round
      return move.endTurn({ /* compute scores, reset submissions, ... */ });
    },
  }),
}),
```

### Test pattern (verbatim shape from `examples/games/pig-dice/game/src/pig-dice.test.ts`)

```ts
import { describe, expect, test } from "bun:test";
import { createLocalSession } from "@openturn/core";
import { pigDice } from "./index";

const match = { players: pigDice.playerIDs };

describe("pigDice", () => {
  test("rolling above one keeps the turn", () => {
    const session = createLocalSession(pigDice, { match });
    expect(session.applyEvent("0", "roll", { value: 5 }).ok).toBe(true);
    expect(session.getState().G.turnTotal).toBe(5);
    expect(session.getState().derived.activePlayers).toEqual(["0"]);
  });
});
```

---

## File structure

```
skills/openturn/
├── SKILL.md
├── README.md
└── references/
    ├── gamekit.md
    ├── core.md
    ├── views.md
    ├── randomness.md
    ├── simultaneous-moves.md
    ├── bots.md
    └── testing.md

docs/agent-skills.mdx                       (NEW)
docs/docs.json                              (MODIFIED — insert page in Get started group)
README.md                                   (MODIFIED — add "Authoring with AI agents" section)
.changeset/openturn-skill.md                (NEW — patch bump for docs only)
```

Each reference file is a self-contained document. SKILL.md never inlines reference content — it points at the file path.

---

## Task 1: Scaffold the skill directory and write SKILL.md

**Files:**
- Create: `skills/openturn/SKILL.md`
- Verify with: `npx skills add ./skills/openturn --list`

- [ ] **Step 1: Create the directory**

```bash
mkdir -p skills/openturn/references
```

- [ ] **Step 2: Write `skills/openturn/SKILL.md` exactly as below**

````markdown
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
````

- [ ] **Step 3: Verify the skill is discoverable by `npx skills`**

Run: `npx skills add ./skills/openturn --list`

Expected: output includes a single skill named `openturn` with the description text from the frontmatter. If it lists nothing or errors with "no SKILL.md found," the layout or frontmatter is wrong — re-check.

- [ ] **Step 4: Commit**

```bash
git add skills/openturn/SKILL.md
git commit -m "skills(openturn): add SKILL.md entry point with pig-dice canonical example"
```

---

## Task 2: Write `skills/openturn/README.md`

**Files:**
- Create: `skills/openturn/README.md`

- [ ] **Step 1: Write the README exactly as below**

````markdown
# Openturn skill for AI coding agents

A skill that calibrates AI coding agents (Claude Code, Codex, Cursor, and the other agents supported by [skills.sh](https://skills.sh)) on how to author Openturn games — game state, moves, views, phases, turns, hidden info, randomness, simultaneous moves, bots, and testing.

When installed, the agent automatically loads this skill in projects that use `@openturn/gamekit` or `@openturn/core`, or when you ask it to build a turn-based game.

## Install

```bash
npx skills add openturn-io/openturn
```

Run inside a project to install for that project, or pass `-g` to install globally:

```bash
npx skills add openturn-io/openturn -g
```

To target a specific agent:

```bash
npx skills add openturn-io/openturn -a claude-code
```

See [`vercel-labs/skills`](https://github.com/vercel-labs/skills) for the full list of supported agents and CLI flags.

## Update

```bash
npx skills update openturn
```

## Uninstall

```bash
npx skills remove openturn
```

## What this skill knows

- Game definition with `@openturn/gamekit`: `defineGame`, `move`, phases, turns, the `MoveRunContext` shape.
- Lower-level state graphs with `@openturn/core` (when to drop down).
- Views: `views.public`, `views.player`, hidden-info patterns.
- Replay-safe randomness via `ctx.rng`.
- Simultaneous moves via `activePlayers` filtering.
- Bots: `defineBot`, `decide`, `simulate`, the `legalActions` enumerator contract.
- Testing game definitions with `createLocalSession` + `bun:test`.

## Out of scope

React bindings, lobby, multiplayer hosting, Openturn Cloud deploy, replays-as-product, and the inspector. For those, see [openturn.io/docs](https://openturn.io/docs).

## Source and feedback

- Skill files: [`skills/openturn/`](.) in the [openturn-io/openturn](https://github.com/openturn-io/openturn) repo.
- Issues / suggestions: [openturn-io/openturn/issues](https://github.com/openturn-io/openturn/issues).
````

- [ ] **Step 2: Commit**

```bash
git add skills/openturn/README.md
git commit -m "skills(openturn): add human-facing README for skill directory"
```

---

## Task 3: Write `skills/openturn/references/gamekit.md`

**Files:**
- Create: `skills/openturn/references/gamekit.md`

This reference is the most-loaded one. Keep it dense (~150-200 lines).

- [ ] **Step 1: Write the file with the structure below**

Required sections, in order:

1. **Frontmatter** (none — plain markdown, no YAML).

2. **`# Gamekit reference`** — opening paragraph: "This reference covers `@openturn/gamekit`'s `defineGame` API. Use it when authoring a game's state, moves, phases, turns, or `legalActions`. For lower-level state-graph control, see `core.md`. For randomness specifically, see `randomness.md`."

3. **`## defineGame fields`** — list every author-facing field with a one-line purpose:
   - `playerIDs: readonly string[]` — fixed set of seat IDs (e.g. `["0", "1"] as const`). Required for typed `playerID` in moves and views.
   - `maxPlayers?: number`, `minPlayers?: number` — used by lobby; pure metadata for local play.
   - `setup({ match }) => TState` — initial `G`. `match` includes `players`. Use `roster.record(match, defaultValue)` from `@openturn/core` to build a per-player record.
   - `moves: ({ move }) => Record<string, GamekitMoveDefinition>` — factory; receives the `move` helper.
   - `views?: { public?, player? }` — see `views.md`.
   - `phases?: Record<TPhase, GamekitPhaseConfig>`, `initialPhase?: TPhase` — see "Phases" below.
   - `turn?: TurnPolicy` — only `turn.roundRobin()` is built-in today.
   - `legalActions?: ({ G, derived }, playerID) => readonly LegalAction[]` — bot enumeration contract. Required if any bot will use a game-defined enumerator. See `bots.md`.
   - `computed?: ComputedMap` — derived values exposed as `C` in move/view contexts.
   - `profile?: GameProfileConfig` — replay-safe per-player progression across matches.
   - `core?: GamekitCoreDefinition` — escape hatch into `@openturn/core`. Avoid unless you've hit a wall.

4. **`## The move() helper`** — exact factory shape:

   ```ts
   moves: ({ move }) => ({
     myMove: move<TArgs>({
       run(ctx) { return ctx.move.endTurn(...); },
     }),
   }),
   ```

   Note: the type parameter on `move<TArgs>(...)` declares the payload type passed via `applyEvent(playerID, "myMove", payload)`. Omit it for `args: undefined`.

5. **`## MoveRunContext`** — fields the author uses inside `run`:
   - `G: DeepReadonly<TState>` — current state. **Never mutate.**
   - `args: TArgs` — payload from `applyEvent`.
   - `move: MoveHelpers` — outcome helpers (next section).
   - `player: { id: PlayerID }` — who is dispatching this move.
   - `rng: DeterministicRng` — randomness (see `randomness.md`).
   - `profile: ProfileMutation` — for committing replay-safe progression (advanced).
   - Plus `derived`, `C` (computed), `phase`, `turn` for read-only reference.

6. **`## Move outcomes (move.*)`** — exhaustive list, with one-line semantics for each:
   - `move.endTurn(patch?, options?)` — apply `patch` (shallow merge into `G`) and pass turn to next active player per turn policy.
   - `move.stay(patch?, options?)` — apply `patch` and keep the turn on the current player. Use for multi-step moves within a turn (pig-dice "roll again") or to wait for other players in a simultaneous phase.
   - `move.goto(phase, patch?, options?)` — change phase. Pass `options.endTurn: true` to also pass the turn.
   - `move.finish({ winner?, draw? }, patch?, options?)` — terminal outcome. Match ends; `winner` is a `PlayerID` and `draw: true` for draws. Set the result before applying the patch.
   - `move.invalid(reason?, details?)` — reject the dispatch. `applyEvent` returns `{ ok: false, error: "invalid_event", reason, details }`. Use for rule violations like "you can't hold without rolling."
   - **`move.continue` does not exist.** If the user mentions it, they're thinking of `move.stay`.

7. **`## Phases`** — `phases: Record<TPhase, { activePlayers?, label? }>`. `initialPhase` selects the starting phase. Each phase's `activePlayers` filters who can dispatch moves. **Phases are for distinct rule sets, not intra-turn steps.** Show one short example (planning → battle).

8. **`## Turns`** — `turn: turn.roundRobin()` is the only built-in policy. For custom turn order, drop to `core` (see `core.md`).

9. **`## Common mistakes`** — bulleted list:
   - Mutating `G` (`G.scores[id] += 1`). Always spread: `{ ...G.scores, [id]: (G.scores[id] ?? 0) + 1 }`.
   - Returning bare `G` from a move instead of a `move.*` outcome.
   - Putting `Date`, `Map`, `Set`, or class instances in `G`. Use plain JSON shapes only.
   - Using `Math.random` / `Date.now` inside a move (replays diverge).
   - Modeling intra-turn state as a phase. Use `G` for that; phases are for rule changes.
   - Trying to use `move.continue` (doesn't exist). Use `move.stay`.

10. **`## See also`**:
    - Full pig-dice example: [`examples/games/pig-dice/game/src/index.ts`](https://github.com/openturn-io/openturn/tree/main/examples/games/pig-dice/game/src/index.ts)
    - Tic-tac-toe with phases: [`examples/games/tic-tac-toe/game/src/`](https://github.com/openturn-io/openturn/tree/main/examples/games/tic-tac-toe/game/src/)
    - Splendor (full-scale): [`examples/games/splendor/`](https://github.com/openturn-io/openturn/tree/main/examples/games/splendor/)
    - Human docs: https://openturn.io/docs/how-to/author-with-gamekit
    - Reference: https://openturn.io/docs/reference/gamekit

**Don't write:**
- `move.continue(...)` — does not exist.
- `random.*` or `rng.something` not in the verified surface (see "Verified API surface" at top of plan). Stick to listed methods.
- Made-up turn policies (only `roundRobin()` exists today).
- Field names not in the verified `defineGame` shape.

- [ ] **Step 2: Skim once for clarity**

Read the file end-to-end. Each section should be readable in <15 seconds by an LLM that's pattern-matching for a specific symbol. If a section is prose-heavy, convert it to bullet points or a code block.

- [ ] **Step 3: Commit**

```bash
git add skills/openturn/references/gamekit.md
git commit -m "skills(openturn): add gamekit.md reference"
```

---

## Task 4: Write `skills/openturn/references/core.md`

**Files:**
- Create: `skills/openturn/references/core.md`

This reference is short (~60-100 lines). Its job is to bias the reader back toward gamekit unless they've hit a real wall.

- [ ] **Step 1: Verify the core API surface**

Run: `grep -E "^export (function|const|class)" packages/core/src/index.ts`

Capture the output and use only listed exports in the reference. The verified subset (from recon) is in the "Verified API surface" section at the top of this plan; cross-check against current source.

- [ ] **Step 2: Write the file with the structure below**

Sections:

1. **`# Core reference`** — opening: "`@openturn/core` is the lower-level state-graph layer. **Prefer `@openturn/gamekit` (`gamekit.md`) for nearly all games.** Only drop to core when the state graph genuinely needs custom transitions or non-round-robin turn resolution that gamekit's `phases`, `turn.roundRobin()`, and `legalActions` cannot express."

2. **`## When to drop to core`** — bulleted list of concrete signals:
   - You need a state graph with branching transitions that aren't expressible as `phases`.
   - You need a turn policy that isn't round-robin (e.g. priority-based, last-mover-wins, draft snake order). There is no built-in non-round-robin policy in gamekit today.
   - You are building infrastructure on top of openturn (a plugin, a session host, etc.) rather than authoring a game.
   - You're escaping into `defineGame.core` from gamekit and you need to know what's available.

3. **`## Key exports`** — short table with name → one-line purpose:
   - `defineGame` (from `@openturn/core`) — low-level game definition. **Different from `defineGame` in `@openturn/gamekit`** — do not confuse them. Authors should use the gamekit one.
   - `defineTransition` / `defineTransitions` — state-graph transitions.
   - `defineEvent`, `rejectTransition` — event authoring + rejection.
   - `createLocalSession` / `createLocalSessionFromSnapshot` — session construction (used by tests; see `testing.md`).
   - `compileGameGraph` — compile a game definition into its underlying graph.
   - `validateGameDefinition`, `getGameValidationReport`, `InvalidGameDefinitionError` — validation.
   - `roundRobin`, `resolveRoundRobinTurn`, `resolveTimeValue`, `deadline` — runtime helpers (most authors don't touch these).
   - `roster` — player roster utilities (e.g. `roster.record(match, defaultValue)` to build a per-player record).
   - `applyProfileCommit`, `applyProfileDelta`, `computeProfileCommit`, `defineProfile`, `parseProfileData`, `profile`, `restrictDeltaMapToPlayers`, `validateProfileDelta` — profile / persistent-state APIs.
   - Types: `AnyGame`, `GameDefinition`, `GameSnapshot`, `LocalGameSession`, `MatchInput`, `PlayerID`, `PlayerList`, `ReplayValue`.

4. **`## Sketch — a custom transition`** — one short snippet (10-15 lines) showing a `defineTransition` call. **Only include this if the verification step confirms the API shape; otherwise replace with a one-line "see `packages/core/src/` and `examples/using-core/` for the current shape" pointer.** Do not invent.

5. **`## See also`**:
   - `examples/using-core/`
   - Human docs: https://openturn.io/docs/how-to/author-with-core
   - Reference: https://openturn.io/docs/reference/core

**Don't write:**
- Detailed core authoring patterns. Bias the reader toward gamekit.
- Any name not in the grep output from Step 1.

- [ ] **Step 3: Commit**

```bash
git add skills/openturn/references/core.md
git commit -m "skills(openturn): add core.md reference"
```

---

## Task 5: Write `skills/openturn/references/views.md`

**Files:**
- Create: `skills/openturn/references/views.md`

~80-120 lines.

- [ ] **Step 1: Verify the views default behavior**

Run: `grep -n -A 8 "views" packages/gamekit/src/index.ts | grep -A 8 "GamekitViews\|public\?\|player\?"`

Confirm the recon finding: omitted `public` returns the full `G`; omitted `player` returns the `public` view. Adjust the reference if reality differs.

- [ ] **Step 2: Write the file with the structure below**

Sections:

1. **`# Views reference`** — opening: "Views decide what each audience sees. `views.public` is for spectators; `views.player` is for the player at a specific seat. The server only sends each audience their view — never raw `G`. **Hidden information lives inside `G`** and the views strip it out."

2. **`## Signatures`**:

   ```ts
   views: {
     public?: ({ G, C, phase, turn }) => TPublic,
     player?: ({ G, C, phase, turn }, { id }) => TPlayer,
   }
   ```

3. **`## Defaults`** — exactly:
   - If `views.public` is omitted, the full `G` is returned as the public view. **For any game with hidden state, define `views.public` explicitly.**
   - If `views.player` is omitted, the public view is returned for every player. **For any game where one player should see something opponents shouldn't, define `views.player` explicitly.**

4. **`## Pattern: hand of cards`** — 10-line snippet:

   ```ts
   interface State {
     deck: Card[];
     hands: PlayerRecord<Players, Card[]>;
     discard: Card[];
   }

   views: {
     public: ({ G, turn }) => ({
       currentPlayer: turn.currentPlayer,
       handSizes: Object.fromEntries(Object.entries(G.hands).map(([id, h]) => [id, h.length])),
       discard: G.discard,
       deckSize: G.deck.length,
     }),
     player: (ctx, { id }) => ({
       ...ctx.viewsPublic ?? viewsPublic(ctx),  // build on top of the public view
       myHand: ctx.G.hands[id] ?? [],
     }),
   }
   ```

   Note for the implementer: confirm whether the public view is reachable from the `player` callback as a context field or whether you re-call the public function. Recon did not pin this down — verify by inspecting `packages/gamekit/src/views.ts` (or wherever the view runner lives) before finalizing the snippet. If it's not directly available, restructure the snippet to compute the public shape via a shared helper.

5. **`## Pattern: fog of war`** — 8-line snippet showing `views.player` returning a state restricted by visibility (e.g. `{ visibleTiles: G.tiles.filter((t) => visibleTo(id, t)) }`).

6. **`## Pattern: sealed bids`** — 8-line snippet: `G.bids` is the full record; `views.public` exposes only `playersWhoBid`; `views.player` exposes the player's own bid.

7. **`## Anti-pattern: shaping views inside moves`** — short paragraph: do not strip hidden info inside a move and re-store it in `G`. Keep `G` as the full ground truth and let views project. This is the difference between authoritative state and rendering.

8. **`## Leak check`** — short paragraph: if `views.public` exposes `Object.keys(G.hands).map(...)` plus `G.deck.length` plus a deterministic `G.deckSeed`, then any client can simulate the deck and read every hand. **Anything derivable from a public view is leaked.** Run a mental dry-run before shipping each view.

9. **`## See also`**:
   - https://openturn.io/docs/how-to/model-hidden-info
   - https://openturn.io/docs/concepts/gamekit-views-and-computed
   - Splendor (uses views for hidden noble effects): `examples/games/splendor/game/src/`

**Don't write:**
- A `views.spectator` or any view function not in the verified signature (only `public` and `player` exist).

- [ ] **Step 3: Commit**

```bash
git add skills/openturn/references/views.md
git commit -m "skills(openturn): add views.md reference"
```

---

## Task 6: Write `skills/openturn/references/randomness.md`

**Files:**
- Create: `skills/openturn/references/randomness.md`

~80-120 lines.

- [ ] **Step 1: Verify the rng API surface in the move context**

Run: `grep -n "rng" packages/gamekit/src/index.ts | head -30`

Confirm: `rng: DeterministicRng` is in `MoveRunContext` (or one of its parents). If not, the whole `ctx.rng` premise needs revisiting — stop and surface the ambiguity to the user before writing.

Run: `grep -n "interface DeterministicRng" packages/core/src/runtime.ts`

Confirm: methods listed in the "Verified API surface" section above are still present. Update the list if the source has drifted.

- [ ] **Step 2: Search the example games for actual `ctx.rng` usage**

Run: `grep -rn "rng\.\|rng:" examples/games/ examples/using-core/ examples/simultaneous-moves/ | head -20`

If any example uses `ctx.rng.*` inside a move, cite that example as the canonical use site. If none does (recall: pig-dice takes the dice value as `args` rather than rolling internally), say so and provide the hand-rolled snippet from the next step.

- [ ] **Step 3: Write the file with the structure below**

Sections:

1. **`# Randomness reference`** — opening: "Openturn games run on authoritative state with replays and remote bots. Every random value used by a move or a bot must be reproducible from the same RNG seed, or replays diverge and bot decisions become non-deterministic. Use `ctx.rng` from inside a move and `ctx.rng` from inside a bot's `decide`. **Never call `Math.random`, `Date.now`, or `crypto.*` from those contexts.**"

2. **`## API`** — verbatim list of methods on `DeterministicRng` (from `packages/core/src/runtime.ts`):

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

3. **`## Inside a move`** — short snippet showing a move that uses `ctx.rng.d6()`:

   ```ts
   roll: move({
     run({ G, move, rng }) {
       const value = rng.d6();
       if (value === 1) return move.endTurn({ lastRoll: 1, turnTotal: 0 });
       return move.stay({ lastRoll: value, turnTotal: G.turnTotal + value });
     },
   }),
   ```

4. **`## Inside a bot`** — short snippet showing `decide({ legalActions, rng })`:

   ```ts
   defineBot({
     name: "random",
     decide: ({ legalActions, rng }) => rng.pick(legalActions),
   });
   ```

   Bot RNG is forked from the snapshot's RNG and salted by bot name + seat + turn, so two bots on the same snapshot get different (but reproducible) streams.

5. **`## Forbidden`** — exhaustive list:
   - `Math.random()` — non-deterministic.
   - `Date.now()`, `new Date()`, `performance.now()` — non-deterministic.
   - `crypto.randomUUID()`, `crypto.getRandomValues()` — non-deterministic.
   - Any external API call from inside a move (network fetches, file reads). Moves must be pure.

6. **`## Why this matters`** — three short paragraphs:
   - **Replays.** Every match emits a JSON action log. To reproduce the exact state, the engine re-dispatches the log against the same starting RNG. Any non-deterministic call breaks this.
   - **Hosted authoritative state.** The server runs the same move and must produce the same `G` as the local optimistic dispatch. Diverging `G` is a sync bug.
   - **Bot regression.** A bot's decisions are reproducible only if every random step uses the forked RNG. `Math.random` makes "fix the seed and replay" useless for catching regressions.

7. **`## Shuffling a deck`** — 5-line snippet using `rng.pick` repeatedly or `rng.int` for Fisher-Yates. Alternatively call out if there's a `rng.shuffle` helper (the verified surface does NOT include `shuffle` — write Fisher-Yates explicitly).

8. **`## See also`**:
   - https://openturn.io/docs/how-to/handle-randomness
   - `packages/core/src/runtime.ts` — `DeterministicRng` source
   - `examples/games/pig-dice/` (note: takes value as `args` rather than rolling internally — both patterns are valid)

**Don't write:**
- `rng.shuffle(...)` — not in the verified surface.
- `random.*` as a separate namespace — randomness is on `ctx.rng` only.
- Any method not listed in the verified API.

- [ ] **Step 4: Commit**

```bash
git add skills/openturn/references/randomness.md
git commit -m "skills(openturn): add randomness.md reference"
```

---

## Task 7: Write `skills/openturn/references/simultaneous-moves.md`

**Files:**
- Create: `skills/openturn/references/simultaneous-moves.md`

~60-100 lines. Short reference because the pattern is simple.

- [ ] **Step 1: Read the canonical example**

Read: `examples/simultaneous-moves/paper-scissors-rock/game/src/index.ts` end-to-end. The reference will quote two snippets from it.

- [ ] **Step 2: Write the file with the structure below**

Sections:

1. **`# Simultaneous moves reference`** — opening: "Openturn doesn't have a separate 'simultaneous-moves API.' The pattern is: declare a phase whose `activePlayers` returns every player who hasn't yet acted, store partial submissions in `G`, and use `move.stay` to wait. The last submitter resolves the round."

2. **`## The pattern`** — three required pieces:

   1. **`G` holds partial submissions per player**, e.g. `submissions: PlayerRecord<Players, Choice | null>` initialized to all `null`.
   2. **A phase whose `activePlayers` filters to "not yet submitted":**

      ```ts
      phases: {
        plan: {
          activePlayers: ({ G }) => PLAYERS.filter((id) => G.submissions[id] === null),
        },
      },
      ```

   3. **A move that uses `move.stay` while submissions are pending and `move.endTurn` to resolve when all players have submitted:**

      ```ts
      submitChoice: move<Choice>({
        run({ G, args, move, player }) {
          const submissions = { ...G.submissions, [player.id]: args };
          const stillPending = PLAYERS.filter((id) => submissions[id] === null);
          if (stillPending.length > 0) return move.stay({ submissions });
          // last submitter resolves
          return move.endTurn({ /* compute result, reset submissions */ });
        },
      }),
      ```

3. **`## Why activePlayers filters dynamically`** — short paragraph: each dispatch re-evaluates `activePlayers` against the new `G`. Once a player submits, their seat is removed from the active set, so the engine won't accept further dispatches from them in this phase. This is what makes the simultaneous semantic work without a separate API.

4. **`## Hidden submissions`** — short paragraph: pair this with `views.player` so each player only sees their own submission until the round resolves. See `views.md` "sealed bids" pattern.

5. **`## Resolving the round`** — bulleted notes:
   - Compute the round result from the complete `submissions` set.
   - Reset `submissions` to all `null` in the patch you pass to `move.endTurn` (or `move.goto` if you're advancing phases).
   - Update score / state in the same patch.

6. **`## See also`**:
   - `examples/simultaneous-moves/paper-scissors-rock/game/src/index.ts`
   - https://openturn.io/docs/how-to/handle-simultaneous-moves
   - `views.md` for hiding pending submissions

**Don't write:**
- A separate "simultaneous moves API" — there isn't one. The pattern is `activePlayers` + `move.stay`.

- [ ] **Step 3: Commit**

```bash
git add skills/openturn/references/simultaneous-moves.md
git commit -m "skills(openturn): add simultaneous-moves.md reference"
```

---

## Task 8: Write `skills/openturn/references/bots.md`

**Files:**
- Create: `skills/openturn/references/bots.md`

~120-180 lines.

- [ ] **Step 1: Verify the bot API**

Run: `grep -nE "export (function|const|interface) (defineBot|attachLocalBot|attachLocalBots|attachHostedBot|simulate|DecideContext|Bot)" packages/bot/src/*.ts`

Confirm signatures match the "Verified API surface" section. Update the reference if reality differs.

- [ ] **Step 2: Read existing how-to**

Read: `docs/how-to/add-a-bot.mdx`. The reference will mirror the same examples with denser, LLM-targeted phrasing.

- [ ] **Step 3: Write the file with the structure below**

Sections:

1. **`# Bots reference`** — opening: "Bots are first-class players. They see the same `views.player` as humans and dispatch through the same `applyEvent` path. A bot is `defineBot({ name, decide })`. The runtime calls `decide` whenever the bot's seat is active, with a `DecideContext` containing `legalActions`, `rng`, `view`, and `simulate`."

2. **`## The legal-actions contract`** — short paragraph:

   The bot runtime needs to know which moves a seat may legally dispatch. There are two ways to provide this:

   - **Game-side (preferred):** add `legalActions` to `defineGame`. Every bot for this game then uses the same enumerator.

     ```ts
     defineGame({
       legalActions: ({ G, derived }, playerID) => {
         if (!derived.activePlayers.includes(playerID)) return [];
         // build and return readonly LegalAction[]
       },
       // ...
     });
     ```

   - **Bot-side (fallback):** if the game doesn't declare `legalActions`, the bot can ship its own `enumerate` field.

   The engine never reads `legalActions`. Only the bot runtime does. Authors who don't ship bots can omit it.

3. **`## defineBot signature`**:

   ```ts
   defineBot<typeof game>({
     name: string,
     thinkingBudgetMs?: number,
     actionDelayMs?: number,
     enumerate?: EnumerateActions<TGame>,
     decide(ctx: DecideContext<TGame>): LegalAction | Promise<LegalAction>,
     init?(ctx: BotLifecycleContext): void | Promise<void>,
     dispose?(): void,
   });
   ```

4. **`## DecideContext`** — fields:
   - `playerID` — bot's seat.
   - `view: GamePlayerView<TGame>` — what the bot can see (same shape as `views.player` returns).
   - `snapshot: GameSnapshot | null` — full snapshot if available (local play), `null` for hosted clients.
   - `legalActions: ReadonlyArray<LegalAction>` — enumerated by `defineGame.legalActions` (or bot's `enumerate` fallback).
   - `rng: BotRng` — forked, salted by bot name + seat + turn (see `randomness.md`).
   - `deadline: DeadlineToken`, `signal: AbortSignal` — for time budgets.
   - `simulate: SimulateFn<TGame>` — local-play search helper (next section).

5. **`## Random bot (5 lines)`**:

   ```ts
   defineBot({
     name: "random",
     decide: ({ legalActions, rng }) => rng.pick(legalActions),
   });
   ```

6. **`## Heuristic bot`** — 10-line snippet showing scoring + sorting. Use the tic-tac-toe pattern from `docs/how-to/add-a-bot.mdx` (center > corners > edges).

7. **`## Search-based bot with simulate`** — 20-line minimax sketch. Use `simulate(game, snapshot, playerID, action)` which returns `{ ok: true, outcome, next }` or `{ ok: false, reason }`. **`simulate` is unavailable on hosted clients** (where `snapshot === null`); search bots run as local processes (CLI, server-side sidecar). Cite `examples/games/tic-tac-toe/bots/` and `examples/games/splendor/bots/` (the latter has random/greedy/strategic tiers).

8. **`## Attaching bots`**:

   ```ts
   import { attachLocalBots } from "@openturn/bot";
   const { session, isBot, whenIdle, detachAll } = attachLocalBots({
     session: rawSession,
     game,
     bots: { "1": myBot },                      // seat "1" is the computer
   });
   // Use the returned `session`, not raw — it notifies the runner on every dispatch.
   ```

   Loop with `whenIdle(playerID)` to wait until the bot has dispatched. Don't call `decide` yourself.

9. **`## Hosted topology`** — short paragraph: in cloud `/play`, bots run as separate processes that connect via WebSocket using the same protocol as humans. Use `attachHostedBot({ client, playerID, bot, game })`. `simulate` is not available; search-based bots stay in-process on a CLI or sidecar host. Pointer: https://openturn.io/docs/concepts/bots#cloud-deployment

10. **`## See also`**:
    - https://openturn.io/docs/how-to/add-a-bot
    - https://openturn.io/docs/tutorials/tic-tac-toe-bot
    - https://openturn.io/docs/reference/bot
    - `examples/games/tic-tac-toe/bots/`
    - `examples/games/splendor/bots/`

**Don't write:**
- Any method on a bot RNG that isn't on `DeterministicRng` (see `randomness.md`).
- A `Bot.run` method or any signature not in the verified `Bot` interface.

- [ ] **Step 4: Commit**

```bash
git add skills/openturn/references/bots.md
git commit -m "skills(openturn): add bots.md reference"
```

---

## Task 9: Write `skills/openturn/references/testing.md`

**Files:**
- Create: `skills/openturn/references/testing.md`

~80-120 lines. The verified test pattern is `createLocalSession` + `applyEvent` + `bun:test`.

- [ ] **Step 1: Confirm the test pattern from a real example**

Read: `examples/games/pig-dice/game/src/pig-dice.test.ts`. The reference uses this file's exact pattern.

- [ ] **Step 2: Write the file with the structure below**

Sections:

1. **`# Testing reference`** — opening: "Tests for an Openturn game definition use `createLocalSession` from `@openturn/core` plus `bun:test`. Each test constructs a fresh session, dispatches a sequence of moves via `applyEvent`, and asserts on `getState().G`, `getState().derived.activePlayers`, and `getState().meta.result`."

2. **`## Setup`** — boilerplate:

   ```ts
   import { describe, expect, test } from "bun:test";
   import { createLocalSession } from "@openturn/core";
   import { myGame } from "./index";

   const match = { players: myGame.playerIDs };
   ```

3. **`## A passing-move test`**:

   ```ts
   test("rolling above one keeps the turn", () => {
     const session = createLocalSession(myGame, { match });
     expect(session.applyEvent("0", "roll", { value: 5 }).ok).toBe(true);
     expect(session.getState().G.turnTotal).toBe(5);
     expect(session.getState().derived.activePlayers).toEqual(["0"]);
   });
   ```

4. **`## A rejected-move test`** — assert on the error shape:

   ```ts
   test("holding empty is invalid", () => {
     const session = createLocalSession(myGame, { match });
     expect(session.applyEvent("0", "hold", undefined)).toEqual({
       details: { turnTotal: 0 },
       error: "invalid_event",
       ok: false,
       reason: "empty_turn",
     });
   });
   ```

5. **`## A finishing-move test`** — sequence of dispatches that ends the match; assert on `meta.result`:

   ```ts
   test("first to target wins", () => {
     const session = createLocalSession(myGame, { match });
     // ... sequence to reach the win condition ...
     expect(session.getState().meta.result).toEqual({ winner: "0" });
   });
   ```

6. **`## Authoring discipline`** — short bulleted list:
   - Write one test per move outcome (`endTurn`, `stay`, `finish`, `invalid`) before adding the next move.
   - When you find a bug, write a test that reproduces it before fixing.
   - Tests are fast — local sessions are in-process; a test suite for a small game runs in tens of milliseconds.

7. **`## Determinism in tests`** — short paragraph:
   - Sessions are deterministic given the same seed. If your game uses `ctx.rng`, fix the seed via `createLocalSession(game, { match, seed: "test-seed" })` so assertions are reproducible. (Verify the option name with `grep -n "seed" packages/core/src/session.ts`; if the option is named differently, update.)

8. **`## Bot tests`** — short paragraph + cite:
   - Unit-test a bot's `decide` by passing a hand-built `DecideContext` and asserting the chosen action is in `legalActions`.
   - Integration-test by playing many random-vs-random matches and asserting every match terminates with `meta.result` set. See `examples/games/tic-tac-toe/bots/src/index.test.ts` and `examples/games/splendor/bots/src/index.test.ts`.

9. **`## See also`**:
   - `examples/games/pig-dice/game/src/pig-dice.test.ts`
   - `examples/games/tic-tac-toe/game/src/tic-tac-toe.test.ts`
   - `examples/games/splendor/game/src/splendor.test.ts`

**Don't write:**
- A test framework other than `bun:test` (the repo standard).
- A `session.dispatch.move(...)` form unless verified — the canonical pattern is `applyEvent`. `dispatch` exists on the session as a typed dispatch map but `applyEvent` is what every example test uses.

- [ ] **Step 3: Commit**

```bash
git add skills/openturn/references/testing.md
git commit -m "skills(openturn): add testing.md reference"
```

---

## Task 10: Add `docs/agent-skills.mdx` and update `docs/docs.json`

**Files:**
- Create: `docs/agent-skills.mdx`
- Modify: `docs/docs.json`

- [ ] **Step 1: Write `docs/agent-skills.mdx` exactly as below**

````mdx
---
title: Authoring with AI agents
description: Install the Openturn skill so Claude Code, Codex, Cursor, and other agents are calibrated on Openturn's APIs and conventions when building games for you.
sidebarTitle: AI agents
---

Openturn ships a [skill](https://skills.sh) that teaches AI coding agents how to author Openturn games — game state, moves, views, phases, turns, hidden info, randomness, simultaneous moves, bots, and testing. With it installed, Claude Code (or any [supported agent](https://github.com/vercel-labs/skills#supported-agents)) loads Openturn-specific guidance automatically when you work in an Openturn project or ask it to build a turn-based game.

## Install

```bash
npx skills add openturn-io/openturn
```

Run inside a project to install for that project, or pass `-g` to install globally for all projects:

```bash
npx skills add openturn-io/openturn -g
```

To target a specific agent only:

```bash
npx skills add openturn-io/openturn -a claude-code
```

## Update

```bash
npx skills update openturn
```

## Uninstall

```bash
npx skills remove openturn
```

## What the skill knows

- Game definition with `@openturn/gamekit`: `defineGame`, the `move` helper, phases, turns, `MoveRunContext`.
- Lower-level state graphs with `@openturn/core` (when to drop down).
- Views: `views.public`, `views.player`, hidden-info patterns.
- Replay-safe randomness via `ctx.rng`.
- Simultaneous moves via `activePlayers` filtering.
- Bots: `defineBot`, `decide`, `simulate`, the `legalActions` enumerator contract.
- Testing game definitions with `createLocalSession` and `bun:test`.

## Out of scope

The skill stays focused on game definition. For React UI, lobby, multiplayer hosting, deploying to Openturn Cloud, replays-as-product, and the inspector, follow the dedicated guides in this site.

## Source and feedback

The skill lives at [`skills/openturn/`](https://github.com/openturn-io/openturn/tree/main/skills/openturn) in the openturn repo. File issues or improvements at [openturn-io/openturn/issues](https://github.com/openturn-io/openturn/issues).
````

- [ ] **Step 2: Update `docs/docs.json` to add the page to the Get started group**

Modify the `Get started` group's `pages` array. Current value (from spec recon):

```json
{
  "group": "Get started",
  "pages": [
    "index",
    "get-started/install-and-run",
    "get-started/your-first-game"
  ]
}
```

New value (insert `"agent-skills"` between `install-and-run` and `your-first-game`):

```json
{
  "group": "Get started",
  "pages": [
    "index",
    "get-started/install-and-run",
    "agent-skills",
    "get-started/your-first-game"
  ]
}
```

The page path is `agent-skills` (no `get-started/` prefix) because the file lives at the docs root (`docs/agent-skills.mdx`), not under `docs/get-started/`. This matches the design decision in the spec ("top-level placement keeps it discoverable from the side nav root and avoids implying it's required").

- [ ] **Step 3: Verify the docs build**

Run: `cd docs && mint dev`

Expected: server starts without parse errors. Visit the new page in the local site to confirm it renders.

Then: `cd docs && mint broken-links`

Expected: no broken links. (The page links to https://openturn.io/docs/... and external URLs; local links should resolve.)

- [ ] **Step 4: Commit**

```bash
git add docs/agent-skills.mdx docs/docs.json
git commit -m "docs: add 'Authoring with AI agents' page documenting the openturn skill"
```

---

## Task 11: Update repo `README.md`

**Files:**
- Modify: `README.md` (insert section between "Quickstart" and "Learn more")

- [ ] **Step 1: Read the current README to find the exact insertion point**

Run: `grep -n "^## " README.md`

Expected: lines for `## Why Openturn`, `## Quickstart`, `## Learn more`, `## Status`, `## License`. The new section goes between Quickstart and Learn more.

- [ ] **Step 2: Insert the new section**

Insert the section below into `README.md`, between the end of the **Quickstart** section's content and the `## Learn more` heading. Use the `Edit` tool with `## Learn more` as a unique anchor (e.g. replace `\n## Learn more` with the new section followed by `\n## Learn more`).

The exact content to insert (verbatim, with real triple-backtick fences):

````markdown
## Authoring with AI agents

If you build games with Claude Code, Codex, Cursor, or another supported agent, install the Openturn skill so the agent gets calibrated on Openturn's APIs, hidden-info model, randomness rules, and testing patterns:

```bash
npx skills add openturn-io/openturn
```

See the [skill docs](https://openturn.io/docs/agent-skills) for what's covered and how to update.
````

- [ ] **Step 3: Verify**

Run: `grep -n "^## " README.md`

Expected: the section ordering is now Why Openturn → Quickstart → Authoring with AI agents → Learn more → Status → License.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: link the AI-agents skill from the repo README"
```

---

## Task 12: Add a changeset

**Files:**
- Create: `.changeset/openturn-skill.md`

The repo uses `@changesets/cli`. The skill itself is not a published package, so the changeset is a docs-only note that doesn't bump any package. To produce a non-empty changeset that satisfies the "every PR needs a changeset" convention without falsely bumping a package, list the docs site's pseudo-package or the most user-facing affected package — the existing `.changeset/turn-gating-inline.md` example bumped `@openturn/gamekit`, `@openturn/plugins`, and `@openturn/cli` because it changed those.

For this PR (docs + skills only, no source change to any package), the cleanest approach is an **empty changeset** (no packages listed) since `@changesets/cli` supports notes that don't bump anything. Confirm by checking `.changeset/config.json` for whether empty changesets are accepted; if not, list `@openturn/cli` with a `patch` bump (it's the most user-facing surface where mentioning the AI skill in scaffolding output later would be natural) and use a docs-only description.

- [ ] **Step 1: Check changeset config for empty-changeset support**

Run: `cat .changeset/config.json`

Look for any `ignore` or `commit` settings that would reject empty changesets. If there's no restriction, an empty changeset is fine.

- [ ] **Step 2: Write the changeset**

If empty changesets are accepted, create `.changeset/openturn-skill.md` with this content:

```markdown
---
---

Add `skills/openturn/` — a Claude Code skill that calibrates AI coding agents (Claude Code, Codex, Cursor, and others supported by skills.sh) on authoring Openturn games. Installable via `npx skills add openturn-io/openturn`. Documented at `docs/agent-skills.mdx` and linked from the repo README.
```

If empty changesets are rejected, use a `patch` bump on `@openturn/cli`:

```markdown
---
"@openturn/cli": patch
---

Add `skills/openturn/` — a Claude Code skill that calibrates AI coding agents (Claude Code, Codex, Cursor, and others supported by skills.sh) on authoring Openturn games. Installable via `npx skills add openturn-io/openturn`. Documented at `docs/agent-skills.mdx` and linked from the repo README.
```

- [ ] **Step 3: Commit**

```bash
git add .changeset/openturn-skill.md
git commit -m "changeset: announce skills/openturn"
```

---

## Task 13: End-to-end verification

**Files:** none modified.

This task does not write code. It runs every verification surface and confirms the skill is installable, the docs render, and the repo is in a shippable state.

- [ ] **Step 1: Confirm the skill layout is discoverable**

Run from the repo root:

```bash
npx skills add ./skills/openturn --list
```

Expected: output names a single skill `openturn` with the description from the SKILL.md frontmatter. If `npx` doesn't have the `skills` command cached, it will install it on first run — that's expected.

- [ ] **Step 2: Confirm a project-scope install works against a scratch project**

```bash
mkdir -p /tmp/openturn-skill-test && cd /tmp/openturn-skill-test
npx skills add /Users/jameszhang_work/Github/openturn/openturn -s openturn -y
ls -la .claude/skills/
```

Expected: a symlink (or copy) `.claude/skills/openturn` resolves to the skill directory. Inspect `.claude/skills/openturn/SKILL.md` to confirm the frontmatter is intact.

Then clean up: `rm -rf /tmp/openturn-skill-test`. Return to the repo root.

- [ ] **Step 3: Confirm the docs build and links resolve**

```bash
cd docs && mint dev
```

Expected: server starts on the configured port without errors. In a browser, navigate to `/agent-skills` and confirm the page renders with the correct sidebar entry under "Get started."

```bash
cd docs && mint broken-links
```

Expected: no broken links. Stop `mint dev` after verification.

- [ ] **Step 4: Confirm git state is clean and changes are committed**

Run: `git status`

Expected: clean working tree. Run `git log --oneline -15` and confirm one commit per task plus the spec/plan commits.

- [ ] **Step 5: Final sanity read of the skill**

Open `skills/openturn/SKILL.md` and read it end-to-end with fresh eyes. Ask yourself: if I were Claude loading this skill in a project that has `@openturn/gamekit` in `package.json` and the user said "help me add a hold-and-roll move," would I have everything I need to make a verified-API call without grepping the source first?

If anything is missing, fix it inline and amend the relevant commit. If everything is in place, the implementation is done.

- [ ] **Step 6: Run the AGENTS.md completion hook**

Per the repo's `AGENTS.md`: "When you finally finish running each time, run the mac cli `say "HEY YOUR TASK IS DONE"`."

```bash
say "HEY YOUR TASK IS DONE"
```

---

## Self-review

**Spec coverage:** Every requirement in the spec maps to a task:

- Skill at `skills/openturn/` with name `openturn` → Task 1.
- SKILL.md with the trigger description, rules-of-thumb, canonical example, decision tree, out-of-scope, verifying → Task 1.
- `skills/openturn/README.md` → Task 2.
- Seven reference files (gamekit, core, views, randomness, simultaneous-moves, bots, testing) → Tasks 3-9.
- `docs/agent-skills.mdx` page added to the Get started group → Task 10.
- Repo `README.md` mention → Task 11.
- Changeset → Task 12.
- Verification (`npx skills add --list`, `mint dev`, `mint broken-links`, install into scratch project) → Task 13.
- Verification policy ("API names verified by grepping packages") → built into Tasks 3-9 as Step 1 of each, plus the "Verified API surface" canonical block at the top of this plan.
- Spec's "Open question" about the testing harness → resolved during recon (`createLocalSession` + `applyEvent` + `bun:test`); embedded in Task 9.

**Placeholder scan:** No "TBD," no "implement later," no "similar to Task N." Each task carries the exact content or exact verification command. Where a reference file's prose needs LLM judgment to phrase, the task gives the section outline plus verified code blocks plus a "Don't write" guardrail — the engineer can write the prose without inventing facts.

**Type / name consistency check:**
- `move.stay` (not `move.continue`) used consistently across SKILL.md, gamekit.md, simultaneous-moves.md, randomness.md.
- `ctx.rng` (not `random.*`) used consistently across SKILL.md, gamekit.md, randomness.md, bots.md.
- `playerIDs` (not `players`) used as the field on `defineGame` consistently.
- `applyEvent(playerID, "moveName", payload)` used consistently in testing.md and bots.md.
- File path `skills/openturn/` (not `skills/openturn-author/`) used consistently.

**Scope check:** This is a single bounded plan — 13 tasks, ~10 new files, 2 modified files, all documentation/configuration. No source-code changes to any package. Suitable for one PR.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-04-openturn-skill.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
