/**
 * Persistent wins (gamekit flavor).
 *
 * Two players tap; whoever taps first wins; winner's persistent `wins`
 * counter is incremented by 1 via a pure `profile.commit`. Because
 * `profile.inc` emits an `inc` op (not a read-modify-write `set`), concurrent
 * commits compose correctly — the wire delta is retry-safe.
 */

import {
  applyProfileCommit,
  defineGame,
  defineProfile,
  type ApplyProfileCommitOutput,
} from "@openturn/gamekit";

const PERSISTENT_WINS_PLAYERS = ["0", "1"] as const;

export type PersistentWinsPlayerID = (typeof PERSISTENT_WINS_PLAYERS)[number];

export type PersistentWinsProfile = { wins: number };

export const persistentWinsProfile = defineProfile({
  schemaVersion: "1",
  default: { wins: 0 } as PersistentWinsProfile,
  parse: (data): PersistentWinsProfile => {
    const obj = (data ?? {}) as { wins?: unknown };
    const wins = typeof obj.wins === "number" && Number.isFinite(obj.wins) ? obj.wins : 0;
    return { wins };
  },
  commit: ({ profile, result }) =>
    result?.winner === undefined
      ? {}
      : profile.inc(result.winner, "wins", 1),
});

export interface PersistentWinsState {
  over: boolean;
}

export const persistentWinsGame = defineGame({
  playerIDs: PERSISTENT_WINS_PLAYERS,
  profile: persistentWinsProfile,
  setup: (): PersistentWinsState => ({ over: false }),
  moves: ({ move }) => ({
    tap: move({
      run: ({ player, move: m }) => m.finish({ winner: player.id }, { over: true }),
    }),
  }),
  phases: {
    play: {
      activePlayers: ({ turn }) => [...turn.players],
      label: "First tap wins",
    },
  },
});

/** Convenience for tests / local single-player shells. */
export function applyCommitLocally(
  profilesAtSetup: Partial<Record<PersistentWinsPlayerID, PersistentWinsProfile>>,
  result: { winner?: PersistentWinsPlayerID } | null,
): ApplyProfileCommitOutput<typeof PERSISTENT_WINS_PLAYERS, PersistentWinsProfile> {
  return applyProfileCommit({
    match: { players: PERSISTENT_WINS_PLAYERS },
    profile: persistentWinsProfile,
    profilesBefore: profilesAtSetup,
    result,
  });
}
