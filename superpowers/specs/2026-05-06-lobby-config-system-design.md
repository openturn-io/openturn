# Lobby Config System with Managed UI — Design

**Date:** 2026-05-06
**Status:** Approved for implementation
**Scope:** Slice C of a thread (Slice A = `hostPlayerID` shipped; Slice B = turn timer enforcement, depends on this slice).

## Goal

Allow game authors to declare a **typed config schema** that the lobby exposes as a host-mutable settings form, with values agreed by all viewers before the match starts and locked into `match.config` at game-start.

Match-shape settings (turn timer, score target, variant picker) need to be visible and pre-agreed in the lobby — not configured mid-game. Game-implements-config (Slice A's host-state pattern) handles in-game decisions but breaks for these match-shape settings: spectating-host configuration, lobby-card previews, tournament admin tools, and "I won't sit down at a 5-second timer" UX all need lobby-stage settings.

## Non-Goals

- Versioned schemas / migrations between deployment versions.
- Mid-match config mutation (would require G-state-managed config — different architecture).
- Conditional / dependent fields (field B's options depend on field A's value).
- Free-form strings, arrays, multi-select, file uploads, or other field types beyond number / boolean / enum.
- Per-player config (each seat configures their own values).
- "Reset to defaults" button or "save as preset" flows.
- Auto-renderer customization beyond per-field overrides (themes, layout grids, animation systems).

These are deferable. The primitives in this slice support most of them as future extensions.

## Design

### 1. Schema declaration

Game authors declare config on `GameDefinition`, peer to existing `profile?` and `bots?` slots:

```ts
defineGame({
  // ...existing fields...
  config: {
    turnTimeoutMs: {
      type: "number",
      default: 30_000,
      min: 5_000,
      max: 300_000,
      step: 5_000,
      label: "Turn time",
      description: "Per-turn deadline in milliseconds.",
    },
    variant: {
      type: "enum",
      options: ["classic", "chess960"] as const,
      default: "classic",
      labels: { classic: "Classic", chess960: "Chess960" },
      label: "Variant",
    },
    allowSpectators: {
      type: "boolean",
      default: true,
      label: "Allow spectators",
    },
  },
});
```

The schema is part of the game definition, baked at build time. It travels with the deployment manifest the client already loads. **The schema is never serialized on the lobby protocol wire** — only values are.

### 2. Field declarations

```ts
type ConfigFieldSchema =
  | NumberFieldSchema
  | BooleanFieldSchema
  | EnumFieldSchema;

interface NumberFieldSchema {
  type: "number";
  default: number;
  min?: number;
  max?: number;
  step?: number;          // UI hint only — not validated server-side
  label: string;
  description?: string;
}

interface BooleanFieldSchema {
  type: "boolean";
  default: boolean;
  label: string;
  description?: string;
}

interface EnumFieldSchema<TOption extends string = string> {
  type: "enum";
  options: readonly [TOption, ...TOption[]];
  default: TOption;
  labels?: Partial<Record<TOption, string>>;   // optional per-option display labels
  label: string;
  description?: string;
}

type ConfigSchema = Record<string, ConfigFieldSchema>;
```

Field types beyond these (string, array, conditional) are deferred. The shape is forward-compatible — adding a `"string"` variant later is non-breaking.

### 3. Data-model placement

`MatchInput` gains a third generic parameter and a fourth optional field:

```ts
interface MatchInput<
  TPlayers extends PlayerList = PlayerList,
  TMatchData = ReplayValue,
  TConfigValues = Record<string, JsonValue>,
> {
  data?: TMatchData;
  players: readonly [TPlayers[number], ...TPlayers[number][]];
  profiles?: Partial<Readonly<PlayerRecord<TPlayers, ReplayValue>>>;
  hostPlayerID?: TPlayers[number] | null;
  config?: TConfigValues;   // NEW
}
```

`TConfigValues` is inferred from the game's schema declaration via the same generic-plumbing pattern used for `profile`. Game code reads:

```ts
ctx.match.config.turnTimeoutMs   // typed as number
ctx.match.config.variant          // typed as "classic" | "chess960"
ctx.match.config.allowSpectators  // typed as boolean
```

Game code can read these values, ignore them, or override them per-state. `match.config` is data, not a directive — the schema describes "what the lobby agreed to," not "what the engine enforces."

### 4. Lobby protocol

A new client message and an extension to the existing state and rejection messages:

```ts
// New
interface LobbySetConfig {
  type: "host:set_config";
  key: string;
  value: JsonValue;
}

// Existing LobbyClientMessage union grows to include LobbySetConfig.

// LobbyStateMessage extension
interface LobbyStateMessage {
  // ...existing fields...
  config?: {
    values: Record<string, JsonValue>;
  };
}

// LobbyRejectedMessage extension — adds a new rejection reason and optional fields
interface LobbyRejectedMessage {
  type: "lobby:rejected";
  reason: LobbyRejectionReason;   // gains "invalid_config_value"
  echoType?: LobbyClientMessage["type"];
  message?: string;
  configKey?: string;             // present when reason === "invalid_config_value"
  configDetail?: string;          // human-readable; e.g., "below_min: 5000"
}
```

Single-field-per-message keeps validation atomic and the server simple. Batch updates (multi-field atomic) are deferred — addable later non-breakingly via a separate message type if needed.

### 5. Lobby runtime — state and method

`LobbyRuntime` gains an in-memory `#configValues: Record<string, JsonValue>` initialized from schema defaults at construction time, plus:

```ts
setConfig(hostUserID: string, key: string, value: JsonValue): LobbyApplyResult
```

Behavior:
- Reject `not_host` if `hostUserID !== this.env.hostUserID`.
- Reject `bad_phase` if not in `lobby` phase.
- Reject `invalid_config_value` (with `configKey`, `configDetail`) for: unknown key, wrong type, out-of-bounds number, enum value not in `options`. (`step` is a UI hint, not validated.)
- On success: store the new value, un-ready every human seat (`#seats[i].ready = false` for all `kind: "human"`), return `{ ok: true, changed: true }`.

`LobbyPersistedState` grows `config: { values }` so DO hibernation preserves host's choices.

`LobbyEnv` accepts an optional `configSchema?: ConfigSchema`; the runtime needs the schema to validate and to supply defaults. If absent (game declared no config), `setConfig` rejects every key as `unknown_key` (no schema → no valid keys).

### 6. Lifecycle

- **Initialization**: At lobby creation, `#configValues` = `{ ...defaults from schema }`. If `configSchema` is undefined, `#configValues = {}`.
- **Mutation window**: While `mode === "lobby"`. After `lobby:start` runs, config is locked.
- **Lock at start**: `start()` snapshots `#configValues` and includes it in `LobbyStartResult.config`. The cloud worker / CLI / lobby consumer threads it into `MatchInput.config` when constructing the room runtime — same plumbing pattern as `hostPlayerID`.
- **Readiness invalidation**: A successful `setConfig` un-readies every human seat. Mirrors how a host changing capacity un-seats people; uniform trust model.
- **Visibility**: `config.values` rides on every `lobby:state` broadcast so all viewers (host and non-hosts) see the same agreed values.
- **Single-player**: Schema applies; the seated player IS the host (lobby semantic), so they see the form and can mutate. No special case.

### 7. Validation — three layers

| Layer | Where | Catches |
|---|---|---|
| **Wire** | `LobbyRuntime.setConfig` | Bad type, out of bounds, unknown key, unknown enum value, unknown caller authority |
| **Lock** | `LobbyRuntime.start()` | Re-validates whole config before baking into `match.config`. Defends against schema migration mid-lobby. |
| **Engine** | `normalizeMatchInput` in `@openturn/core` | Belt-and-suspenders at session creation. Catches malformed `match.config` from non-lobby callers (saved replays, tests, external `createRoomRuntime` callers). |

Engine-layer validation requires the game's schema. `normalizeMatchInput` is called with `(machine, match)`; the schema lives on `machine.config`. Behavior:

- If `machine.config` is undefined and `match.config` is set → throws `InvalidGameDefinitionError` with code `unexpected_config`.
- If `machine.config` is defined and `match.config` is missing → normalizes by filling all fields with their schema defaults.
- If `match.config` has a key not in the schema → throws with code `unknown_config_key`.
- If `match.config` is missing keys that the schema declares → fills missing keys with defaults (does not reject).
- If a present value fails type / bounds / options check → throws with code `invalid_config_value`.

Missing keys fall back to defaults to stay friendly to non-lobby callers (tests, hand-rolled `createRoomRuntime` invocations) — they don't have to enumerate every config key. Only the keys they explicitly set are validated.

### 8. Replay and persistence boundaries

- `match.config` flows through snapshots verbatim — same model as `data` / `profiles` / `hostPlayerID`.
- **Replay parser** (`packages/replay/src/index.ts:parseMatchInput`): adds shape validation for `config` (object with string keys, JSON values). Schema-aware validation is NOT applied at parse time — the parser may not have the game definition. `normalizeMatchInput` validates against the schema when the session is created.
- **Zod `MatchInputSchema`** (`packages/server/src/index.ts`): adds `config: z.record(z.string(), z.unknown()).optional()`. Without this, `RoomPersistenceRecord` round-trips strip the field — same class of bug we caught at the end of Slice A.

### 9. Rendering API (React)

Lobby React components grow two opt-in props:

```tsx
<LobbyWithBots
  channel={channel}
  userID={userID}
  configUI="auto"            // "auto" | "manual" | "none". default "none".
  configRenderers={{
    turnTimeoutMs: (props) => <CustomTimerSlider {...props} />,
  }}
/>
```

| Mode | Behavior |
|---|---|
| `"none"` (default) | No config UI rendered. Schema still ships and game code still reads `match.config`. Backwards-compatible. |
| `"auto"` | Form auto-renders above the seat list, in a collapsible "Settings" section (default-expanded for host, default-collapsed for non-hosts). Disabled inputs for non-hosts. |
| `"manual"` | Embedder mounts `<ConfigForm channel={channel} renderers={...} />` themselves wherever they want — for fully custom layouts. |

`configRenderers` is a per-field React override map, type-safe against the game's schema. When a field has a custom renderer, the auto-form uses it in place of the default; otherwise it uses a built-in default renderer for the field type.

### 10. Default field renderers

| Type | Default renderer | Notes |
|---|---|---|
| `number` | `<NumberInput>` — slider when `min` and `max` (and optional `step`) are present; numeric stepper otherwise. |
| `boolean` | `<BooleanToggle>` — checkbox / switch. |
| `enum` | `<EnumPicker>` — radio group when `options.length <= 4`, dropdown otherwise. Honors `labels` for display text. |

All defaults follow Tailwind styling consistent with the existing lobby UI (per project preference).

### 11. Renderer props contract

```ts
type FieldRenderer<TValue, TSchema extends ConfigFieldSchema> = (props: {
  value: TValue;
  onChange: (next: TValue) => void;
  defaultValue: TValue;
  schema: TSchema;
  disabled: boolean;       // true for non-host viewers, or while a mutation is pending
  error?: string;          // server-rejected detail for the most recent failed mutation
}) => ReactNode;
```

`configRenderers` is typed so each entry's `TValue` and `TSchema` correspond to the field's declared type. Custom renderers don't get arbitrary lobby state via props — if they need it, they can use the lobby package's existing hooks (`useLobbyState()` etc.) to subscribe.

### 12. Server-side validation rejection detail

| Failure | `reason` | `configKey` | `configDetail` |
|---|---|---|---|
| Caller is not host | `not_host` | — | — |
| Lobby phase ≠ `lobby` | `bad_phase` | — | — |
| Schema is undefined | `invalid_config_value` | (key sent) | `no_schema` |
| Unknown key | `invalid_config_value` | (key sent) | `unknown_key` |
| Wrong value type | `invalid_config_value` | (key sent) | `expected_<number\|boolean\|enum>` |
| Number below min | `invalid_config_value` | (key sent) | `below_min: <min>` |
| Number above max | `invalid_config_value` | (key sent) | `above_max: <max>` |
| Enum value not in options | `invalid_config_value` | (key sent) | `not_in_options: <value>` |

Client renders the form with per-field error highlighting by matching `configKey`.

### 13. TypeScript inference

`defineGame` becomes generic over `TConfig extends ConfigSchema | undefined`. The inferred values type is derived structurally:

```ts
type ConfigValuesOf<TConfig extends ConfigSchema | undefined> =
  TConfig extends ConfigSchema
    ? { [K in keyof TConfig]:
          TConfig[K] extends NumberFieldSchema ? number :
          TConfig[K] extends BooleanFieldSchema ? boolean :
          TConfig[K] extends EnumFieldSchema<infer TOption> ? TOption :
          never;
      }
    : Record<string, JsonValue>;
```

`MatchInput<TPlayers, TMatchData, TConfigValues>` adds `TConfigValues` as a third generic parameter. Game/runtime types thread it through. `ctx.match.config` infers correctly without the game author writing types by hand.

This is mechanical TS plumbing — known pattern (mirrors `profile`).

### 14. Edge cases

| Case | Behavior |
|---|---|
| Game declares no `config` slot | Lobby's `#configValues` is `{}`. `setConfig` rejects every call as `unknown_key`. `LobbyStateMessage.config` omitted. `match.config` undefined. |
| Game adds `config` after a deployment was already in use | New deployment ships → existing rooms for the old deployment finish out with the old (empty) schema. New rooms use new schema. No migration. |
| Schema removes a field between deploys | Persisted lobby's `#configValues` drops unknown keys silently at next-load. No throw. |
| Schema adds a field between deploys | Persisted lobby's `#configValues` gets the new field's default at next-load. |
| Bad value in saved-replay JSON | Parser shape-validates only; `normalizeMatchInput` rejects when session is created. Parse-time error surfaced if loader has the game definition. |
| Custom renderer throws | Caught by React error boundary; field reverts to default renderer with an error indicator. (Standard React error handling — not config-system specific.) |

### 15. Out of scope (re-stated for clarity)

- Schema versioning / migrations
- Mid-match config mutation
- Conditional / dependent fields
- Free-form string / array / multi-select / file fields
- Per-player config
- Reset / preset / undo flows
- Server-side `step` validation on numbers
- Custom default renderers (themes, layout slot system)

## Tests

### Type-level

- `defineGame({ config: { x: { type: "number", default: 0 } } })` produces a game whose `MatchInput` has `config?: { x: number }`.
- `defineGame({ config: { variant: { type: "enum", options: ["a", "b"] as const, default: "a" } } })` produces `config?: { variant: "a" | "b" }`.
- `configRenderers` map rejects renderers whose props' `value` type doesn't match the declared field type.

### Lobby runtime (`packages/server/src/lobby-runtime.test.ts`)

- `setConfig` rejects when caller is not host.
- `setConfig` rejects when phase is `active` or `closed`.
- `setConfig` rejects unknown keys, bad types, out-of-bounds numbers, unknown enum values.
- `setConfig` un-readies all human seats on success.
- `setConfig` does NOT un-ready bot seats.
- `start()` includes `config` (snapshot of current values) in `LobbyStartResult`.
- `LobbyPersistedState` round-trips `config.values` through `serialize()` / re-construction.
- Defaults are applied at lobby construction when schema is provided.
- New schema field added between persists → next-load picks up its default.
- Removed schema field → next-load drops the obsolete value.

### Core validation (`packages/core/src/index.test.ts`)

- `normalizeMatchInput` rejects `match.config` with `unexpected_config` if game declares no schema.
- `normalizeMatchInput` rejects out-of-bounds numbers with `invalid_config_value`.
- `normalizeMatchInput` rejects unknown enum values.
- `normalizeMatchInput` rejects unknown keys (`unknown_config_key`).
- `normalizeMatchInput` accepts schema-conformant values and exposes them on `ctx.match.config`.

### Replay (`packages/replay/src/index.test.ts`)

- Replay envelope round-trips `match.config` (parse + serialize).
- Parser rejects `match.config` that isn't a plain object.
- Zod `MatchInputSchema` round-trips `match.config` through `RoomPersistenceRecord`.

### React rendering (`packages/lobby/src/react/`)

- `configUI: "auto"` renders a default form for a schema with each field type.
- `configUI: "auto"` renders disabled inputs for non-host viewers.
- `configUI: "manual"` renders nothing automatically; `<ConfigForm>` renders when explicitly mounted.
- `configRenderers={{ key: Custom }}` replaces the default renderer for that field; other fields use defaults.
- Number renderer with `min` + `max` + `step` is the slider variant; without bounds it's the stepper variant.
- Enum renderer with ≤4 options is radio; with >4 is dropdown.
- Server-rejection error displays under the relevant field by `configKey`.

## Implementation surface

| File | Change |
|---|---|
| `packages/core/src/types.ts` | Add `config?` to `MatchInput`. Add `ConfigSchema`, `ConfigFieldSchema`, `ConfigValuesOf` types. Add third generic to `MatchInput`. Add `config?` to `GameDefinition`. |
| `packages/core/src/validation.ts` | Extend `normalizeMatchInput` to validate `match.config` against `machine.config` schema. Add new validation codes. |
| `packages/core/src/index.ts` | Export new types. |
| `packages/server/src/lobby-runtime.ts` | Add `configSchema?` to `LobbyEnv`, add `#configValues`, add `setConfig` method, extend `LobbyPersistedState` and `start()`'s result. |
| `packages/server/src/lobby-runtime.test.ts` | Tests per the list above. |
| `packages/server/src/index.ts` | Extend `MatchInputSchema` (zod) with `config`. Extend `LobbyStartResult` with `config`. |
| `packages/server/src/worker.ts` | Persist config on `InitMeta`; thread `meta.config` into match override at runtime construction. |
| `packages/lobby/src/react/use-local-lobby.ts` | Pass `config` from start result through `onTransitionToGame`. Add a way for consumers to call `setConfig`. |
| `packages/lobby/src/react/lobby.tsx`, `lobby-with-bots.tsx` | Add `configUI` and `configRenderers` props. Render the config form section. |
| `packages/lobby/src/react/config-form.tsx` (NEW) | The auto-rendered form component, plus default field renderers (`NumberInput`, `BooleanToggle`, `EnumPicker`). |
| `packages/protocol/src/lobby.ts` | Add `LobbySetConfig` to client union. Extend `LobbyStateMessage` and `LobbyRejectedMessage`. Add `invalid_config_value` rejection reason. |
| `packages/replay/src/index.ts` | Extend `parseMatchInput` to round-trip `config`. |
| `packages/replay/src/index.test.ts` | Round-trip tests. |
| `packages/cli/src/index.ts` | Plumb config into runtime construction at `lobby:start` (mirror Slice A's CLI fix pattern). |

The change is type-additive throughout (new generic parameter has a sensible default of `Record<string, JsonValue>`); existing games and matches without `config` continue to work unchanged.
