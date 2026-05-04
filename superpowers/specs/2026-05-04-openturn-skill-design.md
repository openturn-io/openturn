# Openturn skill for AI coding agents — design

**Date:** 2026-05-04
**Status:** Approved (brainstorming → ready for implementation plan)

## Summary

Ship a single Claude Code skill named `openturn` from the openturn-io/openturn repo at `skills/openturn/`. It calibrates AI coding agents (Claude Code, Codex, Cursor, and the other agents supported by [skills.sh](https://skills.sh)) on how to author Openturn games — game state, moves, views, phases, turns, hidden information, randomness, simultaneous moves, bots, and testing. The skill is installable in one command via the `npx skills` CLI. A new docs page at `docs/agent-skills.mdx` documents it, and the repo-root README links to it.

## Goals

- One-command install for end users: `npx skills add openturn-io/openturn`.
- Skill activates automatically in projects that use `@openturn/gamekit` or `@openturn/core`, and when a user asks about authoring a turn-based / board game in TypeScript.
- Skill content is calibrated for an LLM author, not a human reader (denser, more do/don't, more rules-of-thumb).
- Skill stays focused on game definition; explicitly out of scope: React bindings, lobby, multiplayer hosting, deploy, replays-as-product, inspector.
- Discoverable from the openturn repo README and from the docs site.

## Non-goals

- No bundled CLI, scaffolding action, or workflow automation. The skill is a knowledge pack only (Approach 1 from brainstorming, not Approach 2 or 3).
- No published npm package for the skill itself in v1. Distribution is via the `npx skills` CLI reading directly from the GitHub repo.
- No automated sync with the Mintlify docs at `docs/`. Skill references and docs are independent products with different audiences (LLM vs human).
- No coverage of out-of-scope topics inside skill references. Out-of-scope topics get a one-line pointer to `https://openturn.io/docs` only.

## Format & distribution

- **Format:** single Claude Code skill (SKILL.md), shipped from the openturn repo. (Not a plugin, not an Anthropic Agent Skills bundle.)
- **Location:** `skills/openturn/` at the repo root.
- **Skill name:** `openturn`.
- **Distribution:** via [skills.sh](https://skills.sh) / `vercel-labs/skills` CLI. The `skills/<name>/` layout matches what the CLI auto-discovers, so no extra registration step is needed. The skill becomes installable as soon as the directory lands on `main`.
- **No publish-to-registry step is required on the openturn side.** skills.sh indexes via `npx skills` telemetry; the leaderboard populates organically as users install. If a submission flow surfaces later, document it then.

## Trigger conditions (skill description)

The skill's `description` frontmatter field combines a project signal and an intent signal:

> Use when authoring an Openturn turn-based or board game — when the workspace has `@openturn/gamekit` or `@openturn/core` in `package.json`, contains `defineGame(...)`, or when the user mentions openturn, gamekit, defineGame, or asks to build a turn-based / board game in TypeScript. Covers game state, moves, views, phases, turns, hidden info, randomness, simultaneous moves, bots, and testing.

Both project and intent signals are listed explicitly so Claude picks up the skill in either case (in-project work and greenfield "I want to build a turn-based game" requests).

## Directory layout

```
skills/
└── openturn/
    ├── SKILL.md                    ← entry point, ~150-250 lines
    ├── README.md                   ← human-facing install + what-this-is
    └── references/
        ├── gamekit.md              ← defineGame, move, phases, turns
        ├── core.md                 ← lower-level state graph (when to drop down)
        ├── views.md                ← public vs player views, hidden info
        ├── randomness.md           ← random / rng helpers, replay safety
        ├── simultaneous-moves.md   ← simultaneous action windows
        ├── bots.md                 ← decide functions, defineBot
        └── testing.md              ← unit-testing a game definition
```

Seven references, each focused on one concern. Each is 80–200 lines, written for an LLM author (denser than human docs).

## SKILL.md contents

Sections:

1. **Frontmatter** — `name: openturn`, `description: ...` (text from "Trigger conditions" section above).
2. **When to use this skill** — concrete trigger list, plus when NOT to use (realtime/action games, non-turn-based games, infrastructure/hosting questions).
3. **Core rules-of-thumb** — short, hard rules an LLM author needs upfront:
   - Game state `G` is plain JSON; no class instances, no `Date` / `Map` / `Set`, no functions.
   - Moves are pure reducers: return next state via `move.endTurn(...)`, `move.stay(...)`, `move.goto(...)`, `move.finish(...)`, or `move.invalid(...)`. Never mutate `G`.
   - All randomness goes through `context.rng` (a `DeterministicRng` with `.int`, `.bool`, `.pick`, `.dice`, `.d4`–`.d100`, etc.). Never call `Math.random` or `Date.now` from inside a move; replays will diverge.
   - Hidden info lives inside `G`. `views.public` and `views.player` decide what leaves the server. If a secret can be derived from the public view, it's leaked.
   - Choose gamekit before core. Drop to core only when the state graph genuinely needs custom control.
   - Phases are for distinct rule sets (planning, bidding, battle). Don't model "current step inside a turn" as a phase — use `G` for that.
   - Author one move at a time and verify it before adding the next.
4. **Canonical example** — pig-dice (~30–40 lines): `setup`, two moves (`roll`, `hold`), `views.public` and `views.player`, deterministic `rng` use. Annotated with what each piece maps to.
   - **Source of truth:** distill from `examples/games/pig-dice` rather than authoring fresh code. Keep the snippet small enough to fit in SKILL.md; link to the full example for readers who want more.
   - Rationale: tic-tac-toe is too trivial (no randomness, no hidden info); splendor is too big. Pig-dice exercises dice (`rng`), per-turn hidden state (current-turn pip total), and a clear win condition in a tight footprint.
5. **Decision tree — when to read which reference** — one bullet per reference file, framed as "if you're doing X, read Y."
6. **Out of scope** — single paragraph: React bindings, lobby, hosting, deploy, inspector → link to `https://openturn.io/docs/how-to/`.
7. **Verifying your work** — one-liner: `bunx openturn dev` and exercise the move in the inspector; `bun test` for test-only flows.

## References — content per file

Each reference ends with a "see also" pointing at relevant `examples/games/*` and `docs/how-to/*.mdx`.

### `references/gamekit.md`
- `defineGame` shape; `move()` helper and the `{G, args, move, player, rng, profile, ...}` argument (via `MoveRunContext`).
- `move.endTurn`, `move.stay`, `move.goto`, `move.finish`, `move.invalid` semantics. (Note: there is no `move.continue` — use `move.stay`.)
- `phases` and `turn` configs (only `turn.roundRobin()` is exported today); `setup`, `playerIDs`, `maxPlayers`, `minPlayers`.
- Worked snippets: a basic move, a finishing move, a phase transition.
- Common mistakes (mutating `G`, returning bare `G` instead of a `move.*` outcome, putting non-JSON in `G`).
- **API names verified by grepping `packages/gamekit` at write time.**

### `references/core.md`
- When to drop to `@openturn/core`: custom turn graphs, non-standard active-player resolution, transitions gamekit can't express.
- Sketch of the lower API.
- Bias the reader toward gamekit unless they've hit a concrete wall.

### `references/views.md`
- `views.public({G, turn})` vs `views.player({G, turn, player})`.
- Defaults (verified against `packages/gamekit/src/index.ts:1044-1056`): if `views.public` is omitted, the full `G` is returned as the public view; if `views.player` is omitted, the runner returns the full `G` to every player (NOT a fall-through to `views.public`). For any game with hidden state, both must be defined explicitly — defining only `public` does not hide state from players.
- Patterns for hands, fog of war, sealed bids.
- Anti-pattern: shaping views inside moves.

### `references/randomness.md`
- The `DeterministicRng` API surface (`packages/core/src/runtime.ts`): `.int`, `.bool`, `.pick`, `.dice`, `.d4`, `.d6`, `.d8`, `.d10`, `.d12`, `.d20`, `.d100`, `.advantage`, `.disadvantage`, `.next`, `.getSnapshot`. Accessed via `context.rng` inside a move and via `context.rng` (forked, salted by bot name + seat + turn) inside a bot's `decide`.
- Why deterministic randomness matters (replays, hosted authoritative state).
- Forbidden: `Math.random`, `Date.now`, `crypto.*` from inside moves or `decide`.

### `references/simultaneous-moves.md`
- When to model players acting at the same time vs forcing turn order.
- The simultaneous-moves API and how `endTurn` semantics differ.
- Reference example: `examples/simultaneous-moves`.

### `references/bots.md`
- `defineBot` and the `decide({legalActions, rng, snapshot, playerID, ...})` signature (verify against `packages/bot`; existing how-to is the source).
- `legalActions` enumerator on `defineGame` is the bot contract — note this when the user wants their game bot-ready.
- Random bot, heuristic bot, search-based (alpha-beta) sketch using `simulate`.
- Bots see the same `views.player` as humans — never the raw `G`.

### `references/testing.md`
- Test a game definition without a runtime: import the game value, dispatch a sequence of moves through the test harness exposed by `@openturn/core` / `@openturn/gamekit` (verify what's actually exported), assert on `G` and view shape.
- Snapshot replays from `examples/replays`.

### Verification policy for references

When implementing each reference file, every named API (`move.endTurn`, `defineBot`, `random.pick`, `attachLocalBots`, etc.) must be grep-confirmed against the actual package source under `packages/`. If a reference and the code disagree, fix the reference. Never invent API names.

## `skills/openturn/README.md` (human-facing)

Short. Sections: what-this-is, install (`npx skills add openturn-io/openturn`, with `-g` and `-a claude-code` notes), update, uninstall, scope summary, source / issues link.

## Repo-root `README.md` change

Add a short section between **Quickstart** and **Learn more**, titled "Authoring with AI agents." Two short paragraphs plus the `npx skills add ...` command and a link to `https://openturn.io/docs/agent-skills`.

## Mintlify docs page

- **New file:** `docs/agent-skills.mdx`.
- **Placement in `docs.json`:** add as a third entry in the **Get started** group, between `get-started/install-and-run` and `get-started/your-first-game`. (Top-level path, not nested under `get-started/`, since this is an optional tool installed in the user's editor — not openturn onboarding itself.)
- **Sidebar title:** "AI agents". **Page title:** "Authoring with AI agents".
- **Sections:** intro paragraph, install, update, uninstall, what the skill knows, out of scope, source and feedback. Mirror the SKILL.md scope for the "what the skill knows" list.

## Affected files

- **New:** `skills/openturn/SKILL.md`
- **New:** `skills/openturn/README.md`
- **New:** `skills/openturn/references/gamekit.md`
- **New:** `skills/openturn/references/core.md`
- **New:** `skills/openturn/references/views.md`
- **New:** `skills/openturn/references/randomness.md`
- **New:** `skills/openturn/references/simultaneous-moves.md`
- **New:** `skills/openturn/references/bots.md`
- **New:** `skills/openturn/references/testing.md`
- **New:** `docs/agent-skills.mdx`
- **Modified:** `README.md` (add "Authoring with AI agents" section)
- **Modified:** `docs/docs.json` (insert `agent-skills` in the Get started group)
- **New:** changeset md under `.changeset/` describing the addition (per `AGENTS.md`: "Add changeset mds for each PR").

## Testing / verification

- `npx skills add ./skills/openturn --list` from the repo root lists the `openturn` skill (sanity-check the layout is discoverable).
- Install into a scratch project: `npx skills add openturn-io/openturn` (post-merge), open Claude Code in a directory with `@openturn/gamekit` in `package.json`, confirm the skill loads.
- `mint dev` in `docs/` renders `agent-skills.mdx` without errors. `mint broken-links` passes.
- All API names in `references/*.md` grep-match symbols actually exported from `packages/*`.

## Open questions (deferred to implementation)

- Exact testing harness for game definitions: the existing how-to docs cover bot-side testing (`simulate`, hand-built `DecideContext`) but not pure-move unit testing. Verify what helpers exist in `packages/core` and `packages/gamekit` for stepping through moves without spinning up a full session, and base `references/testing.md` on what's actually there. If nothing exists, document the recommended `createLocalSession`-based pattern instead.

## Out of scope for this spec

- A future `@openturn/skill` npm package providing `bunx @openturn/skill install`. Possible follow-up if the `npx skills` install ever feels insufficient. Not in v1.
- Auto-generation of references from `docs/*.mdx`. Possible follow-up if drift becomes painful. Not in v1.
- A dedicated game-author subagent or slash command. Out of scope for a single SKILL.md skill (would require a plugin).
