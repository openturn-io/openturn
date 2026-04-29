import {
  createLocalSessionFromSnapshot,
  type AnyGame,
  type GamePlayers,
  type GameSnapshotOf,
  type LegalAction,
  type MatchInput,
} from "@openturn/core";

import type { SimulateResult } from "./define";

/**
 * Dry-run a candidate action against a clone of the given snapshot.
 *
 * Implementation: rehydrate a `LocalGameSession` from the snapshot — which
 * already deep-clones JSON state and resumes RNG from `meta.rng` — apply the
 * candidate event, and read the resulting snapshot. The original session is
 * untouched.
 *
 * Determines `outcome` heuristically from the new snapshot:
 *  - If `meta.result` becomes non-null → "finish"
 *  - If `position.turn` advanced → "endTurn"
 *  - Otherwise → "stay"
 */
export function simulate<TGame extends AnyGame>(
  game: TGame,
  snapshot: GameSnapshotOf<TGame>,
  playerID: GamePlayers<TGame>[number],
  action: LegalAction,
): SimulateResult<TGame> {
  const match = snapshot.meta.match as MatchInput<GamePlayers<TGame>>;
  const cloneSession = createLocalSessionFromSnapshot(game, {
    initialNow: snapshot.meta.now,
    match,
    seed: snapshot.meta.seed,
    snapshot: snapshot as never,
    // The live session was already validated; skip revalidation in this
    // hot path (MCTS / minimax rollouts call this thousands of times).
    skipValidation: true,
  });

  const result = cloneSession.applyEvent(playerID, action.event as never, action.payload as never);

  if (!result.ok) {
    return { ok: false, reason: result.error };
  }

  const next = cloneSession.getState() as GameSnapshotOf<TGame>;
  const previousTurn = snapshot.position.turn;
  const nextTurn = next.position.turn;
  const finished = next.meta.result !== null && next.meta.result !== undefined;

  const outcome: "endTurn" | "stay" | "finish" = finished
    ? "finish"
    : nextTurn !== previousTurn
      ? "endTurn"
      : "stay";

  return { ok: true, outcome, next };
}
