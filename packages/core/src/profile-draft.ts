import { cloneJsonValue } from "@openturn/json";

import type {
  ProfileCommitDeltaMap,
  ProfileDelta,
  ProfileOp,
  ProfilePath,
  ReplayValue,
} from "./types";

/**
 * Immer-style authoring surface for profile deltas. The recipe receives a
 * proxy-backed draft of the player's current profile; mutations through the
 * draft are recorded as ops and returned as a `ProfileDelta`. The op grammar
 * (`set`, `inc`, `push`, `remove`) is unchanged — the draft is sugar.
 *
 * Op detection rules:
 * - Assignment (`p.x = v`, `p.x += n`) emits `set`. `+=` desugars before the
 *   Proxy observes it, so counter semantics are lost. For monotonic counters
 *   that must compose under concurrent commits, use `p.$inc(key, n)`.
 * - `delete p.x` or `p.$remove(key)` emits `remove`.
 * - Array: `push` emits `push`, `pop`/`shift`/`splice(i,n)` emit `remove`(s),
 *   index assignment `arr[i] = v` emits `set`. Whole-array reassign
 *   (`p.items = [...]`) emits a single `set` with the rebuilt array.
 * - `sort`/`reverse`/`unshift`/`fill`/`copyWithin`/middle-insert `splice`
 *   throw — rebuild the array and assign it back instead.
 */

// ---------- Typed draft surface ----------

type DraftPrimitive = string | number | boolean | null;

type NumericKeys<T> = {
  [K in keyof T]: T[K] extends number ? K : never;
}[keyof T];

type ElementOf<TArray> = TArray extends readonly (infer U)[] ? U : never;

export interface DraftArray<T extends readonly ReplayValue[]> {
  readonly length: number;
  [index: number]: Draft<ElementOf<T>>;
  push(...items: ElementOf<T>[]): number;
  pop(): void;
  shift(): void;
  splice(start: number, deleteCount?: number): void;
  includes(value: ElementOf<T>): boolean;
  indexOf(value: ElementOf<T>): number;
  find<U extends ElementOf<T>>(
    predicate: (value: ElementOf<T>, index: number) => value is U,
  ): U | undefined;
  find(predicate: (value: ElementOf<T>, index: number) => boolean): ElementOf<T> | undefined;
  filter(predicate: (value: ElementOf<T>, index: number) => boolean): ElementOf<T>[];
  map<R>(mapper: (value: ElementOf<T>, index: number) => R): R[];
  forEach(callback: (value: ElementOf<T>, index: number) => void): void;
  some(predicate: (value: ElementOf<T>, index: number) => boolean): boolean;
  every(predicate: (value: ElementOf<T>, index: number) => boolean): boolean;
  slice(start?: number, end?: number): ElementOf<T>[];
  [Symbol.iterator](): IterableIterator<ElementOf<T>>;
  /** Remove the element at `index`. Emits a single `remove` op. */
  $remove(index: number): void;
}

export type DraftObject<T> =
  { -readonly [K in keyof T]: Draft<T[K]> }
  & {
    /**
     * Emit an `inc` op against a numeric field. Unlike `p.x += n` (which the
     * Proxy can only observe as an assignment), `inc` is retry-correct under
     * concurrent commits.
     */
    $inc<K extends NumericKeys<T>>(key: K, delta: number): void;
    /** Emit a `remove` op for the given key. Same as `delete p[key]`. */
    $remove<K extends keyof T>(key: K): void;
  };

export type Draft<T> =
  T extends DraftPrimitive ? T
    : T extends readonly ReplayValue[] ? DraftArray<T>
      : T extends object ? DraftObject<T>
        : T;

export interface ProfileMutation<
  TPlayers extends readonly string[] = readonly string[],
  TProfile extends ReplayValue = ReplayValue,
> {
  /** Emit an `inc` op against one numeric field on one player's profile. */
  inc<K extends NumericKeys<TProfile>>(
    playerID: TPlayers[number],
    key: K,
    delta: number,
  ): Partial<Record<TPlayers[number], ProfileDelta>>;
  /** Emit a `push` op against one array field on one player's profile. */
  push<K extends keyof TProfile>(
    playerID: TPlayers[number],
    key: K,
    value: TProfile[K] extends readonly ReplayValue[] ? ElementOf<TProfile[K]> : never,
  ): Partial<Record<TPlayers[number], ProfileDelta>>;
  /** Emit a `remove` op against one field on one player's profile. */
  remove<K extends keyof TProfile>(
    playerID: TPlayers[number],
    key: K,
  ): Partial<Record<TPlayers[number], ProfileDelta>>;
  /** Emit a `set` op against one field on one player's profile. */
  set<K extends keyof TProfile>(
    playerID: TPlayers[number],
    key: K,
    value: TProfile[K] extends ReplayValue ? TProfile[K] : never,
  ): Partial<Record<TPlayers[number], ProfileDelta>>;
  /**
   * Record a mutation for one seated player's game-scoped profile.
   *
   * The helper is bound to the hydrated profile map for the current match, so
   * authors only choose the target player and mutate that player's profile
   * draft. It returns a per-player delta map ready for `profile.commit` or a
   * move outcome's `profile` option.
   */
  update(
    playerID: TPlayers[number],
    recipe: (draft: Draft<TProfile>) => void,
  ): Partial<Record<TPlayers[number], ProfileDelta>>;
}

// ---------- Recorder ----------

interface Recorder {
  ops: ProfileOp[];
  /** The working copy. Mutated in-place so subsequent reads see prior writes. */
  root: ReplayValue;
  disposed: boolean;
}

const UNSUPPORTED_ARRAY_METHODS: Record<string, string> = {
  sort: "sort() not supported in profile draft; rebuild and assign the whole array",
  reverse: "reverse() not supported in profile draft; rebuild and assign the whole array",
  unshift: "unshift() not supported in profile draft; rebuild and assign the whole array",
  fill: "fill() not supported in profile draft; rebuild and assign the whole array",
  copyWithin: "copyWithin() not supported in profile draft; rebuild and assign the whole array",
};

function assertLive(rec: Recorder): void {
  if (rec.disposed) {
    throw new Error("profile draft used after recipe returned");
  }
}

function wrap(rec: Recorder, target: ReplayValue, path: ProfilePath): unknown {
  if (Array.isArray(target)) {
    return wrapArray(rec, target as ReplayValue[], path);
  }
  if (typeof target === "object" && target !== null) {
    return wrapObject(rec, target as Record<string, ReplayValue>, path);
  }
  // Primitives are never wrapped — the caller is expected to check.
  return target;
}

function wrapObject(
  rec: Recorder,
  target: Record<string, ReplayValue>,
  path: ProfilePath,
): Record<string | symbol, unknown> {
  return new Proxy(target as Record<string | symbol, unknown>, {
    get(_t, key) {
      assertLive(rec);
      if (key === "$inc") {
        return (childKey: string, delta: number): void => {
          assertLive(rec);
          const current = target[childKey];
          const next = (typeof current === "number" ? current : 0) + delta;
          rec.ops.push({ op: "inc", path: [...path, childKey], value: delta });
          target[childKey] = next;
        };
      }
      if (key === "$remove") {
        return (childKey: string): void => {
          assertLive(rec);
          rec.ops.push({ op: "remove", path: [...path, childKey] });
          delete target[childKey];
        };
      }
      if (typeof key === "symbol") {
        return (target as Record<string | symbol, unknown>)[key];
      }
      const value = target[key];
      if (value !== null && typeof value === "object") {
        return wrap(rec, value, [...path, key]);
      }
      return value;
    },
    set(_t, key, value) {
      assertLive(rec);
      if (typeof key === "symbol") {
        (target as Record<string | symbol, unknown>)[key] = value;
        return true;
      }
      const cloned = cloneJsonValue(value as ReplayValue) as ReplayValue;
      rec.ops.push({ op: "set", path: [...path, key], value: cloned });
      target[key] = cloned;
      return true;
    },
    deleteProperty(_t, key) {
      assertLive(rec);
      if (typeof key === "symbol") {
        delete (target as Record<string | symbol, unknown>)[key];
        return true;
      }
      rec.ops.push({ op: "remove", path: [...path, key] });
      delete target[key];
      return true;
    },
    has(_t, key) {
      return typeof key === "symbol" || key in target;
    },
    ownKeys() {
      return Reflect.ownKeys(target);
    },
    getOwnPropertyDescriptor(_t, key) {
      return Object.getOwnPropertyDescriptor(target, key);
    },
  });
}

function wrapArray(rec: Recorder, target: ReplayValue[], path: ProfilePath): unknown {
  const mutating: Record<string, (...args: unknown[]) => unknown> = {
    push(...items: unknown[]) {
      assertLive(rec);
      for (const item of items) {
        const cloned = cloneJsonValue(item as ReplayValue) as ReplayValue;
        rec.ops.push({ op: "push", path, value: cloned });
        target.push(cloned);
      }
      return target.length;
    },
    pop() {
      assertLive(rec);
      if (target.length === 0) return undefined;
      const idx = target.length - 1;
      rec.ops.push({ op: "remove", path: [...path, idx] });
      return target.pop();
    },
    shift() {
      assertLive(rec);
      if (target.length === 0) return undefined;
      rec.ops.push({ op: "remove", path: [...path, 0] });
      return target.shift();
    },
    splice(...args: unknown[]) {
      assertLive(rec);
      const start = args[0] as number;
      const deleteCount = args[1] as number | undefined;
      const insert = args.slice(2);
      if (insert.length > 0) {
        throw new Error(
          "splice() with inserts not supported in profile draft; rebuild and assign the whole array",
        );
      }
      const len = target.length;
      const normalized = start < 0 ? Math.max(0, len + start) : Math.min(start, len);
      const count = deleteCount === undefined
        ? len - normalized
        : Math.max(0, Math.min(deleteCount, len - normalized));
      for (let i = 0; i < count; i++) {
        rec.ops.push({ op: "remove", path: [...path, normalized] });
      }
      return target.splice(start, count);
    },
  };

  for (const [name, reason] of Object.entries(UNSUPPORTED_ARRAY_METHODS)) {
    mutating[name] = () => {
      throw new Error(reason);
    };
  }

  return new Proxy(target as unknown as Record<string | symbol, unknown>, {
    get(_t, key) {
      assertLive(rec);
      if (key === "$remove") {
        return (index: number): void => {
          assertLive(rec);
          if (!Number.isInteger(index) || index < 0 || index >= target.length) {
            throw new Error(`profile draft: $remove(${String(index)}) out of range`);
          }
          rec.ops.push({ op: "remove", path: [...path, index] });
          target.splice(index, 1);
        };
      }
      if (typeof key === "string" && key in mutating) {
        return mutating[key];
      }
      if (typeof key === "string" && /^\d+$/.test(key)) {
        const idx = Number(key);
        const value = target[idx];
        if (value !== null && typeof value === "object") {
          return wrap(rec, value, [...path, idx]);
        }
        return value;
      }
      if (key === "length") return target.length;
      if (typeof key === "symbol") {
        const value = (target as unknown as Record<symbol, unknown>)[key];
        if (typeof value === "function") {
          return (value as Function).bind(target);
        }
        return value;
      }
      const value = (target as unknown as Record<string, unknown>)[key];
      if (typeof value === "function") {
        return (value as Function).bind(target);
      }
      return value;
    },
    set(_t, key, value) {
      assertLive(rec);
      if (typeof key === "string" && /^\d+$/.test(key)) {
        const idx = Number(key);
        const cloned = cloneJsonValue(value as ReplayValue) as ReplayValue;
        rec.ops.push({ op: "set", path: [...path, idx], value: cloned });
        target[idx] = cloned;
        return true;
      }
      if (key === "length") {
        target.length = value as number;
        return true;
      }
      (target as unknown as Record<string | symbol, unknown>)[key] = value;
      return true;
    },
    has(_t, key) {
      if (typeof key === "symbol") return Reflect.has(target, key);
      if (typeof key === "string" && /^\d+$/.test(key)) return Number(key) < target.length;
      return key in mutating || key === "length" || Reflect.has(target, key);
    },
  });
}

function createRecorder(initial: ReplayValue): { draft: unknown; recorder: Recorder } {
  const recorder: Recorder = {
    ops: [],
    root: cloneJsonValue(initial) as ReplayValue,
    disposed: false,
  };
  if (recorder.root === null || (typeof recorder.root !== "object")) {
    // Non-container profile (rare). We still need a proxy surface; wrap a
    // synthetic single-key container and reconstitute on each mutation. To
    // keep the implementation simple, reject — authors should use a container.
    throw new Error("profile draft requires an object or array at the root");
  }
  const draft = wrap(recorder, recorder.root, []);
  return { draft, recorder };
}

// ---------- Public API ----------

/**
 * Record a single player's profile mutation as a `ProfileDelta`.
 *
 * ```ts
 * const ops = profile.draft(current, p => {
 *   p.wins += 1;             // set
 *   p.seen.push("dragon");   // push
 *   p.$inc("score", 5);      // inc (retry-safe counter)
 * });
 * ```
 *
 * Throws if the recipe uses an unsupported mutation (sort, unshift, splice
 * with inserts, etc.). Pure in `current` — returns a new delta, does not
 * mutate.
 */
export function draftProfile<T extends ReplayValue>(
  current: T,
  recipe: (draft: Draft<T>) => void,
): ProfileDelta {
  const { draft, recorder } = createRecorder(current);
  try {
    recipe(draft as Draft<T>);
    return [...recorder.ops];
  } finally {
    recorder.disposed = true;
  }
}

/**
 * Produce a single-player `ProfileCommitDeltaMap` entry for use inside
 * `profile.commit` or a move's `profile` field. Looks up `profiles[playerID]`
 * as the baseline. Returns an empty map if the recipe records no ops.
 *
 * Typed in terms of `Record<string, TProfile>` (rather than `PlayerRecord`)
 * so TS reliably infers `TProfile` from the passed map — matching through a
 * mapped tuple type is too brittle in practice.
 */
export function updateProfile<TProfile extends ReplayValue>(
  profiles: Readonly<Record<string, TProfile>>,
  playerID: string,
  recipe: (draft: Draft<TProfile>) => void,
): ProfileCommitDeltaMap {
  const current = profiles[playerID];
  if (current === undefined) {
    throw new Error(`profile.update: no profile for playerID "${String(playerID)}"`);
  }
  const ops = draftProfile(current, recipe);
  if (ops.length === 0) {
    return {};
  }
  return { [playerID]: ops };
}

export function createProfileMutation<
  TPlayers extends readonly string[],
  TProfile extends ReplayValue,
>(
  profiles: Readonly<Record<TPlayers[number], TProfile>>,
): ProfileMutation<TPlayers, TProfile> {
  return {
    inc(playerID, key, value) {
      assertProfileExists(profiles, playerID);
      return singlePlayerDelta(playerID, [{ op: "inc", path: [key as ProfilePath[number]], value }]);
    },
    push(playerID, key, value) {
      assertProfileExists(profiles, playerID);
      return singlePlayerDelta(playerID, [{
        op: "push",
        path: [key as ProfilePath[number]],
        value: cloneJsonValue(value as ReplayValue) as ReplayValue,
      }]);
    },
    remove(playerID, key) {
      assertProfileExists(profiles, playerID);
      return singlePlayerDelta(playerID, [{ op: "remove", path: [key as ProfilePath[number]] }]);
    },
    set(playerID, key, value) {
      assertProfileExists(profiles, playerID);
      return singlePlayerDelta(playerID, [{
        op: "set",
        path: [key as ProfilePath[number]],
        value: cloneJsonValue(value as ReplayValue) as ReplayValue,
      }]);
    },
    update(playerID, recipe) {
      return updateProfile(profiles, playerID, recipe) as Partial<Record<TPlayers[number], ProfileDelta>>;
    },
  };
}

function singlePlayerDelta<TPlayerID extends string>(
  playerID: TPlayerID,
  ops: ProfileDelta,
): Partial<Record<TPlayerID, ProfileDelta>> {
  return { [playerID]: ops } as Partial<Record<TPlayerID, ProfileDelta>>;
}

function assertProfileExists<TProfile extends ReplayValue>(
  profiles: Readonly<Record<string, TProfile>>,
  playerID: string,
): void {
  if (profiles[playerID] === undefined) {
    throw new Error(`profile: no profile for playerID "${String(playerID)}"`);
  }
}

