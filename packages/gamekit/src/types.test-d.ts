// Type-level tests for `defineGame` inference. These compile-time assertions
// pin down the overload-selection contract so a regression (e.g. an inference
// quirk that widens `TPlayers` to `PlayerList` instead of the literal tuple)
// fails the package's typecheck immediately.
//
// No runtime cost — `expect-type`'s assertions are erased at compile time.
// File is included by `tsc` (matches `src/**/*.ts`, doesn't match `*.test.ts`)
// but not by the test runner.

import type { GamePlayers, GameStateOf } from "@openturn/core";
import { expectTypeOf } from "expect-type";

import { defineGame, turn } from "./index";

// ---- maxPlayers form derives `playerIDs` from the literal capacity ----
const ttt = defineGame({
  maxPlayers: 2,
  setup: (): { board: number[] } => ({ board: [0, 0, 0] }),
  turn: turn.roundRobin(),
  moves: ({ move }) => ({
    placeMark: move<{ row: number; col: number }>({
      run({ G, args, move }) {
        // Inside the move runner, `G`/`args` should be precisely typed.
        expectTypeOf(G.board).toEqualTypeOf<readonly number[]>();
        expectTypeOf(args).toEqualTypeOf<{ row: number; col: number }>();
        return move.endTurn();
      },
    }),
  }),
});

// `maxPlayers: 2` → `playerIDs: ["0", "1"]` (literal tuple, not `string[]`).
expectTypeOf<GamePlayers<typeof ttt>>().toEqualTypeOf<["0", "1"]>();
expectTypeOf<GameStateOf<typeof ttt>["board"]>().toEqualTypeOf<number[]>();

// ---- playerIDs form preserves the literal seat tuple ----
const chess = defineGame({
  playerIDs: ["white", "black"] as const,
  setup: (): { fen: string } => ({ fen: "" }),
  turn: turn.roundRobin(),
  moves: ({ move }) => ({
    advance: move({
      run({ move }) {
        return move.endTurn();
      },
    }),
  }),
});

expectTypeOf<GamePlayers<typeof chess>>().toEqualTypeOf<readonly ["white", "black"]>();
expectTypeOf(chess.playerIDs).toEqualTypeOf<readonly ["white", "black"]>();

// ---- `playerIDs` propagates to per-move `player.id` ----
defineGame({
  playerIDs: ["white", "black"] as const,
  setup: (): { ply: number } => ({ ply: 0 }),
  turn: turn.roundRobin(),
  moves: ({ move }) => ({
    nudge: move({
      run({ player, move }) {
        // `player.id` is the seat literal union, not generic string.
        expectTypeOf(player.id).toEqualTypeOf<"white" | "black">();
        return move.endTurn();
      },
    }),
  }),
});

// ---- views reverse-infer `TPublic` / `TPlayer` ----
interface CounterPublic { ticks: number }
interface CounterPlayer extends CounterPublic { mine: boolean }

const counter = defineGame({
  maxPlayers: 2,
  setup: (): { ticks: number } => ({ ticks: 0 }),
  turn: turn.roundRobin(),
  moves: ({ move }) => ({
    tick: move({ run: ({ G, move }) => move.endTurn({ ticks: G.ticks + 1 }) }),
  }),
  views: {
    public: ({ G }): CounterPublic => ({ ticks: G.ticks }),
    player: ({ G }, _player): CounterPlayer => ({ ticks: G.ticks, mine: true }),
  },
});

// View return types ride through to the compiled definition.
expectTypeOf(counter.views!.public!).returns.toEqualTypeOf<CounterPublic>();
expectTypeOf(counter.views!.player!).returns.toEqualTypeOf<CounterPlayer>();
