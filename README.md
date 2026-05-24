<p align="center">
  <img src="docs/assets/hero.gif" alt="An openturn game being played" width="720" />
</p>

# Openturn

> [!WARNING]
> Openturn is currently in an early alpha stage. APIs may change quickly, behavior may shift between releases, and the platform should be expected to be unstable while the core framework and hosted services are still evolving.

**Openturn is a TypeScript framework for turn-based and board games.** Define your rules in one file. Get a hosted multiplayer URL with rooms, auth, and persistence — no infrastructure to run. The same definition also drives a local React app, a CLI, replays, bots, and the inspector.

Check out this ready-to-play Splendor board game example: https://openturn.io/games/james/splendor

Its source code is available at https://github.com/openturn-io/openturn/tree/main/examples/games/splendor

But we recommend a quick glance at a game definition example below to overview the basic game definition APIs.

```ts
import { defineGame, move } from "@openturn/gamekit";

export const game = defineGame({
  maxPlayers: 2,
  setup: () => ({ value: 0 }),
  moves: {
    increment: move({
      run({ G, move, player }) {
        const value = G.value + 1;
        if (value >= 5) return move.finish({ winner: player.id }, { value });
        return move.endTurn({ value });
      },
    }),
  },
  views: {
    public: ({ G, turn }) => ({ value: G.value, currentPlayer: turn.currentPlayer }),
  },
});
```

## Quickstart

Scaffold a new project, then start the dev server with hot reload and the inspector:

```bash
bunx @openturn/cli create my-game
cd my-game
bun install
bun run dev
```

The CLI writes this project structure:

```text
my-game/
├── app/
│   ├── game.ts
│   ├── openturn.ts
│   ├── page.tsx
│   ├── styles.css
│   └── css.d.ts
├── package.json
└── tsconfig.json
```

Use `--template multiplayer` to scaffold a hosted-multiplayer starter instead of the default local one.

- `app/game.ts` — the authoritative game definition: state, moves, and views.
- `app/page.tsx` — the React UI entry point. The local template uses local bindings; the multiplayer template uses room and lobby bindings.
- `app/openturn.ts` — CLI and deploy metadata, including `runtime: "local"` or `runtime: "multiplayer"`.
- `app/styles.css` — the Tailwind entry stylesheet.
- `app/css.d.ts` — the TypeScript declaration for CSS imports.
- `package.json` — scripts and Openturn/React dependencies.
- `tsconfig.json` — TypeScript settings for the scaffolded app.

## Why Openturn

- **One game definition, every runtime.** Author the rules once with `defineGame(...)`. The same value drives local play, React apps, CLI simulations, hosted multiplayer, replays, bots, and the inspector.

- **Authoritative state without server plumbing.** Your game owns the plain JSON state `G`; Openturn handles dispatch, validation, realtime sync, room state, and hosted storage around it. Deploy to Openturn Cloud when you want Cloudflare Workers and Durable Objects without provisioning infrastructure.

- **Server-authoritative hidden information.** Model hands, fog of war, sealed bids, and private choices inside `G`; `views.public` and `views.player` decide what each audience receives, so opponents never get secrets they should not see.

- **Open source with a cloud path.** Run locally, self-host the worker runtime, or publish public games to Openturn Cloud for free. The framework stays plain TypeScript, so the rules are not locked to a view layer or deployment target.
  - Auth
  - Serverless game rooms
  - CDN, storage and db
  - All handled by cloud with zero infra setup for developers.

<details>
<summary>More capabilities</summary>

- **Pure reducers over declared game flow.** Moves, phases, active players, and transitions are explicit and replay-safe. That makes games easier to debug, easier for coding agents to reason about, and strict enough to validate before and during play.

- **Game phases and turn control.** Use gamekit phases for planning, bidding, battle, cleanup, or simultaneous action windows. Use round-robin turns for classic games, or drop to core when the state graph needs full custom control.

- **Replays, inspector, and prototyping.** Every match can emit a JSON action log. Re-dispatch it to reproduce the exact state, scrub frames in the inspector, or simulate candidate moves before the UI is finished.

- **Bots as first-class players.** Drop a `decide` function into any seat — random, heuristic, minimax, or MCTS. Bots read the same player view as humans and dispatch through the same local or hosted path.

- **Lobby, profiles, and plugins.** Hosted rooms include lobby handoff and bot seat selection. Profiles let games commit replay-safe progression between matches. Plugins can add namespaced state and moves for shared abstractions like chat.

</details>

## Design Philosophy

Openturn has follow design philosophy in mind:

- determinism
- inspectability
- serializability
- graphability
- validation
- worker-safe execution

And our APIs and typescript typing systems are keep evolving and are being consolidated, still at its early stages.

## Comparisons to boardgame.io

Openturn takes inspirations from boardgame.io and boardgamearena.com (no direct code copy though)

But these frameworks are built many years ago using old web standards like redux, plain js, php etc.

Openturn instead:

- Built with typescript from day one
- An opinionated stricter model that is more coding agents friendly - enabling massive vibe coded games potentials.
- Clean boundary between different runtimes on different envs: bun/node, browser, cloudflare worker - yes Openturn supports serverless deployment of games on Cloudflare, and Openturn Cloud is built on top of that, making free public games scaling problem easy to manage. You don't need to host a forever running server for one game to handle websocket connections for multiplayer for example.

## Authoring with AI agents

If you build games with Claude Code, Codex, Cursor, or another supported agent, install the Openturn skill so the agent gets calibrated on Openturn's APIs, hidden-info model, randomness rules, and testing patterns:

```bash
npx skills add openturn-io/openturn
```

See the [skill docs](https://openturn.io/docs/agent-skills) for what's covered and how to update.



## Learn more

Docs are available at https://openturn.io/docs

- [Install and run](https://openturn.io/docs/get-started/install-and-run)
- [Your first game](https://openturn.io/docs/get-started/your-first-game)
- [Tutorial: tic-tac-toe with gamekit](https://openturn.io/docs/tutorials/tic-tac-toe-gamekit)
- [Examples](https://openturn.io/docs/examples) — playable tic-tac-toe, battleship, pig-dice, and splendor under [examples/games/](https://github.com/openturn-io/openturn/tree/main/examples/games)

## Status

Early — packages are at `0.x.x` and APIs may shift. Issues and feedback welcome at [openturn-io/openturn/issues](https://github.com/openturn-io/openturn/issues).

## License

[Apache-2.0](LICENSE) © 2026 Jincheng Zhang openturn.io
