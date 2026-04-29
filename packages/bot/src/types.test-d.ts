// Type-level tests for the bot authoring surface (`defineBot`). The DecideContext
// threads `TGame` deeply: `view` should be the player view, `playerID` should
// narrow to the seat tuple, and `simulate(action)` should return a typed
// snapshot. A regression where any of these widen to `any`/`unknown` would
// silently break bot author ergonomics.

import { defineGame, turn } from "@openturn/gamekit";
import { expectTypeOf } from "expect-type";

import { defineBot } from "./define";
import type { Bot, DecideContext, SimulateResult } from "./define";

interface TttPublic {
  board: readonly number[];
  currentPlayer: "0" | "1";
}
interface TttPlayer extends TttPublic {
  myMark: "X" | "O";
}

const ttt = defineGame({
  playerIDs: ["0", "1"] as const,
  setup: (): { board: number[] } => ({ board: [0, 0, 0] }),
  turn: turn.roundRobin(),
  moves: ({ move }) => ({
    placeMark: move<{ row: number; col: number }>({ run: ({ move }) => move.endTurn() }),
  }),
  views: {
    public: ({ G }): TttPublic => ({ board: G.board, currentPlayer: "0" }),
    player: ({ G }, _p): TttPlayer => ({ board: G.board, currentPlayer: "0", myMark: "X" }),
  },
});

// ---- defineBot is an identity: input shape === output shape ----
const bot = defineBot<typeof ttt>({
  name: "random",
  decide({ view, playerID, legalActions, simulate }) {
    // `view` is the player view, NOT the public view or raw state.
    expectTypeOf(view).toEqualTypeOf<TttPlayer>();

    // `playerID` narrows to the seat tuple, not generic string.
    expectTypeOf(playerID).toEqualTypeOf<"0" | "1">();

    // `simulate` returns a typed `SimulateResult<typeof ttt>`.
    const action = legalActions[0]!;
    const result = simulate(action);
    expectTypeOf(result).toEqualTypeOf<SimulateResult<typeof ttt>>();

    if (result.ok) {
      // On success, `next` is a snapshot of the same game (mutable G — the
      // snapshot is the engine's authoritative state, not the deep-readonly
      // view exposed inside transition contexts).
      expectTypeOf(result.next.G.board).toEqualTypeOf<number[]>();
    }

    return action;
  },
});

expectTypeOf(bot).toEqualTypeOf<Bot<typeof ttt>>();

// ---- DecideContext is generic in TGame; switching games re-types the view ----
type Decide = DecideContext<typeof ttt>;
expectTypeOf<Decide["view"]>().toEqualTypeOf<TttPlayer>();
expectTypeOf<Decide["playerID"]>().toEqualTypeOf<"0" | "1">();
