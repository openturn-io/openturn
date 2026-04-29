// Type-level tests for the replay materialization surface. The materialized
// timeline must expose `frames` whose `snapshot.G`, `playerView`, and
// `action.event`/`action.payload` are all typed against the source game's
// generics. A regression that widened any of these to `unknown` would still
// pass at runtime but silently break replay-viewer ergonomics.

import { defineGame, turn } from "@openturn/gamekit";
import { expectTypeOf } from "expect-type";

import { materializeReplay } from "./index";
import type { ReplayFrame, ReplayTimeline } from "./index";

const ttt = defineGame({
  playerIDs: ["0", "1"] as const,
  setup: (): { board: number[] } => ({ board: [0, 0, 0] }),
  turn: turn.roundRobin(),
  moves: ({ move }) => ({
    placeMark: move<{ row: number; col: number }>({ run: ({ move }) => move.endTurn() }),
  }),
});

// `materializeReplay` returns a `ReplayTimeline<TGame>`.
const timeline = materializeReplay(ttt, {
  actions: [],
  match: { players: ["0", "1"] },
  seed: "deterministic",
});

expectTypeOf(timeline).toEqualTypeOf<ReplayTimeline<typeof ttt>>();
expectTypeOf(timeline.frames).toEqualTypeOf<readonly ReplayFrame<typeof ttt>[]>();

// Frame snapshots carry the typed `G` from the game's `setup`.
type Frame = ReplayFrame<typeof ttt>;
expectTypeOf<Frame["snapshot"]["G"]["board"]>().toEqualTypeOf<number[]>();
expectTypeOf<Frame["revision"]>().toEqualTypeOf<number>();

// `playerView` is `GamePlayerView<TGame> | null` — defaults to the game's
// state shape when no `views.player` is declared, but always nullable since
// pre-connect frames have no view yet.
expectTypeOf<Frame["playerView"]>().not.toBeNull();
expectTypeOf<Frame["playerView"]>().toMatchTypeOf<{ board: number[] } | null>();

// Action records narrow on the event name discriminant.
type Action = NonNullable<Frame["action"]>;
expectTypeOf<Action["playerID"]>().toEqualTypeOf<"0" | "1">();
