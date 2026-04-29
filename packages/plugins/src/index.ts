import type { DeepReadonly, DeterministicRng, PlayerID, PlayerList, ReplayValue } from "@openturn/core";
import type {
  AnyQueuedEvent,
  ComputedMap,
  CoreGameDefinitionFor,
  DefaultPlayerIDsBoundLocal,
  GamekitDefinition,
  GamekitMoveDefinition,
} from "@openturn/gamekit";
import { defineGame } from "@openturn/gamekit";
import type { JsonValue } from "@openturn/json";

/**
 * Plugins extend a gamekit game definition with cross-cutting behavior (chat,
 * emotes, vote-to-kick, spectator pings, ...) without forking the host game.
 *
 * Composition happens at the gamekit-source level via `withPlugins(baseDef, plugins)`,
 * which is then passed to `defineGame(match, ...)`. Plugin state lives at
 * `G.plugins[plugin.id]`, plugin moves are namespaced as `${pluginID}__${moveName}`,
 * and plugin views are merged into the host game's player/public views so the
 * slices ride along on every snapshot the server hands to clients.
 *
 * Plugin moves default to `canPlayer: () => true` so any seated player may
 * dispatch them regardless of whose turn it is — chat, votes, etc. should not
 * be turn-gated. Override `canPlayer` on a move to restrict.
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type PluginMoveOutcome<TSlice extends object> =
  | { kind: "stay"; patch?: Partial<TSlice> }
  | { kind: "invalid"; reason?: string; details?: JsonValue };

export interface PluginMovePlayerContext<TPlayerID extends string = string> {
  id: TPlayerID;
}

export interface PluginMovePermissionContext<TPlayerID extends string = string> {
  player: PluginMovePlayerContext<TPlayerID>;
}

export interface PluginMoveRunContext<
  TSlice extends object,
  TArgs,
  TPlayerID extends string = string,
> extends PluginMovePermissionContext<TPlayerID> {
  G: DeepReadonly<TSlice>;
  args: TArgs;
  rng: DeterministicRng;
}

export interface PluginMoveDefinition<
  TSlice extends object,
  TArgs = undefined,
  TPlayerID extends string = string,
> {
  args?: TArgs;
  canPlayer?: (context: PluginMovePermissionContext<TPlayerID>) => boolean;
  run: (context: PluginMoveRunContext<TSlice, TArgs, TPlayerID>) => PluginMoveOutcome<TSlice>;
}

export type AnyPluginMoveDefinition<TSlice extends object = Record<string, JsonValue>> =
  PluginMoveDefinition<TSlice, any, any>;

export interface PluginDefinition<
  TID extends string = string,
  TSlice extends object = Record<string, JsonValue>,
  TMoves extends Record<string, AnyPluginMoveDefinition<TSlice>> = Record<string, AnyPluginMoveDefinition<TSlice>>,
> {
  id: TID;
  setup: () => TSlice;
  moves: TMoves;
}

export type AnyPlugin = PluginDefinition<string, any, any>;

/**
 * Reserved key on the host game's `G` where plugin slices live. Authors of host
 * games should avoid using this key in their own state.
 */
export const PLUGIN_STATE_KEY = "plugins" as const;

/**
 * Joiner used between a plugin id and a move name when registering the plugin
 * move on the host gamekit `moves` map. Two underscores avoids clashing with
 * existing single-underscore conventions.
 */
export const PLUGIN_MOVE_SEPARATOR = "__" as const;

export type PluginMoveName<TID extends string, TMoveName extends string> =
  `${TID}${typeof PLUGIN_MOVE_SEPARATOR}${TMoveName}`;

export interface PluginsState<TPlugins extends readonly AnyPlugin[]> {
  [PLUGIN_STATE_KEY]: PluginsSliceMap<TPlugins>;
}

export type PluginsSliceMap<TPlugins extends readonly AnyPlugin[]> = {
  [P in TPlugins[number] as P["id"]]: ReturnType<P["setup"]>;
};

// ---------------------------------------------------------------------------
// Authoring helpers
// ---------------------------------------------------------------------------

export function definePlugin<
  const TID extends string,
  TSlice extends object,
  const TMoves extends Record<string, AnyPluginMoveDefinition<TSlice>>,
>(
  plugin: PluginDefinition<TID, TSlice, TMoves>,
): PluginDefinition<TID, TSlice, TMoves> {
  return plugin;
}

export function definePluginMove<TSlice extends object, TArgs = undefined>(
  definition: PluginMoveDefinition<TSlice, TArgs>,
): PluginMoveDefinition<TSlice, TArgs> {
  return definition;
}

// ---------------------------------------------------------------------------
// Composition
// ---------------------------------------------------------------------------

/**
 * Compose a base gamekit definition with one or more plugins and finalize via
 * `defineGame`. The returned value is a fully wired `GameDefinition` ready to
 * pass to runtime / hosting / clients — callers do not need to wrap it in
 * `defineGame` again.
 *
 * The two public overloads mirror gamekit's `defineGame` (maxPlayers /
 * playerIDs forms) so contextual typing flows into the base author's `setup`,
 * `moves`, `views`, etc. — authoring a game with plugins is the same as
 * authoring one without.
 *
 * Plugin slices live at runtime under `G.plugins.<id>` (and ride along on the
 * player/public views); they are not surfaced on the static `TState`, since
 * doing so would force every host move's `patch` to acknowledge plugin keys
 * it never touches. Consumers reach into `G.plugins.<id>` via the plugin's
 * own typed accessors / the namespaced dispatch surface, not directly off the
 * host state.
 *
 * Plugins are merged in array order. Each plugin id must be unique within the
 * call; collisions throw at composition time so the error surfaces during
 * authoring rather than at first dispatch.
 */
// ---- maxPlayers form ----
export function withPlugins<
  TState extends object,
  TMoves extends Record<string, GamekitMoveDefinition<TState, any, any, any, TPlayers, AnyQueuedEvent, any>>,
  const TMaxPlayers extends number,
  TPhase extends string = "play",
  TPlayers extends PlayerList = DefaultPlayerIDsBoundLocal<TMaxPlayers>,
  TComputed extends ComputedMap<TState, TPhase, TPlayers> | undefined = ComputedMap<TState, TPhase, TPlayers> | undefined,
  TPublic = TState,
  TPlayer = TPublic,
  TCoreNode extends string = never,
  TProfile extends ReplayValue = ReplayValue,
  const TPlugins extends readonly AnyPlugin[] = readonly AnyPlugin[],
>(
  base: Omit<GamekitDefinition<TState, TMoves, TPhase, TPlayers, TComputed, TPublic, TPlayer, TCoreNode, TProfile>, "playerIDs" | "maxPlayers">
    & { maxPlayers: TMaxPlayers },
  plugins: TPlugins,
): CoreGameDefinitionFor<
  TState,
  TMoves,
  TPlayers,
  TPhase,
  TPublic & PluginsState<TPlugins>,
  TPlayer & PluginsState<TPlugins>,
  TCoreNode
>;
// ---- playerIDs form ----
export function withPlugins<
  TState extends object,
  TMoves extends Record<string, GamekitMoveDefinition<TState, any, any, any, TPlayers, AnyQueuedEvent, any>>,
  const TPlayers extends PlayerList,
  TPhase extends string = "play",
  TComputed extends ComputedMap<TState, TPhase, TPlayers> | undefined = ComputedMap<TState, TPhase, TPlayers> | undefined,
  TPublic = TState,
  TPlayer = TPublic,
  TCoreNode extends string = never,
  TProfile extends ReplayValue = ReplayValue,
  const TPlugins extends readonly AnyPlugin[] = readonly AnyPlugin[],
>(
  base: Omit<GamekitDefinition<TState, TMoves, TPhase, TPlayers, TComputed, TPublic, TPlayer, TCoreNode, TProfile>, "playerIDs" | "maxPlayers">
    & { playerIDs: TPlayers },
  plugins: TPlugins,
): CoreGameDefinitionFor<
  TState,
  TMoves,
  TPlayers,
  TPhase,
  TPublic & PluginsState<TPlugins>,
  TPlayer & PluginsState<TPlugins>,
  TCoreNode
>;
export function withPlugins<
  TState extends object,
  TMoves extends Record<string, GamekitMoveDefinition<TState, any, any, any, TPlayers, AnyQueuedEvent, any>>,
  TPhase extends string = "play",
  TPlayers extends PlayerList = PlayerList,
  TComputed extends ComputedMap<TState, TPhase, TPlayers> | undefined = ComputedMap<TState, TPhase, TPlayers> | undefined,
  TPublic = TState,
  TPlayer = TPublic,
  TCoreNode extends string = never,
  TProfile extends ReplayValue = ReplayValue,
  const TPlugins extends readonly AnyPlugin[] = readonly AnyPlugin[],
>(
  base: GamekitDefinition<TState, TMoves, TPhase, TPlayers, TComputed, TPublic, TPlayer, TCoreNode, TProfile>,
  plugins: TPlugins,
): CoreGameDefinitionFor<TState, TMoves, TPlayers, TPhase, TPublic, TPlayer, TCoreNode> {
  const seenIDs = new Set<string>();
  for (const plugin of plugins) {
    if (seenIDs.has(plugin.id)) {
      throw new Error(`withPlugins: duplicate plugin id "${plugin.id}".`);
    }
    seenIDs.add(plugin.id);
  }

  const baseSetup = base.setup as (context: unknown) => Record<string, unknown>;
  const wrappedSetup = (context: unknown) => {
    const baseState = baseSetup(context);
    const pluginSlices: Record<string, unknown> = {};
    for (const plugin of plugins) {
      pluginSlices[plugin.id] = plugin.setup();
    }
    if (PLUGIN_STATE_KEY in baseState) {
      throw new Error(
        `withPlugins: base game already defines a "${PLUGIN_STATE_KEY}" key on its state — that key is reserved for plugin slices.`,
      );
    }
    return { ...baseState, [PLUGIN_STATE_KEY]: pluginSlices };
  };

  const wrappedMoves = (helpers: { move: (def: unknown) => unknown; queue?: unknown }) => {
    const baseMoves = typeof base.moves === "function"
      ? (base.moves as (h: unknown) => Record<string, unknown>)(helpers)
      : (base.moves as Record<string, unknown>);

    // Wrap each base move with a `canPlayer` shim that enforces "current player
    // only" — this preserves the original turn semantics now that
    // `activePlayers` has been expanded to include every seated player (so
    // plugin moves are dispatchable off-turn). If the base move already
    // declares its own `canPlayer`, we leave it alone.
    const merged: Record<string, unknown> = {};
    for (const [moveName, baseMove] of Object.entries(baseMoves)) {
      merged[moveName] = wrapBaseMove(baseMove, helpers.move);
    }

    for (const plugin of plugins) {
      const pluginMoves = plugin.moves as Record<string, AnyPluginMoveDefinition>;
      for (const [moveName, definition] of Object.entries(pluginMoves)) {
        const namespacedName = `${plugin.id}${PLUGIN_MOVE_SEPARATOR}${moveName}`;
        if (Object.hasOwn(merged, namespacedName)) {
          throw new Error(
            `withPlugins: namespaced plugin move "${namespacedName}" collides with an existing move on the host game.`,
          );
        }
        merged[namespacedName] = wrapPluginMove(plugin.id, definition, helpers.move);
      }
    }

    return merged;
  };

  // Expand `activePlayers` for every known phase to include every seated
  // player. This is what unlocks off-turn plugin dispatch (chat, votes, ...) —
  // the core dispatch gate is `activePlayers.includes(playerID)`. We pair this
  // with the per-base-move `canPlayer = currentPlayer` shim above so the host
  // game's turn semantics still hold for its own moves.
  //
  // Phase names are derived the same way gamekit does: union of `initialPhase`,
  // explicit `phases` keys, and any move-level `phases` declarations. If we
  // can't find any (the typical single-phase game), fall back to `"play"`.
  const phaseNames = collectPhaseNames(base);
  const basePhases = (base.phases ?? {}) as Record<string, Record<string, unknown> | undefined>;
  const wrappedPhases: Record<string, Record<string, unknown>> = {};
  for (const phaseName of phaseNames) {
    const existing = basePhases[phaseName] ?? {};
    wrappedPhases[phaseName] = {
      ...existing,
      activePlayers: ({ turn }: { turn: { players: readonly string[] } }) => turn.players,
    };
  }

  const baseViews = (base.views ?? {}) as {
    player?: (context: unknown, player: unknown) => unknown;
    public?: (context: unknown) => unknown;
  };
  const wrappedViews: {
    player?: (context: { G: Record<string, unknown> }, player: unknown) => unknown;
    public?: (context: { G: Record<string, unknown> }) => unknown;
  } = {
    ...baseViews,
    ...(baseViews.player === undefined
      ? {}
      : {
          player: (context: { G: Record<string, unknown> }, player: unknown) => {
            const projected = baseViews.player!(context, player) as Record<string, unknown>;
            return mergePluginsIntoView(projected, context.G);
          },
        }),
    ...(baseViews.public === undefined
      ? {}
      : {
          public: (context: { G: Record<string, unknown> }) => {
            const projected = baseViews.public!(context) as Record<string, unknown>;
            return mergePluginsIntoView(projected, context.G);
          },
        }),
  };

  // The body composes definitions structurally (untyped) — gamekit re-walks
  // the value at runtime regardless of the static type. Funnel through
  // `unknown` to hand the composed value to `defineGame`'s pre-typed overload.
  const composed = {
    ...base,
    setup: wrappedSetup,
    moves: wrappedMoves,
    phases: wrappedPhases,
    views: wrappedViews,
  } as unknown as GamekitDefinition<TState, TMoves, TPhase, TPlayers, TComputed, TPublic, TPlayer, TCoreNode, TProfile>;

  // `defineGame`'s pre-typed overload still asks for `JsonCompatibilityChecks`,
  // which is a phantom branding constraint TS can't prove against generic
  // `TState`. The base author already passed those checks at their own site
  // (same `TState`), so funnel through `unknown` to skip the re-check.
  return defineGame(composed as unknown as Parameters<typeof defineGame>[0]) as unknown as CoreGameDefinitionFor<TState, TMoves, TPlayers, TPhase, TPublic, TPlayer, TCoreNode>;
}

function collectPhaseNames(base: {
  initialPhase?: string;
  phases?: Record<string, unknown>;
  moves: unknown;
}): string[] {
  const names = new Set<string>();
  if (typeof base.initialPhase === "string") {
    names.add(base.initialPhase);
  }
  if (base.phases !== undefined) {
    for (const key of Object.keys(base.phases)) {
      names.add(key);
    }
  }
  // Walk move-level `phases` declarations the same way gamekit does, so we
  // override `activePlayers` for every phase the engine will actually traverse.
  // Skip the `moves` walk if it's a factory function — we'd need helpers to
  // call it, and at composition time that's fine because the actual move
  // wrapping happens lazily inside `wrappedMoves` anyway.
  if (typeof base.moves === "object" && base.moves !== null) {
    for (const move of Object.values(base.moves as Record<string, unknown>)) {
      if (typeof move === "object" && move !== null && "phases" in move) {
        const movePhases = (move as { phases?: readonly string[] }).phases;
        if (Array.isArray(movePhases)) {
          for (const phase of movePhases) names.add(phase);
        }
      }
    }
  }
  if (names.size === 0) {
    names.add("play");
  }
  return [...names];
}

function wrapBaseMove(baseMove: unknown, moveFactory: (def: unknown) => unknown): unknown {
  if (typeof baseMove !== "object" || baseMove === null) {
    return baseMove;
  }
  const original = baseMove as { canPlayer?: unknown; run?: unknown };
  // If the host game already declared an explicit `canPlayer`, leave it
  // untouched — the author opted into custom permission logic.
  if (original.canPlayer !== undefined) {
    return baseMove;
  }
  return moveFactory({
    ...original,
    canPlayer: ({ player, turn }: { player: { id: string }; turn: { currentPlayer: string } }) =>
      player.id === turn.currentPlayer,
  });
}

function mergePluginsIntoView(
  projected: Record<string, unknown>,
  G: Record<string, unknown>,
): Record<string, unknown> {
  const slices = G[PLUGIN_STATE_KEY];
  if (slices === undefined) return projected;
  if (PLUGIN_STATE_KEY in projected) {
    return projected;
  }
  return { ...projected, [PLUGIN_STATE_KEY]: slices };
}

// ---------------------------------------------------------------------------
// Per-move wrapping
// ---------------------------------------------------------------------------

function wrapPluginMove(
  pluginID: string,
  definition: AnyPluginMoveDefinition,
  moveFactory: (def: unknown) => unknown,
): unknown {
  const wrapped = {
    args: definition.args,
    canPlayer: definition.canPlayer === undefined
      ? () => true
      : (context: PluginMovePermissionContext) => definition.canPlayer!({ player: context.player }),
    run(context: GamekitMoveRunContext) {
      const sliceFromState = readPluginSlice(context.G, pluginID);
      const outcome = definition.run({
        G: sliceFromState as never,
        args: context.args,
        player: context.player,
        rng: context.rng,
      });

      if (outcome.kind === "invalid") {
        return context.move.invalid(outcome.reason, outcome.details);
      }

      // outcome.kind === "stay" — apply the slice patch as a host-state patch
      // that replaces only the plugin's slice inside `G.plugins`.
      const nextSlice = outcome.patch === undefined
        ? sliceFromState
        : { ...sliceFromState, ...outcome.patch };
      const nextPluginsMap = {
        ...((context.G as Record<string, unknown>)[PLUGIN_STATE_KEY] as Record<string, unknown> | undefined),
        [pluginID]: nextSlice,
      };
      return context.move.stay({ [PLUGIN_STATE_KEY]: nextPluginsMap });
    },
  };

  return moveFactory(wrapped);
}

function readPluginSlice(G: unknown, pluginID: string): Record<string, unknown> {
  const root = G as Record<string, unknown> | undefined;
  const slices = root?.[PLUGIN_STATE_KEY] as Record<string, unknown> | undefined;
  const slice = slices?.[pluginID];
  if (slice === undefined || slice === null) {
    return {};
  }
  return slice as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Internal structural types — mirror the tiny slice of gamekit we touch.
// We do not import gamekit's own Move type to avoid the generic explosion that
// would otherwise leak through `withPlugins`'s public signature.
// ---------------------------------------------------------------------------

interface GamekitMoveHelpersMinimal {
  invalid: (reason?: string, details?: JsonValue) => unknown;
  stay: (patch?: Record<string, unknown>) => unknown;
}

interface GamekitMoveRunContext {
  G: unknown;
  args: unknown;
  player: PluginMovePlayerContext;
  rng: DeterministicRng;
  move: GamekitMoveHelpersMinimal;
}

export type { PlayerID };
