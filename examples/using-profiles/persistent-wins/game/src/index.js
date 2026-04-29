/**
 * Persistent wins (gamekit flavor).
 *
 * Two players tap; whoever taps first wins; winner's persistent `wins`
 * counter is incremented by 1 via a pure `profile.commit`. Because
 * `profile.inc` emits an `inc` op (not a read-modify-write `set`), concurrent
 * commits compose correctly — the wire delta is retry-safe.
 */
import { defineMatch } from "@openturn/core";
import { applyProfileCommit, defineGame, defineProfile, } from "@openturn/gamekit";
export const persistentWinsMatch = defineMatch({
    players: ["0", "1"],
});
export const persistentWinsProfile = defineProfile({
    schemaVersion: "1",
    default: { wins: 0 },
    parse: (data) => {
        const obj = (data ?? {});
        const wins = typeof obj.wins === "number" && Number.isFinite(obj.wins) ? obj.wins : 0;
        return { wins };
    },
    commit: ({ profile, result }) => result?.winner === undefined
        ? {}
        : profile.inc(result.winner, "wins", 1),
});
export const persistentWinsGame = defineGame(persistentWinsMatch, {
    profile: persistentWinsProfile,
    setup: () => ({ over: false }),
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
export function applyCommitLocally(profilesAtSetup, result) {
    return applyProfileCommit({
        match: persistentWinsMatch,
        profile: persistentWinsProfile,
        profilesBefore: profilesAtSetup,
        result,
    });
}
