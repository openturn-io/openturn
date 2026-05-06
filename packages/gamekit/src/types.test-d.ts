// Type-level tests for `defineGame` inference. These compile-time assertions
// pin down the overload-selection contract so a regression (e.g. an inference
// quirk that widens `TPlayers` to `PlayerList` instead of the literal tuple)
// fails the package's typecheck immediately.
//
// No runtime cost — `expect-type`'s assertions are erased at compile time.
// File is included by `tsc` (matches `src/**/*.ts`, doesn't match `*.test.ts`)
// but not by the test runner.

import type { ConfigSchema, GameConfigValuesOf, GamePlayers, GameStateOf, ReplayValue } from "@openturn/core";
import { expectTypeOf } from "expect-type";

import { defineGame, turn } from "./index";
import type { BoundPhaseMoves, GamekitMoveDefinition } from "./index";

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

// ---- BoundPhaseMoves works with explicit TMoves ----
type ManualMove = GamekitMoveDefinition<
  { last: number },
  Record<string, never>,
  { x: number },
  "play",
  ["0", "1"],
  never,
  never
>;
type ManualMoves = { place: ManualMove };
type ManualBound = BoundPhaseMoves<{ last: number }, "play", ["0", "1"], ManualMoves>;
declare const manualBound: ManualBound;
// Smoke: calling with the declared args compiles.
manualBound.place({ x: 5 });

// ---- phase.onTimeout (object-literal `phases:` form) ----
//
// Note: With `phases:` written as an object literal, TS can't propagate
// `TMoves` from the sibling `moves: ({ move }) => ({...})` callback through
// to `onTimeout`'s `moves` parameter — both fields infer simultaneously and
// `TMoves` is unresolved when `phases:` gets type-checked. The runtime
// dispatcher does carry per-args precision (each call invokes the underlying
// `move.run`); the surface signature settles as a permissive
// `Record<string, ...>`. Use the callback `phases: ({ moves }) => ({...})`
// form below to get a typed dispatcher.
defineGame({
  playerIDs: ["0", "1"] as const,
  setup: (): { last: number } => ({ last: 0 }),
  turn: turn.roundRobin(),
  moves: ({ move }) => ({
    place: move<{ x: number }>({
      run: ({ args, move }) => move.stay({ last: args.x }),
    }),
  }),
  phases: {
    play: {
      deadline: () => 1_000,
      onTimeout: (ctx, _moves) => {
        // ctx exposes the same `G`/`turn`/`player`/`rng` shape regular moves see.
        expectTypeOf(ctx.G.last).toEqualTypeOf<number>();
        expectTypeOf(ctx.player.id).toEqualTypeOf<"0" | "1">();
        // Returning null no-ops the timeout.
        return null;
      },
    },
  },
});

// ---- phase.onTimeout (callback `phases:` form, smoke) ----
//
// gamekit accepts a callback form `phases: ({ moves }) => ({...})` whose
// outer `moves` is the typed `BoundPhaseMoves<...>` dispatcher. Inside the
// inner `onTimeout(ctx, moves)`, `moves` is the same shape (per-args
// precise per-move). At present, TS's union-based inference for `phases`
// (object-literal vs callback) interacts with `TState` / `TPhase` /
// `TPlayers` inference in ways that depend on which other fields the game
// declares — games that declare typed `views:` may need to keep `phases:`
// as an object literal. The Splendor example demonstrates this trade-off:
// it stays on object-literal `phases:` plus a runtime cast in `onTimeout`
// because its `views:` would otherwise widen `TState` to the loose JSON
// shape under the callback variant.
//
// (The type-level wiring is exercised by the `BoundPhaseMoves` smoke test
// at line ~102 — that's the load-bearing typing.)

// ---- config schema is preserved on the compiled definition ----
const configured = defineGame({
  maxPlayers: 2,
  config: {
    turnTimeoutMs: { type: "number", default: 30_000, label: "Turn time" },
    variant: {
      type: "enum",
      options: ["classic", "blitz"] as const,
      default: "classic",
      label: "Variant",
    },
  } as const satisfies ConfigSchema,
  setup: (): { count: number } => ({ count: 0 }),
  moves: ({ move }) => ({
    bump: move({ run: ({ G, move: m }) => m.endTurn({ count: G.count + 1 }) }),
  }),
});

// `GameConfigValuesOf` derives the typed values shape from the compiled
// definition's preserved schema. Enum option literals stay narrow because the
// schema was authored with `as const satisfies ConfigSchema`.
expectTypeOf<GameConfigValuesOf<typeof configured>["turnTimeoutMs"]>().toEqualTypeOf<number>();
expectTypeOf<GameConfigValuesOf<typeof configured>["variant"]>().toEqualTypeOf<"classic" | "blitz">();

// ---- typed match.config flows into phase / move handlers ----
defineGame({
  maxPlayers: 2,
  config: {
    turnTimeoutMs: { type: "number", default: 30_000, label: "Turn time" },
  } as const satisfies ConfigSchema,
  setup: (): { count: number } => ({ count: 0 }),
  moves: ({ move }) => ({
    bump: move({
      run: ({ G, match, move: m }) => {
        // match.config is required (not optional) when game declares schema.
        expectTypeOf(match.config.turnTimeoutMs).toEqualTypeOf<number>();
        return m.endTurn({ count: G.count + 1 });
      },
    }),
  }),
  phases: {
    play: {
      deadline: (ctx) => {
        expectTypeOf(ctx.match.config.turnTimeoutMs).toEqualTypeOf<number>();
        expectTypeOf(ctx.now).toEqualTypeOf<number>();
        return ctx.now + ctx.match.config.turnTimeoutMs;
      },
      onTimeout: (ctx, _moves) => {
        expectTypeOf(ctx.match.config.turnTimeoutMs).toEqualTypeOf<number>();
        return null;
      },
    },
  },
});

// ---- games without a config schema keep loose match.config typing ----
defineGame({
  maxPlayers: 2,
  setup: (): { count: number } => ({ count: 0 }),
  moves: ({ move }) => ({
    bump: move({
      run: ({ G, match, move: m }) => {
        // No schema → match.config is optional and loosely typed (matching
        // core's MatchInput default).
        expectTypeOf(match.config).toEqualTypeOf<Record<string, ReplayValue> | undefined>();
        return m.endTurn({ count: G.count + 1 });
      },
    }),
  }),
});
