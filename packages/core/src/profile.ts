import { cloneJsonValue } from "@openturn/json";

import { createProfileMutation, updateProfile, type ProfileMutation } from "./profile-draft";
import type {
  GameResultState,
  MatchInput,
  PlayerList,
  PlayerRecord,
  ProfileCommitDeltaMap,
  ProfileDelta,
  ProfileOp,
  ProfilePath,
  ProfilePathInput,
  ProfilePathSegment,
  ReplayValue,
} from "./types";

export type {
  ProfileCommitDeltaMap,
  ProfileDelta,
  ProfileOp,
  ProfilePath,
  ProfilePathInput,
  ProfilePathSegment,
};

/**
 * Canonical profile-mutation namespace.
 *
 * - `profile.bind(profiles)` returns a bound `ProfileMutation` helper with
 *   `inc`/`push`/`set`/`remove`/`update` methods for authoring commit deltas.
 * - `profile.update(profiles, playerID, recipe)` runs an Immer-style recipe
 *   against one player's draft and returns a single-player commit map.
 *
 * Example:
 *
 * ```ts
 * commit: ({ profile, result }) => profile.inc(result.winner, "wins", 1),
 * ```
 */
export const profile = {
  bind: createProfileMutation,
  update: updateProfile,
};

export interface GameProfileCommitContext<
  TPlayers extends PlayerList = PlayerList,
  TResult = ReplayValue | null,
  TProfile extends ReplayValue = ReplayValue,
> {
  match: MatchInput<TPlayers>;
  /** Bound mutation helper for the game-scoped profiles hydrated into this match. */
  profile: ProfileMutation<TPlayers, TProfile>;
  profiles: Readonly<PlayerRecord<TPlayers, TProfile>>;
  result: TResult;
}

export interface GameProfileMigrateArgs {
  data: unknown;
  fromVersion: string;
}

export interface GameProfileConfig<
  TProfile extends ReplayValue = ReplayValue,
  TPlayers extends PlayerList = PlayerList,
  TResult = ReplayValue | null,
> {
  commit?: (
    context: GameProfileCommitContext<TPlayers, TResult, TProfile>,
  ) => ProfileCommitDeltaMap<TPlayers>;
  default: TProfile;
  migrate?: (args: GameProfileMigrateArgs) => TProfile;
  parse?: (data: unknown) => TProfile;
  schemaVersion: string;
}

export function defineProfile<
  TProfile extends ReplayValue,
  TPlayers extends PlayerList = PlayerList,
  TResult = ReplayValue | null,
>(
  config: GameProfileConfig<TProfile, TPlayers, TResult>,
): GameProfileConfig<TProfile, TPlayers, TResult> {
  return config;
}

export type ProfileApplyError =
  | "empty_path"
  | "invalid_container"
  | "invalid_delta"
  | "missing_path"
  | "out_of_range"
  | "type_mismatch";

export interface ProfileApplyRejection {
  at?: number;
  error: ProfileApplyError;
  ok: false;
  reason?: string;
}

export interface ProfileApplySuccess<T extends ReplayValue = ReplayValue> {
  data: T;
  ok: true;
}

export type ProfileApplyResult<T extends ReplayValue = ReplayValue> =
  | ProfileApplyRejection
  | ProfileApplySuccess<T>;

/**
 * Apply a sequence of ops to a JSON-compatible profile. Pure; returns a new value.
 * Rejects on schema-incompatible ops (e.g., inc on a string).
 */
export function applyProfileDelta<T extends ReplayValue = ReplayValue>(
  data: T,
  delta: ProfileDelta,
): ProfileApplyResult<T> {
  if (!validateProfileDelta(delta)) {
    return { ok: false, error: "invalid_delta" };
  }

  let cursor = cloneJsonValue(data) as ReplayValue;
  for (let i = 0; i < delta.length; i++) {
    const op = delta[i]!;
    const step = applyOp(cursor, op);
    if (!step.ok) {
      return { ...step, at: i };
    }
    cursor = step.data;
  }

  return { ok: true, data: cursor as T };
}

function applyOp(root: ReplayValue, op: ProfileOp): ProfileApplyResult {
  if (op.path.length === 0) {
    if (op.op === "set") {
      return { ok: true, data: cloneJsonValue(op.value) as ReplayValue };
    }
    return { ok: false, error: "empty_path", reason: `${op.op} requires a path` };
  }

  let parent: ReplayValue = root;
  for (let i = 0; i < op.path.length - 1; i++) {
    const seg = op.path[i]!;
    if (!isContainer(parent)) {
      return { ok: false, error: "invalid_container", reason: `segment ${i} is not an object or array` };
    }
    const value = getChild(parent, seg);
    if (value === undefined) {
      return { ok: false, error: "missing_path", reason: `segment ${i} (${String(seg)}) missing` };
    }
    parent = value;
  }

  if (!isContainer(parent)) {
    return { ok: false, error: "invalid_container", reason: "final container is not an object or array" };
  }

  const finalSeg = op.path[op.path.length - 1]!;

  switch (op.op) {
    case "set": {
      setChild(parent, finalSeg, cloneJsonValue(op.value) as ReplayValue);
      return { ok: true, data: root };
    }
    case "inc": {
      const current = getChild(parent, finalSeg);
      if (current !== undefined && typeof current !== "number") {
        return { ok: false, error: "type_mismatch", reason: "inc target is not a number" };
      }
      setChild(parent, finalSeg, (typeof current === "number" ? current : 0) + op.value);
      return { ok: true, data: root };
    }
    case "push": {
      const current = getChild(parent, finalSeg);
      if (!Array.isArray(current)) {
        return { ok: false, error: "type_mismatch", reason: "push target is not an array" };
      }
      (current as ReplayValue[]).push(cloneJsonValue(op.value) as ReplayValue);
      return { ok: true, data: root };
    }
    case "remove": {
      if (Array.isArray(parent)) {
        const idx = typeof finalSeg === "number" ? finalSeg : Number(finalSeg);
        if (!Number.isInteger(idx) || idx < 0 || idx >= parent.length) {
          return { ok: false, error: "out_of_range", reason: `index ${String(finalSeg)} out of range` };
        }
        (parent as ReplayValue[]).splice(idx, 1);
      } else {
        const key = typeof finalSeg === "string" ? finalSeg : String(finalSeg);
        if (!Object.prototype.hasOwnProperty.call(parent, key)) {
          return { ok: false, error: "missing_path", reason: `key ${key} not present` };
        }
        delete (parent as Record<string, ReplayValue>)[key];
      }
      return { ok: true, data: root };
    }
  }
}

function isContainer(value: ReplayValue): value is Record<string, ReplayValue> | readonly ReplayValue[] {
  return typeof value === "object" && value !== null;
}

function getChild(container: ReplayValue, seg: ProfilePathSegment): ReplayValue | undefined {
  if (Array.isArray(container)) {
    const idx = typeof seg === "number" ? seg : Number(seg);
    if (!Number.isInteger(idx) || idx < 0 || idx >= container.length) return undefined;
    return container[idx];
  }
  if (typeof container !== "object" || container === null) return undefined;
  const key = typeof seg === "string" ? seg : String(seg);
  if (!Object.prototype.hasOwnProperty.call(container, key)) return undefined;
  return (container as Record<string, ReplayValue>)[key];
}

function setChild(container: ReplayValue, seg: ProfilePathSegment, value: ReplayValue): void {
  if (Array.isArray(container)) {
    const idx = typeof seg === "number" ? seg : Number(seg);
    (container as ReplayValue[])[idx] = value;
    return;
  }
  const key = typeof seg === "string" ? seg : String(seg);
  (container as Record<string, ReplayValue>)[key] = value;
}

/** Type guard + shape check. Rejects unknown ops, bad paths, or missing values. */
export function validateProfileDelta(delta: unknown): delta is ProfileDelta {
  if (!Array.isArray(delta)) return false;
  for (const op of delta) {
    if (typeof op !== "object" || op === null) return false;
    const record = op as Record<string, unknown>;
    if (typeof record.op !== "string") return false;
    if (!Array.isArray(record.path)) return false;
    for (const seg of record.path) {
      if (typeof seg !== "string" && typeof seg !== "number") return false;
    }
    switch (record.op) {
      case "set":
      case "push":
        if (!("value" in record)) return false;
        break;
      case "inc":
        if (typeof record.value !== "number") return false;
        break;
      case "remove":
        break;
      default:
        return false;
    }
  }
  return true;
}

/** Restrict a commit delta map to keys that are seated in the match. Unknown keys are dropped. */
export function restrictDeltaMapToPlayers<TPlayers extends PlayerList>(
  match: MatchInput<TPlayers>,
  map: ProfileCommitDeltaMap<TPlayers>,
): ProfileCommitDeltaMap<TPlayers> {
  const seated = new Set<string>(match.players as readonly string[]);
  const out: Record<string, ProfileDelta> = {};
  for (const [playerID, delta] of Object.entries(map) as [string, ProfileDelta | undefined][]) {
    if (!seated.has(playerID) || delta === undefined) continue;
    out[playerID] = delta;
  }
  return out as ProfileCommitDeltaMap<TPlayers>;
}

/**
 * Invoke a game's declared `profile.commit` and return the per-player delta map.
 * Pure; does not mutate anything. Returns an empty map if the game has no commit.
 *
 * The profile parameter accepts any matching config shape regardless of its
 * declared `TPlayers`; the narrow `TPlayers` comes from `context.match`. This
 * lets call sites pass a profile declared with widened `TPlayers` (e.g. the
 * default `PlayerList`) without `as never` casts.
 */
export function computeProfileCommit<
  TPlayers extends PlayerList,
  TResult,
  TProfile extends ReplayValue = ReplayValue,
>(
  profile:
    | {
        commit?: (
          context: GameProfileCommitContext<any, TResult, TProfile>,
        ) => ProfileCommitDeltaMap<any>;
      }
    | undefined,
  context: GameProfileCommitContext<TPlayers, TResult, TProfile>,
): ProfileCommitDeltaMap<TPlayers> {
  if (profile?.commit === undefined) return {};
  const raw = profile.commit(context);
  return restrictDeltaMapToPlayers(context.match, raw as ProfileCommitDeltaMap<TPlayers>);
}

export type GameProfileCommitFor<TMachine> = TMachine extends {
  profile?: infer TConfig;
}
  ? TConfig extends GameProfileConfig<infer TProfile, infer TPlayers, infer TResult>
    ? GameProfileCommitContext<TPlayers, TResult, TProfile>
    : never
  : never;

export type ProfileOfGame<TMachine> = TMachine extends {
  profile?: GameProfileConfig<infer TProfile, any, any>;
}
  ? TProfile
  : ReplayValue;

/** Helper for tests and hydration: sanity-check a profile value. */
export function parseProfileData<T extends ReplayValue>(
  profile: GameProfileConfig<T, any, any> | undefined,
  data: unknown,
): T {
  if (profile?.parse !== undefined) {
    return profile.parse(data);
  }
  return data as T;
}

export interface ApplyProfileCommitInput<
  TPlayers extends PlayerList,
  TProfile extends ReplayValue,
  TResult,
> {
  match: MatchInput<TPlayers>;
  profile: GameProfileConfig<TProfile, TPlayers, TResult> | undefined;
  /** Profiles as stored by the host, keyed by playerID. Missing players get `profile.default`. */
  profilesBefore: Partial<PlayerRecord<TPlayers, TProfile>>;
  result: TResult;
}

export interface ProfileApplyRejectionDetail {
  error: ProfileApplyError;
  playerID: string;
  reason?: string;
}

export interface ApplyProfileCommitOutput<
  TPlayers extends PlayerList,
  TProfile extends ReplayValue,
> {
  commitDelta: ProfileCommitDeltaMap<TPlayers>;
  profilesAfter: PlayerRecord<TPlayers, TProfile>;
  rejections: readonly ProfileApplyRejectionDetail[];
}

/**
 * End-to-end commit helper: hydrate defaults, invoke `profile.commit`, apply
 * each per-player delta. Returns the new profile map and any per-player apply
 * rejections. Pure — mutates nothing. Replaces hand-rolled settle helpers.
 *
 * Profile rejections are surfaced (not silently dropped). Callers that want to
 * treat the match as un-settleable on rejection can check
 * `rejections.length > 0`.
 */
export function applyProfileCommit<
  TPlayers extends PlayerList,
  TProfile extends ReplayValue,
  TResult,
>(
  input: ApplyProfileCommitInput<TPlayers, TProfile, TResult>,
): ApplyProfileCommitOutput<TPlayers, TProfile> {
  const players = input.match.players as readonly string[];
  const defaultProfile = input.profile?.default;
  const hydrated: Record<string, TProfile> = {};
  for (const playerID of players) {
    const stored = (input.profilesBefore as Record<string, TProfile | undefined>)[playerID];
    hydrated[playerID] = stored === undefined
      ? (cloneJsonValue(defaultProfile as ReplayValue) as TProfile)
      : (cloneJsonValue(stored as ReplayValue) as TProfile);
  }
  const commitDelta = computeProfileCommit(input.profile, {
    match: input.match,
    profile: createProfileMutation<TPlayers, TProfile>(
      hydrated as PlayerRecord<TPlayers, TProfile>,
    ),
    profiles: hydrated as PlayerRecord<TPlayers, TProfile>,
    result: input.result,
  });
  const profilesAfter: Record<string, TProfile> = { ...hydrated };
  const rejections: ProfileApplyRejectionDetail[] = [];
  for (const [playerID, ops] of Object.entries(commitDelta) as [string, ProfileDelta | undefined][]) {
    if (ops === undefined) continue;
    const base = hydrated[playerID];
    if (base === undefined) continue;
    const applied = applyProfileDelta(base as ReplayValue, ops);
    if (applied.ok) {
      profilesAfter[playerID] = applied.data as TProfile;
    } else {
      rejections.push({
        error: applied.error,
        playerID,
        ...(applied.reason === undefined ? {} : { reason: applied.reason }),
      });
    }
  }
  return {
    commitDelta,
    profilesAfter: profilesAfter as PlayerRecord<TPlayers, TProfile>,
    rejections,
  };
}

export type { GameResultState };
