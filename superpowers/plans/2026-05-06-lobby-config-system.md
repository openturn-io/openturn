# Lobby Config System with Managed UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a typed config schema that the lobby exposes as a host-mutable settings form. Values are agreed by all viewers in `lobby:state`, locked into `match.config` at game-start, and validated at three layers (wire / lock-time / engine).

**Architecture:** Game declares `config: { ... }` on `GameDefinition` (peer to `profile?` and `bots?`). `MatchInput` gains a third generic and a `config?` field. `LobbyRuntime` carries mutable `#configValues` initialized from schema defaults; host-only `setConfig` validates against the schema and un-readies all human seats. Cloud DO worker, CLI dev shell, and local-lobby React hook all thread the resolved config into the room runtime at `lobby:start` (mirrors Slice A's `hostPlayerID` plumbing). React lobby gains opt-in `configUI` / `configRenderers` props with built-in default field renderers.

**Tech Stack:** TypeScript (strict generics for schema → values inference), `bun:test` for core/server, `vitest` + `@testing-library/react` for the lobby React layer, Zod for `MatchInputSchema` round-trip, Tailwind for the default renderers.

**Spec:** `superpowers/specs/2026-05-06-lobby-config-system-design.md`

---

## File Map

| File | Role |
|---|---|
| `packages/core/src/types.ts` | Add `ConfigFieldSchema` union + `ConfigSchema` types. Add third generic to `MatchInput`. Add `config?` to both `MatchInput` and `GameDefinition`. Add `ConfigValuesOf<TConfig>` helper type. Thread the third generic through downstream type aliases (`GameSnapshot`, etc.). |
| `packages/core/src/validation.ts` | Extend `normalizeMatchInput` to validate `match.config` against `machine.config` schema and fill missing keys with defaults. Add validation error codes (`unknown_config_key`, `invalid_config_value`, `unexpected_config`). |
| `packages/core/src/index.ts` | Export new public types: `ConfigSchema`, `ConfigFieldSchema`, `NumberFieldSchema`, `BooleanFieldSchema`, `EnumFieldSchema`, `ConfigValuesOf`. |
| `packages/core/src/index.test.ts` | Tests for normalization, defaults, and validation rejections. |
| `packages/protocol/src/lobby.ts` | Add `LobbySetConfig` to `LobbyClientMessage` union. Extend `LobbyStateMessage` with optional `config: { values }`. Extend `LobbyRejectedMessage` with optional `configKey` / `configDetail`. Add `invalid_config_value` to `LobbyRejectionReason`. |
| `packages/server/src/lobby-runtime.ts` | Add optional `configSchema?: ConfigSchema` to `LobbyEnv`. Initialize `#configValues` from schema defaults. Add `setConfig(hostUserID, key, value): LobbyApplyResult`. Persist `config.values` in `LobbyPersistedState`. Include `config: { values }` in `LobbyStartResult.ok=true`. Include `config` in `buildStateMessage()` output. Wire `setConfig` into `applyClientMessage` switch. Un-ready all human seats on successful `setConfig`. |
| `packages/server/src/lobby-runtime.test.ts` | Tests for setConfig (rejections, success, un-ready), persistence round-trip, start() includes config. |
| `packages/server/src/index.ts` | Extend zod `MatchInputSchema` with `config: z.record(z.string(), z.unknown()).optional()`. |
| `packages/server/src/worker.ts` | Add `config: Record<string, JsonValue>` to `InitMeta`. Persist `startResult.config.values` in `handleStart`. Apply `meta.config` to match override in `getOrCreateRuntime`. Pass `configSchema` from deployment into `LobbyRuntime` env at lobby construction. |
| `packages/replay/src/index.ts` | Extend `parseMatchInput` to round-trip `config` (object validation only — schema-aware checks happen in core's `normalizeMatchInput`). |
| `packages/replay/src/index.test.ts` | Round-trip tests. |
| `packages/cli/src/index.ts` | At `lobby:start` (the recreation block landed in Slice A), include `startResult.config.values` in the override match. Pass `configSchema` from current deployment into the lobby's `LobbyEnv`. |
| `packages/lobby/src/react/use-local-lobby.ts` | Pass `config` from `LobbyStartResult` through `onTransitionToGame` callback shape. |
| `packages/lobby/src/react/config-form.tsx` (NEW) | `<ConfigForm>` component that auto-renders form from schema + values. Default renderers: `<NumberInput>`, `<BooleanToggle>`, `<EnumPicker>`. Field renderer prop contract. |
| `packages/lobby/src/react/config-form.test.tsx` (NEW) | Tests for default renderers, custom renderer overrides, disabled state. |
| `packages/lobby/src/react/lobby.tsx`, `lobby-with-bots.tsx` | Add `configUI: "auto" \| "manual" \| "none"` (default `"none"`) and `configRenderers` props. When `auto`, render `<ConfigForm>` above seat list in collapsible section. |
| `packages/lobby/src/react/index.ts` | Export `ConfigForm` and renderer types. |

---

## Task 1: Core types — schema and field declarations

**Files:**
- Modify: `packages/core/src/types.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Add schema types to `types.ts`**

In `packages/core/src/types.ts`, near the top of the file (after the existing imports and before `MatchInput`), add:

```ts
// ---- Config schema (match-shape settings agreed in the lobby) ----

export interface NumberFieldSchema {
  type: "number";
  default: number;
  min?: number;
  max?: number;
  /** UI hint only; not validated server-side. */
  step?: number;
  label: string;
  description?: string;
}

export interface BooleanFieldSchema {
  type: "boolean";
  default: boolean;
  label: string;
  description?: string;
}

export interface EnumFieldSchema<TOption extends string = string> {
  type: "enum";
  options: readonly [TOption, ...TOption[]];
  default: TOption;
  /** Per-option display labels. Keys default to the option string when omitted. */
  labels?: Partial<Record<TOption, string>>;
  label: string;
  description?: string;
}

export type ConfigFieldSchema =
  | NumberFieldSchema
  | BooleanFieldSchema
  | EnumFieldSchema;

export type ConfigSchema = Record<string, ConfigFieldSchema>;

/**
 * Inferred values shape from a config schema. Each field's value type is
 * derived from its declared `type` discriminator.
 */
export type ConfigValuesOf<TConfig extends ConfigSchema | undefined> =
  TConfig extends ConfigSchema
    ? {
        [K in keyof TConfig]:
          TConfig[K] extends NumberFieldSchema ? number :
          TConfig[K] extends BooleanFieldSchema ? boolean :
          TConfig[K] extends EnumFieldSchema<infer TOption> ? TOption :
          never;
      }
    : Record<string, ReplayValue>;
```

- [ ] **Step 2: Export from index.ts**

In `packages/core/src/index.ts`, find the `from "./types"` export block and add the new types:

```ts
export {
  // ...existing exports...
  type ConfigFieldSchema,
  type ConfigSchema,
  type ConfigValuesOf,
  type NumberFieldSchema,
  type BooleanFieldSchema,
  type EnumFieldSchema,
  // ...rest of existing exports...
} from "./types";
```

(Place the new entries alphabetically among existing type exports — the file already groups types by source module.)

- [ ] **Step 3: Typecheck**

Run: `bun run --filter @openturn/core typecheck`

Expected: PASS. Pure type-additive change.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/types.ts packages/core/src/index.ts
git commit -m "core: add ConfigSchema and field-declaration types"
```

---

## Task 2: Core types — MatchInput.config + GameDefinition.config + inference

**Files:**
- Modify: `packages/core/src/types.ts`

- [ ] **Step 1: Add third generic to `MatchInput`**

In `packages/core/src/types.ts`, find the `MatchInput` interface (around line 91) and update its signature and body:

```ts
export interface MatchInput<
  TPlayers extends PlayerList = PlayerList,
  TMatchData = ReplayValue,
  TConfigValues = Record<string, ReplayValue>,
> {
  data?: TMatchData;
  /** Seated players for this match, a non-empty subset of the game's `playerIDs`. */
  players: readonly [TPlayers[number], ...TPlayers[number][]];
  /**
   * Per-player persistent profile state hydrated by the host before setup.
   * Scoped by (userID, gameKey). Populated server-side in cloud mode; supplied
   * by the embedding app in local mode. Undefined if the game declares no profile.
   * Keys are the seated subset; absent entries use the game's profile default.
   */
  profiles?: Partial<Readonly<PlayerRecord<TPlayers, ReplayValue>>>;
  /**
   * The seated player who acted as host of the lobby that started this match.
   * `null` for single-player matches, when the lobby host was spectating, or
   * when no host was present at start. Locked at game-start and replayed
   * verbatim. Game logic accesses via `ctx.match.hostPlayerID`.
   */
  hostPlayerID?: TPlayers[number] | null;
  /**
   * Match-shape settings agreed in the lobby and locked at game-start. Game
   * code reads via `ctx.match.config` and may use or override per-state.
   * Shape is inferred from the game's `config` schema declaration.
   */
  config?: TConfigValues;
}
```

- [ ] **Step 2: Add `config?` to `GameDefinition`**

Find the `GameDefinition` interface (around line 409) and add `config?` to the field list (near `profile?`):

```ts
export interface GameDefinition<
  TState,
  TEvents extends GameEventMap = GameEventMap,
  TResult = ReplayValue | null,
  TPlayers extends PlayerList = PlayerList,
  TNode extends string = string,
  TPublic = TState,
  TPlayer = TPublic,
  TControl extends ReplayValue = ReplayValue,
  TTransitions extends readonly GameTransitionConfig<TState, TEvents, TResult, TNode, TPlayers, TControl>[] =
    readonly GameTransitionConfig<TState, TEvents, TResult, TNode, TPlayers, TControl>[],
  TConfig extends ConfigSchema | undefined = ConfigSchema | undefined,
> {
  // ...existing fields...
  /**
   * Optional declarative config schema. Lobby renders a host-mutable settings
   * form from this; values are locked into `match.config` at game-start. See
   * `superpowers/specs/2026-05-06-lobby-config-system-design.md`.
   */
  config?: TConfig;
  // ...other existing fields...
}
```

- [ ] **Step 3: Update `AnyGame` and config helper aliases**

Find `AnyGame` (around line 473) and add the new generic slot:

```ts
export type AnyGame = GameDefinition<any, any, any, any, any, any, any, any, any, any>;
```

(One additional `any` for the new `TConfig` parameter.)

Add a helper type for extracting config from a game:

```ts
export type GameConfigSchemaOf<TMachine extends AnyGame> =
  TMachine extends GameDefinition<any, any, any, any, any, any, any, any, any, infer TConfig> ? TConfig : undefined;

export type GameConfigValuesOf<TMachine extends AnyGame> = ConfigValuesOf<GameConfigSchemaOf<TMachine>>;
```

- [ ] **Step 4: Export the new helper types**

In `packages/core/src/index.ts`, add to the `from "./types"` export:

```ts
export {
  // ...existing exports...
  type GameConfigSchemaOf,
  type GameConfigValuesOf,
  // ...rest...
} from "./types";
```

- [ ] **Step 5: Typecheck**

Run: `bun run --filter @openturn/core typecheck`

Expected: PASS. Adding a defaulted generic parameter is back-compat for callers that don't specify it.

If typecheck fails because downstream files reference `MatchInput<TPlayers, TMatchData>` with the old 2-generic shape and produce a "missing third type argument" error: those callsites should keep working via the default. Investigate the actual error messages before changing anything else.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/types.ts packages/core/src/index.ts
git commit -m "core: add MatchInput.config and GameDefinition.config with inference"
```

---

## Task 3: Core validation — normalizeMatchInput config support

**Files:**
- Modify: `packages/core/src/validation.ts`
- Modify: `packages/core/src/session.ts` (for callsites that pass machine to normalizeMatchInput)
- Test: `packages/core/src/index.test.ts`

- [ ] **Step 1: Write failing tests**

Append inside `describe("@openturn/core")` in `packages/core/src/index.test.ts`:

```ts
test("normalizeMatchInput rejects match.config when game declares no schema", () => {
  expect(() => {
    createLocalSession(
      defineGame({
        playerIDs: ["0", "1"],
        events: { noop: undefined },
        initial: "play",
        setup: () => ({}),
        states: { play: { activePlayers: () => ["0"] } },
        transitions: [],
      }),
      {
        match: {
          players: ["0", "1"] as const,
          config: { foo: 1 },
        },
      },
    );
  }).toThrow(InvalidGameDefinitionError);
});

test("normalizeMatchInput fills missing config keys with schema defaults", () => {
  const session = createLocalSession(
    defineGame({
      playerIDs: ["0", "1"],
      events: { noop: undefined },
      initial: "play",
      setup: () => ({}),
      states: { play: { activePlayers: () => ["0"] } },
      transitions: [],
      config: {
        turnTimeoutMs: { type: "number", default: 30_000, label: "Turn time" },
        variant: {
          type: "enum",
          options: ["a", "b"] as const,
          default: "a",
          label: "Variant",
        },
      },
    }),
    { match: { players: ["0", "1"] as const } },
  );
  expect(session.getState().meta.match.config).toEqual({
    turnTimeoutMs: 30_000,
    variant: "a",
  });
});

test("normalizeMatchInput rejects out-of-bounds number", () => {
  expect(() => {
    createLocalSession(
      defineGame({
        playerIDs: ["0", "1"],
        events: { noop: undefined },
        initial: "play",
        setup: () => ({}),
        states: { play: { activePlayers: () => ["0"] } },
        transitions: [],
        config: {
          n: { type: "number", default: 5, min: 0, max: 10, label: "N" },
        },
      }),
      { match: { players: ["0", "1"] as const, config: { n: 999 } } },
    );
  }).toThrow(InvalidGameDefinitionError);
});

test("normalizeMatchInput rejects unknown enum value", () => {
  expect(() => {
    createLocalSession(
      defineGame({
        playerIDs: ["0", "1"],
        events: { noop: undefined },
        initial: "play",
        setup: () => ({}),
        states: { play: { activePlayers: () => ["0"] } },
        transitions: [],
        config: {
          v: { type: "enum", options: ["a", "b"] as const, default: "a", label: "V" },
        },
      }),
      { match: { players: ["0", "1"] as const, config: { v: "c" as never } } },
    );
  }).toThrow(InvalidGameDefinitionError);
});

test("normalizeMatchInput rejects unknown config key", () => {
  expect(() => {
    createLocalSession(
      defineGame({
        playerIDs: ["0", "1"],
        events: { noop: undefined },
        initial: "play",
        setup: () => ({}),
        states: { play: { activePlayers: () => ["0"] } },
        transitions: [],
        config: {
          n: { type: "number", default: 1, label: "N" },
        },
      }),
      { match: { players: ["0", "1"] as const, config: { n: 1, mystery: 42 } } },
    );
  }).toThrow(InvalidGameDefinitionError);
});

test("normalizeMatchInput passes valid config and types flow through", () => {
  const session = createLocalSession(
    defineGame({
      playerIDs: ["0", "1"],
      events: { noop: undefined },
      initial: "play",
      setup: () => ({}),
      states: { play: { activePlayers: () => ["0"] } },
      transitions: [],
      config: {
        b: { type: "boolean", default: false, label: "B" },
      },
    }),
    { match: { players: ["0", "1"] as const, config: { b: true } } },
  );
  expect(session.getState().meta.match.config).toEqual({ b: true });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `bun run --filter @openturn/core test`

Expected: FAIL on the new tests (no validation logic yet — bad inputs pass, missing keys don't get defaults).

- [ ] **Step 3: Update `normalizeMatchInput` signature**

The current `normalizeMatchInput<TMatch extends MatchInput>(match: TMatch): TMatch` doesn't have access to the machine schema. Change its signature to accept the machine.

In `packages/core/src/validation.ts`, replace the existing `normalizeMatchInput` with:

```ts
import type {
  AnyGame,
  ConfigFieldSchema,
  ConfigSchema,
  EnumFieldSchema,
  // ...existing imports...
} from "./types";

export function normalizeMatchInput<TMatch extends MatchInput>(
  machine: AnyGame,
  match: TMatch,
): TMatch {
  const hostPlayerID = match.hostPlayerID ?? null;

  if (hostPlayerID !== null) {
    if (!(match.players as readonly string[]).includes(hostPlayerID as string)) {
      throw new InvalidGameDefinitionError(
        `match.hostPlayerID "${String(hostPlayerID)}" is not in match.players (invalid_host_player)`,
      );
    }
    if (match.players.length === 1) {
      throw new InvalidGameDefinitionError(
        `match.hostPlayerID must be null for single-player matches (single_player_host_set)`,
      );
    }
  }

  const schema = (machine as { config?: ConfigSchema }).config;
  const inputConfig = match.config as Record<string, unknown> | undefined;

  let normalizedConfig: Record<string, unknown> | undefined;

  if (schema === undefined) {
    if (inputConfig !== undefined) {
      throw new InvalidGameDefinitionError(
        `match.config provided but game declares no config schema (unexpected_config)`,
      );
    }
    normalizedConfig = undefined;
  } else {
    const result: Record<string, unknown> = {};
    const inputKeys = inputConfig !== undefined ? Object.keys(inputConfig) : [];
    for (const key of inputKeys) {
      if (!Object.prototype.hasOwnProperty.call(schema, key)) {
        throw new InvalidGameDefinitionError(
          `match.config has unknown key "${key}" not in schema (unknown_config_key)`,
        );
      }
    }
    for (const [key, field] of Object.entries(schema)) {
      const provided = inputConfig?.[key];
      const value = provided === undefined ? field.default : provided;
      validateConfigValue(key, field, value);
      result[key] = value;
    }
    normalizedConfig = result;
  }

  const normalizedHost = match.hostPlayerID === hostPlayerID;
  const sameConfig = match.config === normalizedConfig;
  if (normalizedHost && sameConfig) return match;
  return { ...match, hostPlayerID, config: normalizedConfig } as TMatch;
}

function validateConfigValue(key: string, field: ConfigFieldSchema, value: unknown): void {
  if (field.type === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new InvalidGameDefinitionError(
        `match.config.${key} must be a finite number (invalid_config_value)`,
      );
    }
    if (field.min !== undefined && value < field.min) {
      throw new InvalidGameDefinitionError(
        `match.config.${key} value ${value} is below min ${field.min} (invalid_config_value)`,
      );
    }
    if (field.max !== undefined && value > field.max) {
      throw new InvalidGameDefinitionError(
        `match.config.${key} value ${value} is above max ${field.max} (invalid_config_value)`,
      );
    }
    return;
  }
  if (field.type === "boolean") {
    if (typeof value !== "boolean") {
      throw new InvalidGameDefinitionError(
        `match.config.${key} must be a boolean (invalid_config_value)`,
      );
    }
    return;
  }
  if (field.type === "enum") {
    const enumField = field as EnumFieldSchema;
    if (typeof value !== "string" || !enumField.options.includes(value)) {
      throw new InvalidGameDefinitionError(
        `match.config.${key} value ${JSON.stringify(value)} is not in options [${enumField.options.join(", ")}] (invalid_config_value)`,
      );
    }
    return;
  }
}
```

Add the new validation codes to the `GameValidationCode` union (alphabetically):

```ts
export type GameValidationCode =
  | "active_players_duplicate"
  // ...existing entries...
  | "invalid_config_value"     // NEW
  | "invalid_deadline"
  // ...rest...
  | "single_player_host_set"
  | "state_derivation_failed"
  // ...
  | "unknown_config_key"        // NEW
  | "unexpected_config"         // NEW
  // ...rest...
```

- [ ] **Step 4: Update `session.ts` callsites**

In `packages/core/src/session.ts`, find the two `normalizeMatchInput` callsites (in `createLocalSession` and `createLocalSessionFromSnapshot`) and pass `machine` as the first argument:

```ts
const match = hydrateMatchProfiles(
  machine,
  normalizeMatchInput(
    machine,  // NEW first arg
    cloneJsonValue(parseJsonValue(options.match, "match")) as unknown as TMatch,
  ),
);
```

- [ ] **Step 5: Run tests + typecheck**

Run: `bun run --filter @openturn/core test && bun run --filter @openturn/core typecheck`

Expected: All new tests PASS. Existing tests PASS. Typecheck PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/validation.ts packages/core/src/session.ts packages/core/src/index.test.ts
git commit -m "core: validate match.config against game schema with default fill"
```

---

## Task 4: Protocol — LobbySetConfig + state and rejection extensions

**Files:**
- Modify: `packages/protocol/src/lobby.ts`

- [ ] **Step 1: Add `LobbySetConfig` and extend the union**

In `packages/protocol/src/lobby.ts`, near the other client-message interfaces (around line 65-110), add:

```ts
/**
 * Host-only: change a single config value during the lobby phase. Server
 * validates against the game's declared schema. Successful sets un-ready all
 * human seats so players must re-confirm before the host can start.
 */
export interface LobbySetConfig {
  type: "host:set_config";
  key: string;
  value: unknown;  // JsonValue at runtime; protocol-layer is permissive
}
```

Extend the `LobbyClientMessage` union (around line 110-118):

```ts
export type LobbyClientMessage =
  | LobbyTakeSeat
  | LobbyLeaveSeat
  | LobbySetReady
  | LobbyStart
  | LobbyClose
  | LobbyAssignBot
  | LobbyClearSeat
  | LobbySetTargetCapacity
  | LobbySetConfig;
```

- [ ] **Step 2: Extend `LobbyStateMessage` with `config` field**

Find `LobbyStateMessage` (around line 120-139) and add an optional `config` field at the end:

```ts
export interface LobbyStateMessage {
  type: "lobby:state";
  // ...existing fields...
  availableBots: readonly LobbyAvailableBot[];
  /**
   * Current host-mutable config values. Present only when the game declares a
   * config schema; absent otherwise. Locked into `match.config` at lobby:start.
   * Schema is part of the deployment manifest the client already loads — only
   * values flow on this wire.
   */
  config?: {
    values: Readonly<Record<string, unknown>>;
  };
}
```

- [ ] **Step 3: Extend `LobbyRejectedMessage` and add `invalid_config_value` reason**

Find `LobbyRejectionReason` (around line 44-61) and add the new reason alphabetically:

```ts
export type LobbyRejectionReason =
  // ...existing reasons...
  | "below_min_players"
  | "no_humans_seated"
  | "bad_phase"
  | "room_closed"
  | "seat_has_bot"
  | "seat_has_human"
  | "unknown_bot"
  | "target_below_min"
  | "target_above_max"
  | "bad_target"
  | "invalid_config_value"   // NEW
  | "unknown";
```

Find `LobbyRejectedMessage` (around line 141-146) and add `configKey` and `configDetail`:

```ts
export interface LobbyRejectedMessage {
  type: "lobby:rejected";
  reason: LobbyRejectionReason;
  echoType?: LobbyClientMessage["type"];
  message?: string;
  /** Present when reason === "invalid_config_value". The field key the client tried to set. */
  configKey?: string;
  /**
   * Present when reason === "invalid_config_value". Human-readable detail —
   * e.g. "below_min: 5000", "expected_number", "not_in_options: foo".
   */
  configDetail?: string;
}
```

- [ ] **Step 4: Typecheck**

Run: `bun run --filter @openturn/protocol typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/protocol/src/lobby.ts
git commit -m "protocol: add LobbySetConfig and config fields on state/rejection"
```

---

## Task 5: Server lobby-runtime — schema, state, persistence, default init

**Files:**
- Modify: `packages/server/src/lobby-runtime.ts`

- [ ] **Step 1: Add `configSchema` to `LobbyEnv`**

In `packages/server/src/lobby-runtime.ts`, find the `LobbyEnv` interface (around line 11-41). Add `configSchema?` after `requireHumanSeat?`:

```ts
import type { ConfigSchema } from "@openturn/core";

export interface LobbyEnv {
  // ...existing fields...
  requireHumanSeat?: boolean;
  /**
   * Optional config schema declared by the game. When present, the lobby
   * initializes `#configValues` with each field's default and accepts
   * `setConfig` mutations. When absent, `setConfig` rejects everything.
   */
  configSchema?: ConfigSchema;
}
```

- [ ] **Step 2: Add `#configValues` field and constructor initialization**

Find the class declaration (around line 104) and add the new private field. Also extend `LobbyPersistedState` (around line 64-70):

```ts
export interface LobbyPersistedState {
  mode: LobbyPhase;
  seats: readonly SeatRecord[];
  userToPlayer: Readonly<Record<string, string>>;
  targetCapacity?: number;
  configValues?: Readonly<Record<string, unknown>>;
}

export class LobbyRuntime {
  readonly env: LobbyEnv;
  // ...existing private fields...
  #configValues: Record<string, unknown>;

  constructor(env: LobbyEnv, persisted?: LobbyPersistedState) {
    this.env = env;
    // ...existing init logic...
    this.#configValues = computeInitialConfigValues(env.configSchema, persisted?.configValues);
  }
  // ...rest...
}

function computeInitialConfigValues(
  schema: ConfigSchema | undefined,
  persisted: Readonly<Record<string, unknown>> | undefined,
): Record<string, unknown> {
  if (schema === undefined) return {};
  const result: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(schema)) {
    const fromPersisted = persisted?.[key];
    if (fromPersisted !== undefined && isValueValidForField(fromPersisted, field)) {
      result[key] = fromPersisted;
    } else {
      result[key] = field.default;
    }
  }
  return result;
}

function isValueValidForField(value: unknown, field: ConfigFieldSchema): boolean {
  if (field.type === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) return false;
    if (field.min !== undefined && value < field.min) return false;
    if (field.max !== undefined && value > field.max) return false;
    return true;
  }
  if (field.type === "boolean") return typeof value === "boolean";
  if (field.type === "enum") return typeof value === "string" && field.options.includes(value);
  return false;
}
```

(Place these helpers at the bottom of the file or near `clampTargetCapacity`. Update the `ConfigFieldSchema` import alongside `ConfigSchema`.)

- [ ] **Step 3: Persist `configValues` in `serialize()` / `toState()`**

Find the existing serialize logic — search for where `LobbyPersistedState` is constructed (likely a method that returns `{ mode, seats, userToPlayer, targetCapacity }`). Add `configValues` to the returned object:

```ts
serialize(): LobbyPersistedState {
  return {
    mode: this.#mode,
    seats: [...this.#seats.values()],
    userToPlayer: Object.fromEntries(this.#userToPlayer),
    targetCapacity: this.#targetCapacity,
    configValues: this.env.configSchema === undefined ? undefined : { ...this.#configValues },
  };
}
```

(Inspect the actual serialize method's exact name and structure first — adjust if needed. The point is: include configValues in persisted state.)

- [ ] **Step 4: Include config in `buildStateMessage()`**

Find `buildStateMessage` (around line 468) and add `config` to the returned object:

```ts
return {
  type: "lobby:state",
  // ...existing fields...
  availableBots: buildAvailableBots(this.env.knownBots),
  ...(this.env.configSchema === undefined
    ? {}
    : { config: { values: { ...this.#configValues } } }),
};
```

(Conditional spread keeps the field absent when no schema is declared.)

- [ ] **Step 5: Typecheck**

Run: `bun run --filter @openturn/server typecheck`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/lobby-runtime.ts
git commit -m "server: add config schema, state init, and persistence to LobbyRuntime"
```

---

## Task 6: Server lobby-runtime — setConfig method + un-ready + start() result

**Files:**
- Modify: `packages/server/src/lobby-runtime.ts`
- Test: `packages/server/src/lobby-runtime.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `packages/server/src/lobby-runtime.test.ts`:

```ts
describe("LobbyRuntime.setConfig()", () => {
  function envWithConfig(overrides: Partial<LobbyEnv> = {}): LobbyEnv {
    return {
      hostUserID: HOST,
      minPlayers: 2,
      maxPlayers: 2,
      playerIDs: ["0", "1"],
      configSchema: {
        turnTimeoutMs: { type: "number", default: 30_000, min: 5_000, max: 300_000, label: "Turn time" },
        variant: { type: "enum", options: ["a", "b"] as const, default: "a", label: "Variant" },
        flag: { type: "boolean", default: false, label: "Flag" },
      },
      ...overrides,
    };
  }

  test("non-host setConfig is rejected", () => {
    const runtime = new LobbyRuntime(envWithConfig());
    expect(runtime.setConfig(ALICE, "turnTimeoutMs", 60_000)).toEqual({
      ok: false,
      reason: "not_host",
    });
  });

  test("setConfig in active phase is rejected", () => {
    const runtime = new LobbyRuntime(envWithConfig());
    runtime.takeSeat(HOST, "Host", 0);
    runtime.takeSeat(BOB, "Bob", 1);
    runtime.setReady(HOST, true);
    runtime.setReady(BOB, true);
    runtime.start(HOST);
    expect(runtime.setConfig(HOST, "turnTimeoutMs", 60_000)).toEqual({
      ok: false,
      reason: "bad_phase",
    });
  });

  test("setConfig with unknown key rejects with invalid_config_value", () => {
    const runtime = new LobbyRuntime(envWithConfig());
    const result = runtime.setConfig(HOST, "mystery", 1);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("invalid_config_value");
    expect(result.configKey).toBe("mystery");
    expect(result.configDetail).toBe("unknown_key");
  });

  test("setConfig with wrong type rejects with invalid_config_value", () => {
    const runtime = new LobbyRuntime(envWithConfig());
    const result = runtime.setConfig(HOST, "turnTimeoutMs", "ten" as unknown as number);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("invalid_config_value");
    expect(result.configKey).toBe("turnTimeoutMs");
    expect(result.configDetail).toBe("expected_number");
  });

  test("setConfig with out-of-bounds number rejects", () => {
    const runtime = new LobbyRuntime(envWithConfig());
    const tooLow = runtime.setConfig(HOST, "turnTimeoutMs", 100);
    expect(tooLow.ok).toBe(false);
    if (tooLow.ok) return;
    expect(tooLow.configDetail).toMatch(/^below_min: /);

    const tooHigh = runtime.setConfig(HOST, "turnTimeoutMs", 999_999);
    expect(tooHigh.ok).toBe(false);
    if (tooHigh.ok) return;
    expect(tooHigh.configDetail).toMatch(/^above_max: /);
  });

  test("setConfig with unknown enum option rejects", () => {
    const runtime = new LobbyRuntime(envWithConfig());
    const result = runtime.setConfig(HOST, "variant", "c");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.configDetail).toMatch(/^not_in_options: /);
  });

  test("setConfig success un-readies all human seats but not bot seats", () => {
    const runtime = new LobbyRuntime(
      envWithConfig({ knownBots: new Map([["random", { label: "Random" }]]) }),
    );
    runtime.takeSeat(HOST, "Host", 0);
    runtime.assignBot(HOST, 1, "random");
    runtime.setReady(HOST, true);

    const before = runtime.buildStateMessage("room", new Set([HOST]));
    const hostSeatBefore = before.seats.find((s) => s.kind === "human");
    expect(hostSeatBefore?.kind === "human" && hostSeatBefore.ready).toBe(true);

    const result = runtime.setConfig(HOST, "turnTimeoutMs", 60_000);
    expect(result).toEqual({ ok: true, changed: true });

    const after = runtime.buildStateMessage("room", new Set([HOST]));
    const hostSeatAfter = after.seats.find((s) => s.kind === "human");
    expect(hostSeatAfter?.kind === "human" && hostSeatAfter.ready).toBe(false);
    const botSeat = after.seats.find((s) => s.kind === "bot");
    expect(botSeat).toBeDefined();  // bot seats unaffected
  });

  test("setConfig with no schema rejects every key", () => {
    const runtime = new LobbyRuntime(env());  // existing env() helper, no schema
    const result = runtime.setConfig(HOST, "anything", 1);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("invalid_config_value");
    expect(result.configDetail).toBe("no_schema");
  });

  test("buildStateMessage includes config.values when schema present", () => {
    const runtime = new LobbyRuntime(envWithConfig());
    const state = runtime.buildStateMessage("room", new Set([HOST]));
    expect(state.config).toEqual({
      values: { turnTimeoutMs: 30_000, variant: "a", flag: false },
    });
  });

  test("buildStateMessage omits config when schema absent", () => {
    const runtime = new LobbyRuntime(env());
    const state = runtime.buildStateMessage("room", new Set([HOST]));
    expect(state.config).toBeUndefined();
  });

  test("setConfig success reflects in subsequent buildStateMessage", () => {
    const runtime = new LobbyRuntime(envWithConfig());
    runtime.setConfig(HOST, "turnTimeoutMs", 60_000);
    const state = runtime.buildStateMessage("room", new Set([HOST]));
    expect(state.config?.values.turnTimeoutMs).toBe(60_000);
  });
});

describe("LobbyRuntime.start() — config in result", () => {
  test("start() returns config.values snapshot", () => {
    const runtime = new LobbyRuntime({
      hostUserID: HOST,
      minPlayers: 2,
      maxPlayers: 2,
      playerIDs: ["0", "1"],
      configSchema: {
        n: { type: "number", default: 5, label: "N" },
      },
    });
    runtime.takeSeat(HOST, "Host", 0);
    runtime.takeSeat(BOB, "Bob", 1);
    runtime.setReady(HOST, true);
    runtime.setReady(BOB, true);
    runtime.setConfig(HOST, "n", 10);
    const result = runtime.start(HOST);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config).toEqual({ values: { n: 10 } });
  });

  test("start() returns null config when no schema", () => {
    const runtime = new LobbyRuntime(env());
    runtime.takeSeat(ALICE, "Alice", 0);
    runtime.takeSeat(BOB, "Bob", 1);
    runtime.setReady(ALICE, true);
    runtime.setReady(BOB, true);
    const result = runtime.start(HOST);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config).toBeNull();
  });
});

describe("LobbyRuntime persistence with config", () => {
  test("config values round-trip through serialize / re-construct", () => {
    const sharedEnv: LobbyEnv = {
      hostUserID: HOST,
      minPlayers: 2,
      maxPlayers: 2,
      playerIDs: ["0", "1"],
      configSchema: {
        n: { type: "number", default: 5, label: "N" },
      },
    };
    const runtime = new LobbyRuntime(sharedEnv);
    runtime.setConfig(HOST, "n", 42);
    const persisted = runtime.serialize();
    const rehydrated = new LobbyRuntime(sharedEnv, persisted);
    const state = rehydrated.buildStateMessage("room", new Set([HOST]));
    expect(state.config?.values.n).toBe(42);
  });
});
```

Replace `env()` references and `HOST`/`ALICE`/`BOB` with whatever the existing test file uses. Read the top of `lobby-runtime.test.ts` to confirm the helpers and adjust.

- [ ] **Step 2: Run tests to verify failure**

Run: `bun run --filter @openturn/server test`

Expected: FAIL — `setConfig` doesn't exist; `start().config` doesn't exist.

- [ ] **Step 3: Update `LobbyApplyResult` to carry config-error fields**

In `packages/server/src/lobby-runtime.ts` near `LobbyApplyResult` (around line 72-74):

```ts
export type LobbyApplyResult =
  | { ok: true; changed: boolean }
  | {
      ok: false;
      reason: LobbyRejectionReason;
      configKey?: string;
      configDetail?: string;
    };
```

- [ ] **Step 4: Implement `setConfig`**

Add the `setConfig` method to `LobbyRuntime` class (place it near `setTargetCapacity`):

```ts
setConfig(hostUserID: string, key: string, value: unknown): LobbyApplyResult {
  if (hostUserID !== this.env.hostUserID) {
    return { ok: false, reason: "not_host" };
  }
  if (this.#mode !== "lobby") {
    return {
      ok: false,
      reason: this.#mode === "closed" ? "room_closed" : "bad_phase",
    };
  }
  const schema = this.env.configSchema;
  if (schema === undefined) {
    return {
      ok: false,
      reason: "invalid_config_value",
      configKey: key,
      configDetail: "no_schema",
    };
  }
  const field = schema[key];
  if (field === undefined) {
    return {
      ok: false,
      reason: "invalid_config_value",
      configKey: key,
      configDetail: "unknown_key",
    };
  }

  const detail = validationDetail(field, value);
  if (detail !== null) {
    return {
      ok: false,
      reason: "invalid_config_value",
      configKey: key,
      configDetail: detail,
    };
  }

  this.#configValues[key] = value;

  // Un-ready all human seats so players re-confirm after the host changed
  // anything. Bots stay implicitly ready.
  for (const seat of this.#seats.values()) {
    if (seat.kind === "human") {
      seat.ready = false;
    }
  }

  return { ok: true, changed: true };
}
```

Add the `validationDetail` helper at module scope:

```ts
function validationDetail(field: ConfigFieldSchema, value: unknown): string | null {
  if (field.type === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) return "expected_number";
    if (field.min !== undefined && value < field.min) return `below_min: ${field.min}`;
    if (field.max !== undefined && value > field.max) return `above_max: ${field.max}`;
    return null;
  }
  if (field.type === "boolean") {
    if (typeof value !== "boolean") return "expected_boolean";
    return null;
  }
  if (field.type === "enum") {
    if (typeof value !== "string" || !field.options.includes(value)) {
      return `not_in_options: ${JSON.stringify(value)}`;
    }
    return null;
  }
  return null;
}
```

- [ ] **Step 5: Wire `setConfig` into `applyClientMessage`**

Find the `applyClientMessage` switch (around line 193-213) and add a case:

```ts
case "host:set_config":
  return this.setConfig(userID, message.key, message.value);
```

- [ ] **Step 6: Update `LobbyStartResult` to include config**

Find `LobbyStartResult` (around line 86-88):

```ts
export type LobbyStartResult =
  | {
      ok: true;
      assignments: readonly LobbyStartAssignment[];
      hostPlayerID: string | null;
      config: { values: Readonly<Record<string, unknown>> } | null;
    }
  | { ok: false; reason: LobbyRejectionReason };
```

In `start()` (around line 369), at the return point, include config:

```ts
const config = this.env.configSchema === undefined
  ? null
  : { values: { ...this.#configValues } };

return { ok: true, assignments, hostPlayerID, config };
```

- [ ] **Step 7: Run tests + typecheck**

Run: `bun run --filter @openturn/server test && bun run --filter @openturn/server typecheck`

Expected: All new tests PASS. Existing tests PASS (some may need updating if they `toEqual` the entire `start()` result — adjust to include `config: null` for non-config envs).

- [ ] **Step 8: Commit**

```bash
git add packages/server/src/lobby-runtime.ts packages/server/src/lobby-runtime.test.ts
git commit -m "server: setConfig method + un-ready + config in LobbyStartResult"
```

---

## Task 7: Server zod MatchInputSchema — config field round-trip

**Files:**
- Modify: `packages/server/src/index.ts`

- [ ] **Step 1: Locate `MatchInputSchema`**

In `packages/server/src/index.ts`, find `MatchInputSchema` (around line 892-897 — Slice A added `hostPlayerID` here).

- [ ] **Step 2: Add `config` field**

Edit:

```ts
const MatchInputSchema = z.object({
  data: JsonValueSchema.optional(),
  players: z.array(z.string()).nonempty(),
  profiles: z.record(z.string(), JsonValueSchema).optional(),
  hostPlayerID: z.string().nullable().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});
```

(Schema-aware validation lives in core's `normalizeMatchInput`; here we just preserve shape during round-trip — same approach as the other fields.)

- [ ] **Step 3: Typecheck + tests**

Run: `bun run --filter @openturn/server test && bun run --filter @openturn/server typecheck`

Expected: PASS. No new tests needed in this package — round-trip is verified via integration with replay (next task) and worker (later task).

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/index.ts
git commit -m "server: include config in MatchInputSchema for round-trip"
```

---

## Task 8: Server worker — InitMeta config + propagation

**Files:**
- Modify: `packages/server/src/worker.ts`

- [ ] **Step 1: Add `config` to `InitMeta`**

Find `InitMeta` (around line 80-108 — Slice A added `hostPlayerID` here too) and add `config`:

```ts
interface InitMeta {
  // ...existing fields...
  hostPlayerID: string | null;
  /**
   * Resolved at `lobby:start` from `LobbyRuntime.start()`. Threaded into
   * `match.config` when the room runtime is constructed. `null` pre-start or
   * when the game declares no config schema.
   */
  config: Readonly<Record<string, unknown>> | null;
  websocketURLBase: string | null;
  // ...
}
```

- [ ] **Step 2: Initialize in meta-init literal**

Find the `meta:` literal where `InitMeta` is constructed (around line 546-557) and add `config: null`:

```ts
const meta: InitMeta = {
  // ...existing fields...
  hostPlayerID: null,
  config: null,
  websocketURLBase: input.websocketURLBase ?? null,
  cloudAPIBase: input.cloudAPIBase ?? null,
};
```

- [ ] **Step 3: Persist `config` in `handleStart`**

Find the meta-update spread in `handleStart` (around line 693-698 — Slice A added `hostPlayerID` here):

```ts
meta = {
  ...meta,
  activePlayerIDs,
  hostPlayerID: startResult.hostPlayerID,
  config: startResult.config?.values ?? null,
};
await this.ctx.storage.put(META_KEY, meta);
```

- [ ] **Step 4: Apply `config` in `getOrCreateRuntime`**

Find the `activeDeployment` const in `getOrCreateRuntime` (around line 1202-1222 — Slice A's plumbing). Add `config`:

```ts
const activeDeployment =
  meta.activePlayerIDs === null
    ? hydratedDeployment
    : {
        ...hydratedDeployment,
        match: {
          ...(hydratedDeployment.match ?? { players: hydratedDeployment.game.playerIDs }),
          players:
            meta.activePlayerIDs.length === meta.maxPlayers
              ? (hydratedDeployment.match?.players ?? hydratedDeployment.game.playerIDs)
              : meta.activePlayerIDs,
          hostPlayerID: meta.hostPlayerID,
          ...(meta.config === null ? {} : { config: meta.config }),
        } as NonNullable<typeof hydratedDeployment.match>,
      };
```

(Conditional spread on `meta.config` so we don't write `config: null` into the match. `normalizeMatchInput` would then reject `unexpected_config` for games without a schema.)

- [ ] **Step 5: Pass `configSchema` into `LobbyRuntime` env**

Find where `new LobbyRuntime(...)` is constructed in worker.ts (search `new LobbyRuntime`) and ensure the env includes the schema. Likely in `loadLobby`/`getOrCreateLobby`:

```ts
const lobbyEnv: LobbyEnv = {
  // ...existing fields...
  knownBots: deploymentKnownBots,
  configSchema: (erasedDeployment.game as { config?: ConfigSchema }).config,
};
```

(Adjust to match the actual surrounding code shape. The point is: thread `game.config` into the env at lobby creation.)

- [ ] **Step 6: Typecheck + tests**

Run: `bun run --filter @openturn/server test && bun run --filter @openturn/server typecheck`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/worker.ts
git commit -m "server: thread config from lobby start into match"
```

---

## Task 9: Replay parser — match.config round-trip

**Files:**
- Modify: `packages/replay/src/index.ts`
- Test: `packages/replay/src/index.test.ts`

- [ ] **Step 1: Write failing tests**

In `packages/replay/src/index.test.ts`, find the existing `serializes and parses canonical saved replay envelopes` test. Modify the `MATCH` constant (or the test's match input) to include `config`, and assert the round-trip preserves it. Also add a new test for malformed config:

```ts
test("rejects malformed config in saved replay", () => {
  expect(() => parseSavedReplay(JSON.stringify({
    actions: [],
    gameID: "tests/replay-game",
    initialNow: 0,
    match: {
      players: ["0", "1"],
      config: "not an object",
    },
    seed: "seed-1",
    version: 1,
  }))).toThrow(/match\.config/);
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `bun run --filter @openturn/replay test`

Expected: FAIL on the new test.

- [ ] **Step 3: Extend `parseMatchInput`**

In `packages/replay/src/index.ts`, find `parseMatchInput` (around line 465-493 — Slice A added `hostPlayerID`). After the `hostPlayerID` block and before `return match;`, add:

```ts
if (object.config !== undefined) {
  if (typeof object.config !== "object" || object.config === null || Array.isArray(object.config)) {
    throw new Error(`${label}.config must be an object.`);
  }
  match.config = cloneJsonValue(object.config) as Record<string, ReplayValue>;
}
```

(Per spec, schema-aware validation is deferred to `normalizeMatchInput` at session creation. Parser only ensures the field is shape-valid.)

- [ ] **Step 4: Run tests + typecheck**

Run: `bun run --filter @openturn/replay test && bun run --filter @openturn/replay typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/replay/src/index.ts packages/replay/src/index.test.ts
git commit -m "replay: round-trip match.config in saved replay envelope"
```

---

## Task 10: CLI — thread config through lobby:start

**Files:**
- Modify: `packages/cli/src/index.ts`

- [ ] **Step 1: Pass `configSchema` to `LobbyRuntime`**

Find where `new LobbyRuntime(...)` is called in CLI's `getOrCreateLobby` (around line 382-ish). Add `configSchema`:

```ts
const lobbyEnv: LobbyEnv = {
  // ...existing fields...
  configSchema: (currentDeployment.game as { config?: ConfigSchema }).config,
};
```

(Import `ConfigSchema` from `@openturn/core` if not already imported.)

- [ ] **Step 2: Thread `startResult.config.values` into match at lobby:start**

Find the lobby:start handler in cli/src/index.ts (around line 1472+, where Slice A landed the always-recreate pattern). The `startMatch` literal is currently:

```ts
const startMatch = {
  players: activePlayerIDs as unknown as readonly [string, ...string[]],
  hostPlayerID: startResult.hostPlayerID,
};
```

Update to include `config`:

```ts
const startMatch = {
  players: activePlayerIDs as unknown as readonly [string, ...string[]],
  hostPlayerID: startResult.hostPlayerID,
  ...(startResult.config === null ? {} : { config: startResult.config.values }),
};
```

- [ ] **Step 3: Typecheck + tests**

Run: `bun run --filter @openturn/cli test && bun run --filter @openturn/cli typecheck`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/cli/src/index.ts
git commit -m "cli: thread config through lobby:start runtime recreation"
```

---

## Task 11: Local lobby — config in onTransitionToGame callback

**Files:**
- Modify: `packages/lobby/src/react/use-local-lobby.ts`

- [ ] **Step 1: Update callback type**

In `packages/lobby/src/react/use-local-lobby.ts:60-72` (the `onTransitionToGame` option type):

```ts
onTransitionToGame?: (input: {
  roomID: string;
  assignments: ReadonlyArray<LobbyStartAssignment>;
  hostPlayerID: string | null;
  /**
   * Locked config values (per LobbyRuntime's resolution at start). `null` when
   * the game declares no config schema. Consumers writing MatchInput should
   * pass this through to `match.config`.
   */
  config: { values: Readonly<Record<string, unknown>> } | null;
}) => void;
```

- [ ] **Step 2: Pass `result.config` from start handler**

In the same file, find the `onTransitionRef.current?.(...)` call inside `start: () => { ... }` (around line 209-213). Update to include `config`:

```ts
onTransitionRef.current?.({
  roomID: LOCAL_ROOM_ID,
  assignments: result.assignments,
  hostPlayerID: result.hostPlayerID,
  config: result.config,
});
```

- [ ] **Step 3: Pass `configSchema` to local `LobbyRuntime`**

Find where `new LobbyRuntime(...)` is constructed in the same file. The `useLocalLobbyChannel` hook accepts a game; thread `game.config` into the lobby env:

```ts
const runtime = useMemo(
  () =>
    new LobbyRuntime({
      hostUserID,
      minPlayers,
      maxPlayers,
      playerIDs,
      knownBots,
      configSchema: (game as { config?: ConfigSchema }).config,
    }),
  [game, hostUserID, /* ...other deps... */],
);
```

(Adjust to match actual code structure. The point is: pass `game.config` to the runtime env.)

- [ ] **Step 4: Typecheck + tests**

Run: `bun run --filter @openturn/lobby test && bun run --filter @openturn/lobby typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/lobby/src/react/use-local-lobby.ts
git commit -m "lobby: pass config through onTransitionToGame and runtime env"
```

---

## Task 12: React — default field renderers + ConfigForm component

**Files:**
- Create: `packages/lobby/src/react/config-form.tsx`
- Test: `packages/lobby/src/react/config-form.test.tsx`
- Modify: `packages/lobby/src/react/index.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/lobby/src/react/config-form.test.tsx`:

```tsx
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

afterEach(() => cleanup());

import { ConfigForm } from "./config-form";

describe("<ConfigForm />", () => {
  test("renders a number field with min/max as a slider", () => {
    const onChange = vi.fn();
    render(
      <ConfigForm
        schema={{ n: { type: "number", default: 5, min: 0, max: 10, label: "N" } }}
        values={{ n: 5 }}
        disabled={false}
        onChange={onChange}
      />,
    );
    const input = screen.getByLabelText("N") as HTMLInputElement;
    expect(input.type).toBe("range");
    expect(input.value).toBe("5");
  });

  test("renders a number field without min/max as a stepper", () => {
    render(
      <ConfigForm
        schema={{ n: { type: "number", default: 5, label: "N" } }}
        values={{ n: 5 }}
        disabled={false}
        onChange={vi.fn()}
      />,
    );
    const input = screen.getByLabelText("N") as HTMLInputElement;
    expect(input.type).toBe("number");
  });

  test("renders a boolean field as a checkbox", () => {
    render(
      <ConfigForm
        schema={{ b: { type: "boolean", default: false, label: "B" } }}
        values={{ b: true }}
        disabled={false}
        onChange={vi.fn()}
      />,
    );
    const input = screen.getByLabelText("B") as HTMLInputElement;
    expect(input.type).toBe("checkbox");
    expect(input.checked).toBe(true);
  });

  test("renders a small enum as radio group", () => {
    render(
      <ConfigForm
        schema={{
          v: {
            type: "enum",
            options: ["a", "b", "c"] as const,
            default: "a",
            label: "V",
            labels: { a: "Alpha", b: "Beta" },
          },
        }}
        values={{ v: "b" }}
        disabled={false}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Alpha")).toBeTruthy();
    expect(screen.getByLabelText("Beta")).toBeTruthy();
    expect(screen.getByLabelText("c")).toBeTruthy();  // option without explicit label
    const beta = screen.getByLabelText("Beta") as HTMLInputElement;
    expect(beta.checked).toBe(true);
  });

  test("renders a large enum as a dropdown", () => {
    render(
      <ConfigForm
        schema={{
          v: {
            type: "enum",
            options: ["a", "b", "c", "d", "e"] as const,
            default: "a",
            label: "V",
          },
        }}
        values={{ v: "c" }}
        disabled={false}
        onChange={vi.fn()}
      />,
    );
    const select = screen.getByLabelText("V") as HTMLSelectElement;
    expect(select.tagName).toBe("SELECT");
    expect(select.value).toBe("c");
  });

  test("disabled prop disables all inputs", () => {
    render(
      <ConfigForm
        schema={{
          n: { type: "number", default: 1, label: "N" },
          b: { type: "boolean", default: false, label: "B" },
        }}
        values={{ n: 1, b: false }}
        disabled={true}
        onChange={vi.fn()}
      />,
    );
    expect((screen.getByLabelText("N") as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText("B") as HTMLInputElement).disabled).toBe(true);
  });

  test("calls onChange with field key + new value on edit", () => {
    const onChange = vi.fn();
    render(
      <ConfigForm
        schema={{ n: { type: "number", default: 5, min: 0, max: 10, label: "N" } }}
        values={{ n: 5 }}
        disabled={false}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByLabelText("N"), { target: { value: "8" } });
    expect(onChange).toHaveBeenCalledWith("n", 8);
  });

  test("custom renderer overrides default for a field", () => {
    const Custom = vi.fn(() => <div data-testid="custom">custom</div>);
    render(
      <ConfigForm
        schema={{
          n: { type: "number", default: 1, label: "N" },
          b: { type: "boolean", default: false, label: "B" },
        }}
        values={{ n: 1, b: false }}
        disabled={false}
        onChange={vi.fn()}
        renderers={{ n: Custom }}
      />,
    );
    expect(screen.getByTestId("custom")).toBeTruthy();
    expect(screen.getByLabelText("B")).toBeTruthy();  // boolean still uses default
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `bun run --filter @openturn/lobby test`

Expected: FAIL — `ConfigForm` does not exist.

- [ ] **Step 3: Implement `ConfigForm`**

Create `packages/lobby/src/react/config-form.tsx`:

```tsx
import type { ReactNode } from "react";

import type {
  ConfigFieldSchema,
  ConfigSchema,
  NumberFieldSchema,
  BooleanFieldSchema,
  EnumFieldSchema,
} from "@openturn/core";

export interface ConfigFieldRendererProps<TValue, TSchema extends ConfigFieldSchema> {
  value: TValue;
  defaultValue: TValue;
  schema: TSchema;
  disabled: boolean;
  error?: string;
  onChange: (next: TValue) => void;
}

export type ConfigFieldRenderer<TValue, TSchema extends ConfigFieldSchema> = (
  props: ConfigFieldRendererProps<TValue, TSchema>,
) => ReactNode;

export type ConfigRenderers<TSchema extends ConfigSchema> = {
  [K in keyof TSchema]?:
    TSchema[K] extends NumberFieldSchema ? ConfigFieldRenderer<number, NumberFieldSchema> :
    TSchema[K] extends BooleanFieldSchema ? ConfigFieldRenderer<boolean, BooleanFieldSchema> :
    TSchema[K] extends EnumFieldSchema<infer TOption> ? ConfigFieldRenderer<TOption, EnumFieldSchema<TOption>> :
    never;
};

export interface ConfigFormProps {
  schema: ConfigSchema;
  values: Readonly<Record<string, unknown>>;
  disabled: boolean;
  onChange: (key: string, value: unknown) => void;
  errors?: Readonly<Record<string, string>>;
  renderers?: Record<string, ConfigFieldRenderer<any, any>>;
}

export function ConfigForm(props: ConfigFormProps): ReactNode {
  const { schema, values, disabled, onChange, errors, renderers } = props;
  return (
    <div className="flex flex-col gap-3">
      {Object.entries(schema).map(([key, field]) => {
        const value = values[key] ?? field.default;
        const error = errors?.[key];
        const customRenderer = renderers?.[key];
        const fieldNode = customRenderer !== undefined
          ? customRenderer({
              value: value as never,
              defaultValue: field.default as never,
              schema: field as never,
              disabled,
              error,
              onChange: (next: unknown) => onChange(key, next),
            })
          : renderDefault(key, field, value, disabled, error, (next: unknown) => onChange(key, next));
        return (
          <div key={key} className="flex flex-col gap-1">
            {fieldNode}
            {field.description !== undefined ? (
              <p className="text-xs text-gray-500">{field.description}</p>
            ) : null}
            {error !== undefined ? (
              <p className="text-xs text-red-600">{error}</p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function renderDefault(
  key: string,
  field: ConfigFieldSchema,
  value: unknown,
  disabled: boolean,
  error: string | undefined,
  onChange: (next: unknown) => void,
): ReactNode {
  if (field.type === "number") {
    return <NumberInput fieldKey={key} field={field} value={value as number} disabled={disabled} onChange={onChange} />;
  }
  if (field.type === "boolean") {
    return <BooleanToggle fieldKey={key} field={field} value={value as boolean} disabled={disabled} onChange={onChange} />;
  }
  if (field.type === "enum") {
    return <EnumPicker fieldKey={key} field={field} value={value as string} disabled={disabled} onChange={onChange} />;
  }
  return null;
}

function NumberInput(props: {
  fieldKey: string;
  field: NumberFieldSchema;
  value: number;
  disabled: boolean;
  onChange: (next: number) => void;
}): ReactNode {
  const { fieldKey, field, value, disabled, onChange } = props;
  const inputType =
    field.min !== undefined && field.max !== undefined ? "range" : "number";
  return (
    <label className="flex flex-col gap-1 text-sm" htmlFor={fieldKey}>
      <span>{field.label}</span>
      <input
        id={fieldKey}
        type={inputType}
        value={value}
        min={field.min}
        max={field.max}
        step={field.step}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full"
      />
    </label>
  );
}

function BooleanToggle(props: {
  fieldKey: string;
  field: BooleanFieldSchema;
  value: boolean;
  disabled: boolean;
  onChange: (next: boolean) => void;
}): ReactNode {
  const { fieldKey, field, value, disabled, onChange } = props;
  return (
    <label className="flex items-center gap-2 text-sm" htmlFor={fieldKey}>
      <input
        id={fieldKey}
        type="checkbox"
        checked={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>{field.label}</span>
    </label>
  );
}

function EnumPicker(props: {
  fieldKey: string;
  field: EnumFieldSchema;
  value: string;
  disabled: boolean;
  onChange: (next: string) => void;
}): ReactNode {
  const { fieldKey, field, value, disabled, onChange } = props;
  const useRadio = field.options.length <= 4;
  const labelFor = (option: string) => field.labels?.[option] ?? option;

  if (useRadio) {
    return (
      <fieldset className="flex flex-col gap-1 text-sm">
        <legend>{field.label}</legend>
        {field.options.map((option) => (
          <label key={option} className="flex items-center gap-2">
            <input
              type="radio"
              name={fieldKey}
              value={option}
              checked={value === option}
              disabled={disabled}
              onChange={() => onChange(option)}
            />
            <span>{labelFor(option)}</span>
          </label>
        ))}
      </fieldset>
    );
  }

  return (
    <label className="flex flex-col gap-1 text-sm" htmlFor={fieldKey}>
      <span>{field.label}</span>
      <select
        id={fieldKey}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        {field.options.map((option) => (
          <option key={option} value={option}>
            {labelFor(option)}
          </option>
        ))}
      </select>
    </label>
  );
}
```

- [ ] **Step 4: Export from package index**

In `packages/lobby/src/react/index.ts`, add:

```ts
export {
  ConfigForm,
  type ConfigFieldRenderer,
  type ConfigFieldRendererProps,
  type ConfigFormProps,
  type ConfigRenderers,
} from "./config-form";
```

- [ ] **Step 5: Run tests + typecheck**

Run: `bun run --filter @openturn/lobby test && bun run --filter @openturn/lobby typecheck`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/lobby/src/react/config-form.tsx packages/lobby/src/react/config-form.test.tsx packages/lobby/src/react/index.ts
git commit -m "lobby: add ConfigForm with default number/boolean/enum renderers"
```

---

## Task 13: React — wire configUI / configRenderers into Lobby and LobbyWithBots

**Files:**
- Modify: `packages/lobby/src/react/lobby.tsx`
- Modify: `packages/lobby/src/react/lobby-with-bots.tsx`
- Modify: `packages/lobby/src/react/use-local-lobby.ts` (expose setConfig from channel)
- Test: `packages/lobby/src/react/lobby-with-bots.test.tsx`

- [ ] **Step 1: Add `setConfig` to `useLocalLobbyChannel` channel**

The channel handle returned by `useLocalLobbyChannel` exposes `takeSeat`, `setReady`, etc. Add `setConfig`:

```ts
setConfig: (key: string, value: unknown) =>
  handleResult(runtime.setConfig(hostUserID, key, value), "host:set_config"),
```

(Place alongside the existing handlers in `use-local-lobby.ts`.)

The hosted (cloud-backed) channel needs the same — find `lobby.tsx`'s channel construction and add `setConfig` that sends the wire message:

```ts
setConfig: (key: string, value: unknown) => {
  channel?.send({ type: "host:set_config", key, value });
},
```

(Adjust to match the hosted channel's send pattern.)

- [ ] **Step 2: Add `LobbyView.config` and pass through `buildLobbyView`**

Find `LobbyView` interface in `lobby.tsx` (around line 200). Add:

```ts
export interface LobbyView {
  // ...existing fields...
  /** Current config values, when the game declares a schema. */
  configValues: Readonly<Record<string, unknown>> | null;
  setConfig: (key: string, value: unknown) => void;
}
```

In `buildLobbyView`, populate `configValues` from `state.config?.values ?? null` and `setConfig` from the channel.

- [ ] **Step 3: Add `configUI` and `configRenderers` props to `<Lobby>` and `<LobbyWithBots>`**

In `lobby.tsx` and `lobby-with-bots.tsx`, extend the props:

```tsx
import type { ConfigSchema } from "@openturn/core";
import { ConfigForm, type ConfigRenderers } from "./config-form";

interface LobbyProps {
  // ...existing...
  configUI?: "auto" | "manual" | "none";
  configSchema?: ConfigSchema;
  configRenderers?: Record<string, ConfigFieldRenderer<any, any>>;
}
```

When `configUI === "auto"` AND `configSchema !== undefined` AND `lobby.configValues !== null`, render the `<ConfigForm>` above the seat list (collapsible section, default-expanded for host):

```tsx
{props.configUI === "auto" && props.configSchema !== undefined && lobby.configValues !== null ? (
  <details className="rounded border p-3" open={lobby.isHost}>
    <summary className="cursor-pointer text-sm font-medium">Settings</summary>
    <div className="pt-2">
      <ConfigForm
        schema={props.configSchema}
        values={lobby.configValues}
        disabled={!lobby.isHost}
        onChange={lobby.setConfig}
        renderers={props.configRenderers}
      />
    </div>
  </details>
) : null}
```

(Default `configUI` to `"none"` so the section is hidden unless explicitly opted in.)

- [ ] **Step 4: Write rendering tests**

Append to `packages/lobby/src/react/lobby-with-bots.test.tsx`:

```tsx
test("configUI=auto renders settings section when schema and values present", () => {
  const view = makeView({
    configValues: { n: 5 },
    setConfig: vi.fn(),
  });
  render(
    <LobbyWithBots
      lobby={view}
      configUI="auto"
      configSchema={{ n: { type: "number", default: 1, label: "N" } }}
    />,
  );
  expect(screen.getByText("Settings")).toBeTruthy();
  expect(screen.getByLabelText("N")).toBeTruthy();
});

test("configUI=none does not render settings section even with schema", () => {
  const view = makeView({
    configValues: { n: 5 },
    setConfig: vi.fn(),
  });
  render(
    <LobbyWithBots
      lobby={view}
      configUI="none"
      configSchema={{ n: { type: "number", default: 1, label: "N" } }}
    />,
  );
  expect(screen.queryByText("Settings")).toBeNull();
});

test("non-host viewer sees disabled inputs in auto mode", () => {
  const view = makeView({
    isHost: false,
    configValues: { n: 5 },
    setConfig: vi.fn(),
  });
  render(
    <LobbyWithBots
      lobby={view}
      configUI="auto"
      configSchema={{ n: { type: "number", default: 1, label: "N" } }}
    />,
  );
  // The <details> is collapsed by default for non-hosts; expand it to assert.
  fireEvent.click(screen.getByText("Settings"));
  expect((screen.getByLabelText("N") as HTMLInputElement).disabled).toBe(true);
});
```

(Update the `makeView` helper in the test file to include `configValues: null` and `setConfig: vi.fn()` defaults so existing tests still work.)

- [ ] **Step 5: Run tests + typecheck**

Run: `bun run --filter @openturn/lobby test && bun run --filter @openturn/lobby typecheck`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/lobby/src/react/lobby.tsx packages/lobby/src/react/lobby-with-bots.tsx packages/lobby/src/react/use-local-lobby.ts packages/lobby/src/react/lobby-with-bots.test.tsx
git commit -m "lobby: wire configUI/configRenderers into Lobby and LobbyWithBots"
```

---

## Task 14: Full-monorepo verification

**Files:** All modified files from Tasks 1-13.

- [ ] **Step 1: Run full typecheck**

From `openturn/` root: `bun run typecheck`

Expected: PASS for every workspace. Investigate any failures.

- [ ] **Step 2: Run full test suite**

From `openturn/` root: `bun run test`

Expected: PASS for every workspace.

- [ ] **Step 3: Spec checklist spot-check**

Manually verify against `superpowers/specs/2026-05-06-lobby-config-system-design.md`:

- [ ] Schema declaration on `GameDefinition.config` with number/boolean/enum support (Task 1, 2)
- [ ] Per-field metadata: `default`, `label`, optional `description`, `min`/`max`/`step`, `options`/`labels` (Task 1)
- [ ] `MatchInput.config` with TS inference from game schema (Task 2)
- [ ] `normalizeMatchInput` validates + fills defaults + 4 error cases (Task 3)
- [ ] `LobbySetConfig` protocol message + `LobbyStateMessage.config` + `LobbyRejectedMessage.configKey/configDetail` (Task 4)
- [ ] `LobbyEnv.configSchema` + `#configValues` init from defaults + persistence (Task 5)
- [ ] `LobbyRuntime.setConfig` with un-ready, validation, and `LobbyStartResult.config` (Task 6)
- [ ] Zod `MatchInputSchema` round-trip (Task 7)
- [ ] Cloud worker `InitMeta.config` + propagation (Task 8)
- [ ] Replay parser config round-trip (Task 9)
- [ ] CLI lobby:start config plumbing (Task 10)
- [ ] Local lobby `onTransitionToGame` config (Task 11)
- [ ] `<ConfigForm>` with default renderers + override map (Task 12)
- [ ] `<Lobby>` / `<LobbyWithBots>` `configUI` + `configRenderers` props (Task 13)

- [ ] **Step 4: Commit any final fixes**

```bash
git add <modified files>
git commit -m "fix: <description of integration-level fix>"
```

If the full suite was clean on the first try, no commit needed.

---

## Notes for the executing engineer

- **Read order:** spec → this plan → `packages/core/src/types.ts` (look at how `profile?` flows) → `packages/server/src/lobby-runtime.ts` (Slice A patterns).
- **TS inference is load-bearing**: Task 2's `ConfigValuesOf` and the third generic on `MatchInput` must not lose type info downstream. If `ctx.match.config.turnTimeoutMs` ends up typed as `unknown` instead of `number`, something broke in the generic plumbing — likely a `MatchInput` reference somewhere uses 2 generics instead of 3.
- **Replay parser does NOT validate config against schema** — `normalizeMatchInput` does. Don't double-validate at parse time; the parser may not have the game definition.
- **Backwards compatibility**: every change is additive. Games without `config` continue to work, just `match.config` is undefined.
- **Slice A patterns**: cloud worker's `activeDeployment` override, CLI's always-recreate-at-start, replay parser's `cloneJsonValue` for new fields, zod schema's `.optional()` — all directly mirror Slice A's plumbing. Look at commits `48123b1`, `a6d3e25`, `ce7174c`, `982fb2b` for reference.
- **The `<ConfigForm>` styling**: Tailwind classes per project preference. Keep it utilitarian for v1; visual polish can iterate.

---

## Self-review notes

Cross-checked against the spec:

- **Spec coverage:** Every spec section (1-15) maps to at least one task. Task 14 spot-check enumerates them.
- **Placeholder scan:** No TBDs, TODOs, or "implement appropriate X" steps. Code blocks complete.
- **Type consistency:** `ConfigSchema` / `ConfigFieldSchema` / `ConfigValuesOf` named identically across Tasks 1, 2, 3, 5, 12, 13. `LobbyStartResult.config` is `{ values: Record } | null` in Tasks 6, 8, 10, 11. `match.config` placement on `MatchInput` is consistent everywhere it appears.
- **Test coverage:** TDD for the load-bearing pieces — core validation (Task 3), lobby setConfig (Task 6), replay round-trip (Task 9), default renderers + override (Task 12). Other tasks rely on integration coverage from these or from monorepo-level verification (Task 14).
