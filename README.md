# Openturn

Openturn is a typescript framework for turn-based and board games.

You create a simple game definition with functions to describe game states, player moves and views. And Openturn converts it to a complete playable game that can be hosted with zero infrastructure setup. The same definition powers a local React app, a CLI, a hosted multiplayer server, and a debug inspector — no per-surface rewiring.

Check out this ready-to-play Splendor board game example: https://openturn.io/games/james/splendor

Its source code is available at https://github.com/openturn-io/openturn/tree/main/examples/games/splendor

But we recommend a quick start example below to overview the basic game definition APIs.

## Why openturn

- **Open source.** At your choice of self-host or zero-infra cloud deployment (free for public deployments).

- **One definition, every surface.** `defineGame(...)` runs locally, on a CLI, and as an Openturn Cloud-hosted multiplayer service.

- **Coding Agent friendly.** Openturn introduces an opinionated model of "pure reducer over state machine" model, which is strict, deterministic, easier to debug.

- **Deterministic replay.** Every match produces a JSON action log; re-dispatch it and you get the exact same state, every time.

- **Hidden information at the engine level.** `views.public` and `views.player` decide what each audience sees — opponents never receive secrets they shouldn't.

- **Pluggable bots.** Drop a `decide` function (random, heuristic, MCTS) into any seat; the same bot runs locally and over the network.

## Quickstart

Scaffold a new project, then start the dev server with hot reload and the inspector:

```bash
npx @openturn/cli create my-game
cd my-game
npx openturn dev
```

Use `--template multiplayer` to scaffold a hosted-multiplayer starter instead of the default local one.

A game in 20 lines:

```ts
import { defineGame, move, permissions } from "@openturn/gamekit";

export const game = defineGame({
  maxPlayers: 2,
  setup: () => ({ value: 0 }),
  moves: {
    increment: move({
      canPlayer: permissions.currentPlayer,
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

## Learn more

- [Install and run](docs/get-started/install-and-run.mdx)
- [Your first game](docs/get-started/your-first-game.mdx)
- [Tutorial: tic-tac-toe with gamekit](docs/tutorials/tic-tac-toe-gamekit.mdx)
- [Examples](examples/) — playable tic-tac-toe, battleship, pig-dice, and splendor under [examples/games/](examples/games/)

## Status

Early — packages are at `0.4.x` and APIs may shift. Issues and feedback welcome at [openturn-io/openturn/issues](https://github.com/openturn-io/openturn/issues).

## License

[Apache-2.0](LICENSE) © 2026 Jincheng Zhang openturn.io
