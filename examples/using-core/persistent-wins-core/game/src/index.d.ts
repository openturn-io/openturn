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
import { type ApplyProfileCommitOutput, type LocalGameSession } from "@openturn/core";
export declare const persistentWinsMatch: import("@openturn/core").MatchInput<readonly ["0", "1"], import("@openturn/core").ReplayValue>;
export type PersistentWinsPlayerID = (typeof persistentWinsMatch.players)[number];
export type PersistentWinsProfile = {
    wins: number;
};
export declare const persistentWinsGame: import("@openturn/core").GameDefinition<{
    over: boolean;
}, {
    tap: undefined;
}, import("@openturn/core").ReplayValue, readonly ["0", "1"], "done" | "play", {
    over: boolean;
}, {
    over: boolean;
}, import("@openturn/core").ReplayValue, {
    event: "tap";
    from: "play";
    resolve: ({ playerID }: import("@openturn/core").GameEventContext<{
        over: boolean;
    }, {
        tap: undefined;
    }, "done" | "play", readonly ["0", "1"], any, "tap">) => {
        G: {
            over: boolean;
        };
        result: PersistentWinsPlayerID;
    };
    to: "done";
}[]>;
/**
 * The profile config after `defineGame` resolves the callback. Tests and
 * out-of-band settlement helpers can reference this without re-invoking the
 * factory.
 */
export declare const persistentWinsProfile: import("@openturn/core").GameProfileConfig<PersistentWinsProfile, readonly ["0", "1"], "0" | "1" | null> | undefined;
/** Convenience for local/test use. Pass `profiles` to simulate hydrated cloud state. */
export declare function createPersistentWinsSession(profiles?: {
    [key in PersistentWinsPlayerID]?: PersistentWinsProfile;
}): LocalGameSession<typeof persistentWinsGame>;
/**
 * Settle a finished match against a local profile store, mirroring what
 * openturn-cloud does server-side. Returns the new profile map and any
 * per-player apply rejections (e.g. type_mismatch after schema drift).
 */
export declare function settlePersistentWinsMatch(session: LocalGameSession<typeof persistentWinsGame>, profilesAtSetup: Partial<Record<PersistentWinsPlayerID, PersistentWinsProfile>>): ApplyProfileCommitOutput<typeof persistentWinsMatch.players, PersistentWinsProfile>;
