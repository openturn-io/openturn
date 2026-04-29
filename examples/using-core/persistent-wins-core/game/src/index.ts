/**
 * Persistent wins: smallest possible game that demonstrates cross-match state.
 *
 * - Two players. Each has a `wins` counter that persists across matches.
 * - First player to `tap` wins the match.
 * - `profile.commit` increments the winner's `wins` by 1. `profile.inc`
 *   emits an `inc` op, which is retry-safe under concurrent commits.
 *
 * In-match `G` stays trivial (`{ over: boolean }`) — the point of this example is
 * the profile lifecycle, not the game logic. Check index.test.ts for the full
 * hydrate → play → settle loop.
 */

import {
  applyProfileCommit,
  createLocalSession,
  defineGame,
  defineProfile,
  defineEvent,
  type ApplyProfileCommitOutput,
  type LocalGameSession,
} from "@openturn/core";

const PERSISTENT_WINS_PLAYERS = ["0", "1"] as const;

export type PersistentWinsPlayerID = (typeof PERSISTENT_WINS_PLAYERS)[number];

export type PersistentWinsProfile = { wins: number };

export const persistentWinsGame = defineGame({
  playerIDs: PERSISTENT_WINS_PLAYERS,
  events: {
    tap: defineEvent(),
  },
  initial: "play",
  // Callback form — binds `TResult` (here `PersistentWinsPlayerID | null`) from
  // transitions, so `commit({ result })` is typed without a cast.
  profile: ({ result }) =>
    defineProfile<
      PersistentWinsProfile,
      typeof PERSISTENT_WINS_PLAYERS,
      typeof result
    >({
      schemaVersion: "1",
      default: { wins: 0 },
      parse: (data): PersistentWinsProfile => {
        const obj = (data ?? {}) as { wins?: unknown };
        const wins = typeof obj.wins === "number" && Number.isFinite(obj.wins) ? obj.wins : 0;
        return { wins };
      },
      commit: ({ profile, result: winner }) =>
        winner === null
          ? {}
          : profile.inc(winner, "wins", 1),
    }),
  setup: () => ({ over: false }),
  states: {
    done: {
      activePlayers: () => [],
      label: "Match complete",
    },
    play: {
      activePlayers: ({ match }) => [...match.players],
      label: "First tap wins",
    },
  },
  transitions: [
    {
      event: "tap",
      from: "play",
      resolve: ({ playerID }): { G: { over: boolean }; result: PersistentWinsPlayerID } => ({
        G: { over: true },
        result: playerID as PersistentWinsPlayerID,
      }),
      to: "done",
    },
  ],
});

/**
 * The profile config after `defineGame` resolves the callback. Tests and
 * out-of-band settlement helpers can reference this without re-invoking the
 * factory.
 */
export const persistentWinsProfile = (persistentWinsGame as {
  profile: Parameters<typeof applyProfileCommit<
    typeof PERSISTENT_WINS_PLAYERS,
    PersistentWinsProfile,
    PersistentWinsPlayerID | null
  >>[0]["profile"];
}).profile;

/** Convenience for local/test use. Pass `profiles` to simulate hydrated cloud state. */
export function createPersistentWinsSession(
  profiles?: { [key in PersistentWinsPlayerID]?: PersistentWinsProfile },
): LocalGameSession<typeof persistentWinsGame> {
  return createLocalSession(persistentWinsGame, {
    match: {
      players: PERSISTENT_WINS_PLAYERS,
      ...(profiles === undefined ? {} : { profiles: profiles as Record<PersistentWinsPlayerID, PersistentWinsProfile> }),
    },
  });
}

/**
 * Settle a finished match against a local profile store, mirroring what
 * openturn-cloud does server-side. Returns the new profile map and any
 * per-player apply rejections (e.g. type_mismatch after schema drift).
 */
export function settlePersistentWinsMatch(
  session: LocalGameSession<typeof persistentWinsGame>,
  profilesAtSetup: Partial<Record<PersistentWinsPlayerID, PersistentWinsProfile>>,
): ApplyProfileCommitOutput<typeof PERSISTENT_WINS_PLAYERS, PersistentWinsProfile> {
  return applyProfileCommit({
    match: { players: PERSISTENT_WINS_PLAYERS },
    profile: persistentWinsProfile,
    profilesBefore: profilesAtSetup,
    result: session.getResult() as PersistentWinsPlayerID | null,
  });
}
