// Type-level tests for `createHostedClient`. The client is the protocol-level
// transport; its generics `TPublicState` / `TResult` thread into every method
// that returns the snapshot or batch (`getState`, `getInitialSnapshot`,
// `getBatchHistory`, `dispatchEvent`'s outcome). A regression that erased
// these to `ProtocolValue` would silently un-type every `client.getState().G`
// access in consumer code.

import type { BatchApplied } from "@openturn/protocol";
import { expectTypeOf } from "expect-type";

import { createHostedClient } from "./index";
import type { HostedClient, HostedClientState, HostedDispatchOutcome } from "./index";

interface MyPublic {
  board: number[];
  turn: "0" | "1";
}

interface MyResult {
  winner: "0" | "1" | null;
}

// ---- generics thread through to every typed method ----
const client = createHostedClient<MyPublic, MyResult>({
  roomID: "room-1",
  playerID: "0",
  getRoomToken: async () => "token",
});

expectTypeOf(client).toEqualTypeOf<HostedClient<MyPublic, MyResult>>();

// `getState()` returns the typed state.
expectTypeOf(client.getState()).toEqualTypeOf<HostedClientState<MyPublic, MyResult>>();

// `dispatchEvent` resolves with a typed outcome.
expectTypeOf(client.dispatchEvent("placeMark", { row: 0, col: 0 })).resolves.toEqualTypeOf<
  HostedDispatchOutcome<MyPublic, MyResult>
>();

// Batch history preserves the generic.
expectTypeOf(client.getBatchHistory()).toEqualTypeOf<readonly BatchApplied<MyPublic, MyResult>[]>();

// `getInitialSnapshot` is nullable but typed.
const initial = client.getInitialSnapshot();
if (initial !== null) {
  // Snapshot's G is the public-state type.
  expectTypeOf(initial.G).toMatchTypeOf<MyPublic>();
}

// ---- HostedDispatchOutcome ok-branch carries the typed batch ----
declare const outcome: HostedDispatchOutcome<MyPublic, MyResult>;
if (outcome.ok) {
  expectTypeOf(outcome.batch).toEqualTypeOf<BatchApplied<MyPublic, MyResult>>();
} else {
  // Error branch has the protocol error code, no batch.
  expectTypeOf(outcome.error).toMatchTypeOf<string>();
  expectTypeOf(outcome).not.toHaveProperty("batch");
}
