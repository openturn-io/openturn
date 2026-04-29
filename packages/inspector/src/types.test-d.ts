// Type-level tests for the inspector's `CursorInspector` and replay-source
// timeline materialization. The inspector threads `TGame` through to the
// `ReplayFrame<TGame>` returned by `getCurrentFrame()` / `getPreviousFrame()`,
// so a regression where TGame got erased to `AnyGame` would silently lose
// typed access to `frame.snapshot.G` for inspector consumers (e.g. devtools
// panels rendering game-specific UI off the active frame).

import { defineGame, turn } from "@openturn/gamekit";
import { materializeReplay, createReplayCursor } from "@openturn/replay";
import type { ReplayFrame } from "@openturn/replay";
import { expectTypeOf } from "expect-type";

import { createCursorInspector, buildInspectorTimelineFromSource } from "./index";
import type { CursorInspector, InspectorSource, InspectorTimeline } from "./index";

const ttt = defineGame({
  playerIDs: ["0", "1"] as const,
  setup: (): { board: number[] } => ({ board: [0, 0, 0] }),
  turn: turn.roundRobin(),
  moves: ({ move }) => ({
    placeMark: move<{ row: number; col: number }>({ run: ({ move }) => move.endTurn() }),
  }),
});

const timeline = materializeReplay(ttt, {
  actions: [],
  match: { players: ["0", "1"] },
  seed: "deterministic",
});

const cursor = createReplayCursor(timeline);

// ---- createCursorInspector preserves TGame ----
const inspector = createCursorInspector(cursor, ttt);
expectTypeOf(inspector).toEqualTypeOf<CursorInspector<typeof ttt>>();

// `getCurrentFrame` returns a typed `ReplayFrame<TGame>`.
expectTypeOf(inspector.getCurrentFrame()).toEqualTypeOf<ReplayFrame<typeof ttt>>();
expectTypeOf(inspector.getCurrentFrame().snapshot.G.board).toEqualTypeOf<number[]>();

// `getPreviousFrame` is nullable.
expectTypeOf(inspector.getPreviousFrame()).toEqualTypeOf<ReplayFrame<typeof ttt> | null>();

// ---- InspectorSource discriminated union ----
const replaySource: InspectorSource<typeof ttt> = { kind: "replay", timeline, game: ttt };
expectTypeOf(buildInspectorTimelineFromSource(replaySource)).toEqualTypeOf<InspectorTimeline>();

// Discriminate on `kind`.
declare const source: InspectorSource<typeof ttt>;
if (source.kind === "replay") {
  expectTypeOf(source.timeline).not.toBeAny();
  expectTypeOf(source.game).toEqualTypeOf<typeof ttt>();
}
