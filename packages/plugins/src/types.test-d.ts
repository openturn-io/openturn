// Type-level tests for `withPlugins`. The earlier `as never` regression
// silently widened `TPlayers` to `never`, breaking every downstream consumer
// of `typeof gameWithPlugins`. These assertions catch that class of bug at
// the package boundary rather than at the user's call site.

import type { GamePlayers, GameStateOf } from "@openturn/core";
import { turn } from "@openturn/gamekit";
import { expectTypeOf } from "expect-type";

import { definePlugin, withPlugins } from "./index";

const noopPlugin = definePlugin({
  id: "noop",
  setup: (): { count: number } => ({ count: 0 }),
  moves: {
    bump: {
      run({ G }) {
        return { kind: "stay", patch: { count: G.count + 1 } };
      },
    },
  },
});

// ---- maxPlayers form: literal player tuple is preserved ----
const withMaxPlayers = withPlugins(
  {
    maxPlayers: 2,
    setup: (): { score: number } => ({ score: 0 }),
    turn: turn.roundRobin(),
    moves: ({ move }) => ({
      tick: move({ run: ({ G, move }) => move.endTurn({ score: G.score + 1 }) }),
    }),
  },
  [noopPlugin],
);

expectTypeOf<GamePlayers<typeof withMaxPlayers>>().toEqualTypeOf<["0", "1"]>();
expectTypeOf<GameStateOf<typeof withMaxPlayers>["score"]>().toEqualTypeOf<number>();

// ---- playerIDs form: literal seat tuple preserved through composition ----
const withPlayerIDs = withPlugins(
  {
    playerIDs: ["alpha", "beta"] as const,
    setup: (): { score: number } => ({ score: 0 }),
    turn: turn.roundRobin(),
    moves: ({ move }) => ({
      tick: move({ run: ({ move }) => move.endTurn() }),
    }),
  },
  [noopPlugin],
);

expectTypeOf<GamePlayers<typeof withPlayerIDs>>().toEqualTypeOf<readonly ["alpha", "beta"]>();

// ---- contextual typing flows into the moves callback ----
withPlugins(
  {
    maxPlayers: 3,
    setup: (): { hp: number } => ({ hp: 10 }),
    turn: turn.roundRobin(),
    moves: ({ move }) => ({
      hit: move<{ damage: number }>({
        run({ G, args, player, move }) {
          // Without proper inference these would be `any`.
          expectTypeOf(G.hp).toEqualTypeOf<number>();
          expectTypeOf(args.damage).toEqualTypeOf<number>();
          expectTypeOf(player.id).toEqualTypeOf<"0" | "1" | "2">();
          return move.endTurn({ hp: G.hp - args.damage });
        },
      }),
    }),
  },
  [noopPlugin],
);

// ---- views reverse-infer `TPublic` / `TPlayer` AND have plugin slices ----
interface PublicView { score: number }
interface PlayerView extends PublicView { isMe: boolean }

const withViews = withPlugins(
  {
    maxPlayers: 2,
    setup: (): { score: number } => ({ score: 0 }),
    turn: turn.roundRobin(),
    moves: ({ move }) => ({
      tick: move({ run: ({ move }) => move.endTurn() }),
    }),
    views: {
      public: ({ G }): PublicView => ({ score: G.score }),
      player: ({ G }, _player): PlayerView => ({ score: G.score, isMe: true }),
    },
  },
  [noopPlugin],
);

// Result intersects `PluginsState<TPlugins>` onto the view types so the
// runtime's plugin-slice merging is visible at the type level.
type WithViewsPlayer = ReturnType<NonNullable<NonNullable<typeof withViews.views>["player"]>>;
expectTypeOf<WithViewsPlayer>().toEqualTypeOf<PlayerView & { plugins: { noop: { count: number } } }>();
