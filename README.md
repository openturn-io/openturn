# openturn

A TypeScript framework for turn-based and board games — local prototypes, replays, and cloud-hosted multiplayer all from one game definition.

You describe a game as a plain value (state, moves, who can act, what each player sees). Openturn runs the rules, validates moves, syncs players, and records replays. The same definition powers a local React app, a CLI, a hosted multiplayer server, and a debug inspector — no per-surface rewiring.

## Why openturn

- **One definition, every surface.** `defineGame(...)` runs locally, on a CLI, and as an Openturn Cloud-hosted multiplayer service.
- **Deterministic replay.** Every match produces a JSON action log; re-dispatch it and you get the exact same state, every time.
- **Hidden information at the engine level.** `views.public` and `views.player` decide what each audience sees — opponents never receive secrets they shouldn't.
- **Pluggable bots.** Drop a `decide` function (random, heuristic, MCTS, or LLM-backed) into any seat; the same bot runs locally and over the network.

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
        if (value >= 5) return move.win(player.id, { value });
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
