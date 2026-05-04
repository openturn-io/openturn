# Core reference

`@openturn/core` is the lower-level state-graph layer. **Prefer `@openturn/gamekit` (`gamekit.md`) for nearly all games.** Only drop to core when the state graph genuinely needs custom transitions or non-round-robin turn resolution that gamekit's `phases`, `turn.roundRobin()`, and `legalActions` cannot express.

## When to drop to core

- You need a state graph with branching transitions that aren't expressible as `phases`.
- You need a turn policy that isn't round-robin (e.g. priority-based, last-mover-wins, draft snake order). There is no built-in non-round-robin policy in gamekit today.
- You are building infrastructure on top of openturn (a plugin, a session host, etc.) rather than authoring a game.
- You're escaping into `defineGame.core` from gamekit and you need to know what's available.

## Key exports

All from `@openturn/core`.

| Group | Export | Purpose |
| --- | --- | --- |
| Game authoring | `defineGame` | Low-level state-graph game definition. **Different from `@openturn/gamekit`'s `defineGame`.** |
| | `defineTransition` | Author one transition for a given event. |
| | `defineTransitions` | Author a list of transitions, with the `transition` helper injected. |
| | `defineEvent` | Declare an event with its payload type. |
| | `rejectTransition` | Return value from `resolve` to reject the dispatched event with a reason. |
| Session | `createLocalSession` | In-memory session for a game definition. |
| | `createLocalSessionFromSnapshot` | Resume a session from a `GameSnapshot`. |
| | `compileGameGraph` | Precompute the graph (nodes + transitions) for a game. |
| Profiles | `defineProfile`, `profile` | Declare per-player profile schema and helpers. |
| | `applyProfileCommit`, `applyProfileDelta`, `computeProfileCommit` | Apply or compute replay-safe profile changes. |
| | `parseProfileData`, `validateProfileDelta`, `restrictDeltaMapToPlayers` | Parse/validate profile inputs. |
| Validation | `validateGameDefinition` | Throws `InvalidGameDefinitionError` on bad shape. |
| | `getGameValidationReport` | Non-throwing diagnostics report. |
| | `InvalidGameDefinitionError` | Thrown class. |
| Runtime helpers | `roundRobin`, `resolveRoundRobinTurn` | Round-robin turn computation. |
| | `resolveTimeValue`, `deadline` | Time/deadline helpers. |
| | `createRng` | Deterministic RNG (see `randomness.md`). |
| Roster | `roster` | Player roster utilities (e.g. `roster.record(match, defaultValue)` to build a per-player record). |
| Pending-state introspection | `collectGamePendingTargets`, `describeGamePendingTargets` | Enumerate which nodes/players the graph is currently waiting on. |
| | `getGameControlMeta`, `getGameControlSummary` | Read the active node's `control`/`metadata` outputs. |
| Types | `AnyGame`, `GameDefinition`, `GameSnapshot`, `LocalGameSession`, `MatchInput`, `PlayerID`, `PlayerList`, `ReplayValue`, `DeepReadonly` | Core type surface. |

## Sketch — a custom transition

```ts
import { defineGame, defineEvent } from "@openturn/core";

const game = defineGame({
  playerIDs: ["0", "1"] as const,
  events: { place: defineEvent<{ row: number; col: number }>() },
  initial: "play",
  setup: () => ({ board: emptyBoard() }),
  states: {
    play: {
      activePlayers: ({ match, position }) => [match.players[(position.turn - 1) % match.players.length]!],
      control: () => ({ status: "playing" }),
      label: "Play",
    },
    won: { activePlayers: () => [], control: () => ({ status: "won" }), label: "Winner" },
  },
  transitions: ({ transition }) => [
    transition("place", {
      from: "play",
      to: "won",
      label: "place_to_won",
      resolve: ({ G, event, playerID }) => {
        const board = applyMove(G.board, event.payload, playerID);
        if (board === null || !isWin(board)) return null; // reject this transition; try next
        return { G: { board }, result: { winner: playerID }, turn: "increment" };
      },
    }),
  ],
});
```

`resolve` returns one of: `null`/`false`/`void` (skip — the runtime tries the next transition for that event), a `{ G, result?, turn? }` object (accept), or `rejectTransition(reason)` (fail the event). `turn` accepts `"increment"` or `{ to: PlayerID }`. The `roster`, `defineProfile`, etc. helpers listed above are the same exports referenced from `gamekit.md`. See `examples/using-core/tic-tac-toe-core/game/src/index.ts` for the full pattern.

## See also

- [`examples/using-core/`](https://github.com/openturn-io/openturn/tree/main/examples/using-core)
- Human docs: https://openturn.io/docs/how-to/author-with-core
- Reference: https://openturn.io/docs/reference/core
