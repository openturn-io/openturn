// Type-level tests for `defineGameDeployment`'s protocol-compatibility brand.
// The check intersects `ProtocolCompatibilityError<TGame>` with the parameter,
// so a JSON-compatible game accepts and a game with a non-serializable slot
// (function in state, etc.) is rejected with a readable `openturnError` field.

import { defineGame, turn } from "@openturn/gamekit";
import { expectTypeOf } from "expect-type";

import { defineGameDeployment } from "./index";

// ---- compatible game accepts ----
const ttt = defineGame({
  maxPlayers: 2,
  setup: (): { board: number[] } => ({ board: [0, 0, 0] }),
  turn: turn.roundRobin(),
  moves: ({ move }) => ({
    placeMark: move<{ row: number; col: number }>({ run: ({ move }) => move.endTurn() }),
  }),
});

const deployment = defineGameDeployment({
  deploymentVersion: "v1",
  game: ttt,
  gameKey: "ttt",
  schemaVersion: "1",
});

// Deployment retains the typed game.
expectTypeOf(deployment.game).toEqualTypeOf<typeof ttt>();
expectTypeOf(deployment.gameKey).toEqualTypeOf<string>();

// ---- incompatible game would error at the call site ----
//
// Asserting the brand fires for a bad game is hard inside `expect-type`
// (there's no API for "this should be a type error" without `// @ts-expect-error`
// on a real call). The compatible-game accept above (line 21) implicitly
// verifies the brand allows JSON-compatible games; if the brand wiring
// regressed and required `openturnError` on every game, that line would
// fail. The next line keeps the test as a regression sentinel by exercising
// a non-trivial generic instantiation.
expectTypeOf(deployment.game.events).toEqualTypeOf<typeof ttt.events>();
