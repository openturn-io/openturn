// Type-level tests for `createOpenturnBindings`. The chat-app bug from a
// prior session was: `room.game.dispatch.placeMark` got typed as
// `unknown`/`Record<string, ...>` because of a generic regression in the
// game definition's event map. These assertions pin down that the dispatch
// surface exposes the move-name shortcuts with their typed args.

import { defineGame, turn } from "@openturn/gamekit";
import { expectTypeOf } from "expect-type";

import { createOpenturnBindings, type HostedRoomState } from "./index";

interface PlaceMarkArgs {
  row: number;
  col: number;
}

const ttt = defineGame({
  maxPlayers: 2,
  setup: (): { board: number[] } => ({ board: [0, 0, 0] }),
  turn: turn.roundRobin(),
  moves: ({ move }) => ({
    placeMark: move<PlaceMarkArgs>({ run: ({ move }) => move.endTurn() }),
    forfeit: move({ run: ({ move }) => move.endTurn() }),
  }),
});

const { useRoom } = createOpenturnBindings(ttt, { runtime: "multiplayer" });

type Room = ReturnType<typeof useRoom>;

// `useRoom()` ⇒ `HostedRoomState<typeof ttt>`.
expectTypeOf<Room>().toEqualTypeOf<HostedRoomState<typeof ttt>>();

// ---- dispatch is keyed by move name with typed args ----
type Match = NonNullable<Room["game"]>;
type Dispatch = Match["dispatch"];

// Each declared move has a dispatcher property (not just a string index).
expectTypeOf<Dispatch>().toHaveProperty("placeMark");
expectTypeOf<Dispatch>().toHaveProperty("forfeit");

// `placeMark` accepts the move's typed args.
expectTypeOf<Dispatch["placeMark"]>().parameter(0).toEqualTypeOf<PlaceMarkArgs>();
expectTypeOf<Dispatch["placeMark"]>().returns.toMatchTypeOf<Promise<unknown>>();

// `canDispatch.<move>` is `boolean` per move.
type CanDispatch = Match["canDispatch"];
expectTypeOf<CanDispatch>().toHaveProperty("placeMark");
expectTypeOf<CanDispatch["placeMark"]>().toEqualTypeOf<boolean>();

// ---- snapshot.G is the player view (defaults to TState when no views) ----
type Snapshot = NonNullable<Match["snapshot"]>;
expectTypeOf<Snapshot["G"]["board"]>().toEqualTypeOf<number[]>();
