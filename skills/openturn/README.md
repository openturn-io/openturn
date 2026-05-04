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
