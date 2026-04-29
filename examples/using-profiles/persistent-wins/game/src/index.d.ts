/**
 * Persistent wins (gamekit flavor).
 *
 * Two players tap; whoever taps first wins; winner's persistent `wins`
 * counter is incremented by 1 via a pure `profile.commit`. Because
 * `profile.inc` emits an `inc` op (not a read-modify-write `set`), concurrent
 * commits compose correctly — the wire delta is retry-safe.
 */
import { type ApplyProfileCommitOutput } from "@openturn/gamekit";
export declare const persistentWinsMatch: import("@openturn/core").MatchInput<readonly ["0", "1"], import("@openturn/core").ReplayValue>;
export type PersistentWinsPlayerID = (typeof persistentWinsMatch.players)[number];
export type PersistentWinsProfile = {
    wins: number;
};
export declare const persistentWinsProfile: import("@openturn/core").GameProfileConfig<PersistentWinsProfile, import("@openturn/core").PlayerList, import("@openturn/gamekit").GamekitResultState | null>;
export interface PersistentWinsState {
    over: boolean;
}
export declare const persistentWinsGame: import("@openturn/core").GameDefinition<import("@openturn/gamekit").GamekitState<PersistentWinsState>, {
    tap: any;
}, import("@openturn/gamekit").GamekitResultState, import("@openturn/core").PlayerList, "__gamekit_finished" | "play", PersistentWinsState, PersistentWinsState, import("@openturn/core").ReplayValue, readonly import("@openturn/core").GameTransitionConfig<import("@openturn/gamekit").GamekitState<PersistentWinsState>, {
    tap: any;
}, import("@openturn/gamekit").GamekitResultState, "__gamekit_finished" | "play", import("@openturn/core").PlayerList, import("@openturn/core").ReplayValue>[]>;
/** Convenience for tests / local single-player shells. */
export declare function applyCommitLocally(profilesAtSetup: Partial<Record<PersistentWinsPlayerID, PersistentWinsProfile>>, result: {
    winner?: PersistentWinsPlayerID;
} | null): ApplyProfileCommitOutput<typeof persistentWinsMatch.players, PersistentWinsProfile>;
