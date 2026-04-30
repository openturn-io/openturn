import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import {
  createGameBridge,
  BridgeUnavailableError,
  readBridgeFragmentFromLocation,
  type BridgeCapabilityPreset,
  type CapabilityEnableOptions,
  type GameBridge,
  type CreateGameBridgeOptions,
} from "@openturn/bridge";
import {
  createHostedClient,
  type HostedClientState,
  type HostedConnectionDescriptor,
  type HostedDispatchOutcome,
  type HostedSnapshot,
  type ProtocolValue,
} from "@openturn/client";
import type { BatchApplied, LobbyTransitionToGameMessage } from "@openturn/protocol";
import {
  buildLobbyView,
  useLobbyChannel,
  type LobbyChannelHandle,
  type LobbyView,
} from "@openturn/lobby/react";
import {
  compileGameGraph,
  createLocalSession,
  createLocalSessionFromSnapshot,
  GAME_QUEUE_SEMANTICS,
  getGameValidationReport,
  type AnyGame,
  type GameEventArgsTuple,
  type GameDispatchMap,
  type GameErrorResult,
  type GameGraph,
  type GamePlayers,
  type GamePlayerView,
  type GameQueueSemantics,
  type GameReplayData,
  type GameResultState,
  type GameSnapshot,
  type GameSuccessResult,
  type GameValidationReport,
  type LocalGameSessionOptions,
  type MatchInput,
} from "@openturn/core";
import {
  buildInspectorTimelineFromSource,
  clampPanelWidth,
  createInitialInspectorState,
  DEFAULT_PANEL_WIDTHS,
  getSelectedFrame,
  hostedBatchEntriesFromProtocol,
  inspectorReducer,
  type HostedBatchEntry,
  type InspectorAction,
  type InspectorFrame,
  type InspectorLiveInitialPayload,
  type InspectorState,
  type InspectorTimeline,
  type PanelWidthKey,
} from "@openturn/inspector";
import {
  materializeReplay,
  materializeSavedReplay,
  type ReplayTimeline,
  type SavedReplayEnvelope,
} from "@openturn/replay";

export type {
  HostedConnectionDescriptor,
  HostedDispatchOutcome,
  HostedSnapshot,
  ProtocolValue,
} from "@openturn/client";

export type SessionStatus = "ready" | "syncing" | "disconnected" | "error";
export type HostedMatchStatus = "idle" | "connecting" | "connected" | "disconnected" | "error";

export type DispatchSuccessResult = { ok: true };
export type DispatchResult = GameErrorResult | DispatchSuccessResult;
export type HostedDispatchResult =
  | { ok: true; clientActionID: string }
  | {
      ok: false;
      clientActionID?: string;
      error: string;
      details?: ProtocolValue;
      reason?: string;
    };

export type HostedDispatchMap<TGame extends AnyGame> = {
  [TEventName in keyof TGame["events"] & string]: (
    ...payload: GameEventArgsTuple<TGame["events"], TEventName>
  ) => Promise<HostedDispatchResult>;
};

export type HostedCanDispatchMap<TGame extends AnyGame> = {
  readonly [TEventName in keyof TGame["events"] & string]: boolean;
};

/**
 * Typed shortcut for the most recent action in a hosted match. Derived from
 * `lastBatch.steps[0]` when it is kind `"action"`. Use this instead of
 * reaching into `lastBatch.steps.find(s => s.kind === "action")?.event.payload` —
 * the event name is a discriminant, so narrowing on `last.event === "placeMark"`
 * types `last.payload` automatically.
 */
export type HostedLastAction<TGame extends AnyGame> = {
  [E in keyof TGame["events"] & string]: {
    event: E;
    payload: TGame["events"][E];
    playerID: string;
    actionID: string;
    turn: number;
    revision: number;
  };
}[keyof TGame["events"] & string];

function extractHostedLastAction<TGame extends AnyGame>(
  lastBatch: { revision: number; steps: readonly { kind: string; event: { type: string; event: string; payload: unknown; playerID: string | null; actionID: string; turn: number } }[] } | null,
): HostedLastAction<TGame> | null {
  if (lastBatch === null) return null;
  for (const step of lastBatch.steps) {
    if (step.kind !== "action") continue;
    const record = step.event;
    if (record.type !== "event" || record.playerID === null) continue;
    return {
      event: record.event as keyof TGame["events"] & string,
      payload: record.payload as TGame["events"][keyof TGame["events"] & string],
      playerID: record.playerID,
      actionID: record.actionID,
      turn: record.turn,
      revision: lastBatch.revision,
    } as HostedLastAction<TGame>;
  }
  return null;
}

export interface OpenturnMatchStore<
  TGame extends AnyGame,
  TMatch extends MatchInput<GamePlayers<TGame>> = MatchInput<GamePlayers<TGame>>,
> {
  readonly dispatch: GameDispatchMap<TGame, TMatch>;
  getLastBatch(): GameSuccessResult<TGame>["batch"] | null;
  getReplayData(): GameReplayData<TGame, TMatch>;
  getSnapshot(): GameSnapshot<ReturnType<TGame["setup"]>, any, any, TMatch>;
  getPlayerView(playerID: TMatch["players"][number]): GamePlayerView<TGame>;
  getStatus(): SessionStatus;
  subscribe(listener: () => void): () => void;
  reset?(): void;
}

export interface LocalSavedSnapshot<
  TGame extends AnyGame,
  TMatch extends MatchInput<GamePlayers<TGame>> = MatchInput<GamePlayers<TGame>>,
> {
  initialNow: number;
  match: TMatch;
  seed: string;
  snapshot: GameSnapshot<ReturnType<TGame["setup"]>, any, any, TMatch>;
}

export interface OpenturnProviderProps<TGame extends AnyGame> {
  /**
   * Optional in-process match store. Use this to:
   *   • Swap the local match at runtime (e.g. load a saved game) when
   *     `createOpenturnBindings` was called with `runtime: "local"`.
   *   • Force in-process mode in tests/Storybook regardless of declared runtime.
   *
   * When omitted, the provider auto-resolves from the runtime declared in
   * `createOpenturnBindings`:
   *   • `runtime: "local"` → uses the `match` passed to `createOpenturnBindings`.
   *   • `runtime: "multiplayer"` → reads the `#openturn-bridge=…` URL fragment
   *     injected by the host shell (`openturn dev` locally, openturn-cloud in
   *     production). Both shells inject the same fragment shape, so one
   *     `<OpenturnProvider />` works in dev and prod with no code changes.
   */
  match?: OpenturnMatchStore<TGame, MatchInput<GamePlayers<TGame>>>
    | OpenturnMatchStore<TGame, any>;
  children: ReactNode;
}

export interface OpenturnMatchState<TGame extends AnyGame> {
  dispatch: OpenturnMatchStore<TGame>["dispatch"];
  game: TGame;
  lastBatch: GameSuccessResult<TGame>["batch"] | null;
  replayData: GameReplayData<TGame, MatchInput<GamePlayers<TGame>>>;
  snapshot: GameSnapshot<ReturnType<TGame["setup"]>, any, any, MatchInput<GamePlayers<TGame>>>;
  status: SessionStatus;
  reset: () => void;
  /** Per-player filtered view (hidden-info safe). */
  getPlayerView: (playerID: GamePlayers<TGame>[number]) => GamePlayerView<TGame>;
}

export interface HostedMatchState<
  TGame extends AnyGame = AnyGame,
  TPublicState = GamePlayerView<TGame>,
  TResult = GameResultState<TGame>,
> {
  activePlayers: readonly string[];
  batchHistory: readonly BatchApplied<TPublicState, TResult>[];
  canAct: (event: keyof TGame["events"] & string) => boolean;
  canDispatch: HostedCanDispatchMap<TGame>;
  disconnect: () => void;
  dispatch: HostedDispatchMap<TGame>;
  error: string | null;
  initialSnapshot: HostedSnapshot<TPublicState, TResult> | null;
  isActivePlayer: boolean;
  isFinished: boolean;
  /**
   * Typed shortcut for the player-authored action that produced `lastBatch`.
   * Null when no batch has been applied yet or the batch only contains internal
   * events. Narrow on `lastAction.event` to type the payload.
   */
  lastAction: HostedLastAction<TGame> | null;
  lastAcknowledgedActionID: string | null;
  lastBatch: BatchApplied<TPublicState, TResult> | null;
  playerID: string | null;
  reconnect: () => Promise<void>;
  requestResync: () => void;
  requestSync: () => void;
  result: TResult | null;
  roomID: string | null;
  self: { playerID: string; isActive: boolean } | null;
  snapshot: HostedSnapshot<TPublicState, TResult> | null;
  status: HostedMatchStatus;
}

export type HostedMatchOptions = CreateGameBridgeOptions & {
  retainBatchHistory?: boolean;
  /**
   * Author-side opt-out for the shell-owned inspector. When `"deny"`, the
   * bridge will respond to host-initiated stream requests with "denied-by-game".
   * Defaults to `"allow"`.
   */
  inspector?: "allow" | "deny";
};

/** @internal Consumed by the frozen hosted-match helpers only. */
interface HostedMatchHistory<
  TPublicState = ProtocolValue,
  TResult = ProtocolValue | null,
> {
  initialSnapshot: HostedSnapshot<TPublicState, TResult> | null;
  batches: readonly BatchApplied<TPublicState, TResult>[];
}

export interface HostedMatchOverride<
  TGame extends AnyGame = AnyGame,
  TPublicState = GamePlayerView<TGame>,
  TResult = GameResultState<TGame>,
> {
  active: boolean;
  state: HostedMatchState<TGame, TPublicState, TResult>;
}

export const HostedMatchOverrideContext = createContext<HostedMatchOverride<AnyGame> | null>(null);
const HostedMatchObserverContext = createContext(false);

interface UseHostedMatchOptions {
  retainBatchHistory?: boolean;
  /**
   * Optional GameBridge to register a batch source with. When provided, the
   * shell can call `host.requestBatchStream()` to pull initial snapshot + batches
   * over the bridge — used by the shell-owned inspector. Author-controlled opt-out
   * goes through `bridge.allowBatchStreaming(false)`.
   */
  inspectorBridge?: GameBridge | null;
}

/**
 * Configures the runtime + initial match for a game's bindings. The runtime is
 * the app-level deployment choice — the same game definition can be bound as
 * `"local"` (in-process, single-device) or `"multiplayer"` (server-authoritative
 * via the bridge). The provider resolves transport from this declaration plus
 * the URL fragment injected by the host shell.
 */
export interface CreateOpenturnBindingsOptions<TGame extends AnyGame> {
  /**
   * `"local"` — game runs in-process; provider uses `match` for the initial
   * state. Both `openturn dev` and openturn-cloud static-serve the bundle with
   * no server-side runtime.
   *
   * `"multiplayer"` — game runs on the server; provider connects via the
   * bridge fragment injected by the host shell (`openturn dev` or
   * openturn-cloud). `match` is unused.
   */
  runtime: "local" | "multiplayer";
  /**
   * Initial match for `runtime: "local"`. Required for local runtime; ignored
   * for multiplayer (the server holds match state).
   */
  match?: MatchInput<GamePlayers<TGame>>;
  /**
   * Hosted-mode options applied when the bridge fragment activates a hosted
   * match. Carries the bridge config (parent origin, custom `readInit`,
   * inspector opt-out, batch-history retention).
   */
  hosted?: HostedMatchOptions;
}

export interface OpenturnBindings<TGame extends AnyGame> {
  game: TGame;
  /**
   * The runtime declared at bindings-creation time. Mirrors the same value
   * stored in `app/openturn.ts` so consumers can branch without reaching for
   * the metadata file.
   */
  runtime: "local" | "multiplayer";
  OpenturnProvider: (props: OpenturnProviderProps<TGame>) => ReactNode;
  createLocalMatch: <
    const TMatch extends MatchInput<GamePlayers<TGame>>,
  >(
    options: LocalGameSessionOptions<TMatch["players"]> & {
      match: TMatch;
      initialSavedSnapshot?: LocalSavedSnapshot<TGame, TMatch>;
    },
  ) => OpenturnMatchStore<TGame, TMatch>;
  /**
   * Read the active match as a mode-discriminated view. Works inside any mode
   * published by `<OpenturnProvider>`. Narrow on `match.mode === "local"` /
   * `"hosted"` to access mode-specific state via `match.state.*`. `useRoom`
   * (hosted room state including lobby/bridge) complements this when the app
   * needs full-room UI in `runtime: "multiplayer"` bindings.
   */
  useMatch: () => MatchView<TGame>;
  /**
   * Build the inspector timeline + interaction state for the active match.
   * Returns null if no match is active (e.g. pre-connect). Pair with
   * `<InspectorShell>` from `@openturn/inspector-ui` to render.
   */
  useInspector: (
    options?: UseInspectorOptions<TGame>,
  ) => UseInspectorResult | null;
  /**
   * Build the inspector timeline for a saved replay envelope or a pre-
   * materialized timeline. Independent from the live match provider — use
   * this to power a standalone replay viewer.
   */
  useReplayInspector: (
    source: UseReplayInspectorSource<TGame>,
    options?: UseInspectorOptions<TGame>,
  ) => UseInspectorResult;
  /**
   * In `runtime: "multiplayer"` bindings rendered under a host shell (`openturn
   * dev` locally, openturn-cloud in production), returns the full
   * `HostedRoomState` — phase, lobby, game, bridge handle, invite URL. Throws
   * outside a hosted provider. Use this when the app needs lobby UI or
   * capability registration through `room.bridge.capabilities.enable(...)`.
   */
  useRoom: () => HostedRoomState<TGame>;
}

export interface UseInspectorOptions<TGame extends AnyGame> {
  /**
   * Override the player seat used to derive the player-view in the inspector
   * timeline. Defaults to the seat reported by the active match.
   */
  playerID?: GamePlayers<TGame>[number];
}

export type UseReplayInspectorSource<TGame extends AnyGame> =
  | { readonly envelope: SavedReplayEnvelope<GamePlayers<TGame>>; readonly timeline?: undefined }
  | { readonly envelope?: undefined; readonly timeline: ReplayTimeline<TGame> };

/**
 * Data returned by `useInspector` / `useReplayInspector`. Mirrors the
 * `InspectorContextValue` contract consumed by `<InspectorShell>` /
 * `<InspectorPanel>` from `@openturn/inspector-ui` — compatible by
 * structural typing.
 */
export interface UseInspectorResult {
  state: InspectorState;
  dispatch: (action: InspectorAction) => void;
  timeline: InspectorTimeline;
  currentFrame: InspectorFrame;
  canReturnToLive: boolean;
  canReplay: boolean;
  maxRevision: number;
  minReplayRevision: number;
  effectiveRevision: number;
}

// Discriminated union surfaced by useMatch(). Lets callers branch on `mode`
// without knowing the underlying transport. `local` wraps OpenturnMatchState
// (in-process); `hosted` wraps HostedMatchState (any bridge-backed transport
// — `openturn dev` and openturn-cloud both publish the same shape).
export type MatchView<TGame extends AnyGame> =
  | {
      mode: "local";
      snapshot: OpenturnMatchState<TGame>["snapshot"];
      dispatch: OpenturnMatchState<TGame>["dispatch"];
      status: SessionStatus;
      state: OpenturnMatchState<TGame>;
    }
  | {
      mode: "hosted";
      snapshot: HostedMatchState<TGame>["snapshot"];
      dispatch: HostedMatchState<TGame>["dispatch"];
      status: HostedMatchStatus;
      state: HostedMatchState<TGame>;
    };

const EMPTY_BATCH_HISTORY = Object.freeze([]) as readonly BatchApplied<any, any>[];

function buildValidationReportForBridge<TGame extends AnyGame>(game: TGame): GameValidationReport {
  try {
    return getGameValidationReport(game);
  } catch {
    // `getGameValidationReport` itself can throw (e.g. when the game's
    // `setup` runs into a bad runtime contract). The bridge handshake should
    // not fail the whole iframe handshake on a validation crash, so we fall
    // back to an empty "no diagnostics" report and let the host render the
    // game without inspector data.
    return {
      diagnostics: [],
      ok: true,
      summary: { byCode: [], errors: 0, warnings: 0 },
    };
  }
}

const IDLE_HOSTED_CLIENT_STATE = {
  error: null,
  lastAcknowledgedActionID: null,
  lastBatch: null,
  lastEvent: null,
  snapshot: null,
  status: "idle",
} satisfies HostedClientState<ProtocolValue, ProtocolValue | null>;

const openturnBindingsByGame = new WeakMap<AnyGame, OpenturnBindings<AnyGame>>();
const hostedMatchObserversByGame = new WeakMap<AnyGame, HostedMatchObserverEntry>();

interface HostedMatchObserverEntry {
  listeners: Set<() => void>;
  state: HostedMatchState<AnyGame, any, any> | null;
  subscribe(listener: () => void): () => void;
}

/**
 * Shell-integration helper. Use when an outer dev shell or host needs to
 * observe the hosted match state that an inner user-authored `<Page>` is
 * already rendering, without requiring the user to thread the state through
 * their tree. Wrap the user's subtree with `<HostedMatchShellObserver>` and
 * read the observed state from outside with `useShellHostedMatch(game)`.
 *
 * This is an out-of-band side channel; normal app code should use
 * `useMatch()` or `useRoom()` instead.
 */
export function HostedMatchShellObserver({ children }: { children: ReactNode }) {
  return (
    <HostedMatchObserverContext.Provider value>
      {children}
    </HostedMatchObserverContext.Provider>
  );
}

/**
 * Shell-integration hook. Returns the hosted match state currently published
 * into the `HostedMatchShellObserver` WeakMap keyed by `game`. Null until the
 * wrapped subtree mounts a hosted provider. See `HostedMatchShellObserver`.
 */
export function useShellHostedMatch<
  TGame extends AnyGame,
  TPublicState = GamePlayerView<TGame>,
  TResult = GameResultState<TGame>,
>(
  game: TGame,
): HostedMatchState<TGame, TPublicState, TResult> | null {
  const observer = getHostedMatchObserver(game);

  return useSyncExternalStore(
    observer.subscribe,
    () => observer.state as HostedMatchState<TGame, TPublicState, TResult> | null,
    () => observer.state as HostedMatchState<TGame, TPublicState, TResult> | null,
  );
}

function getHostedMatchObserver(game: AnyGame): HostedMatchObserverEntry {
  const existing = hostedMatchObserversByGame.get(game);

  if (existing !== undefined) {
    return existing;
  }

  const observer: HostedMatchObserverEntry = {
    listeners: new Set(),
    state: null,
    subscribe(listener) {
      observer.listeners.add(listener);
      return () => {
        observer.listeners.delete(listener);
      };
    },
  };
  hostedMatchObserversByGame.set(game, observer);
  return observer;
}

function publishHostedMatchObserverState<TGame extends AnyGame, TPublicState, TResult>(
  game: TGame,
  state: HostedMatchState<TGame, TPublicState, TResult>,
) {
  const observer = getHostedMatchObserver(game);

  if (observer.state === (state as unknown)) {
    return;
  }

  // Observers are keyed by `AnyGame` in a shared WeakMap so a single
  // module-level cache can host any number of distinct game definitions.
  // The stored type is erased to `HostedMatchState<AnyGame, any, any>` because
  // TS does not have key-dependent maps; per-game generic state is
  // re-asserted on read inside `useStoreState` below.
  observer.state = state as unknown as HostedMatchState<AnyGame, any, any>;
  for (const listener of observer.listeners) {
    listener();
  }
}

function createLocalMatchStore<
  TGame extends AnyGame,
  const TMatch extends MatchInput<GamePlayers<TGame>>,
>(
  game: TGame,
  options: LocalGameSessionOptions<TMatch["players"]> & {
    match: TMatch;
    initialSavedSnapshot?: LocalSavedSnapshot<TGame, TMatch>;
  },
): OpenturnMatchStore<TGame, TMatch> {
  const { initialSavedSnapshot, ...sessionOptions } = options;
  let session = initialSavedSnapshot !== undefined
    ? createLocalSessionFromSnapshot(game, {
        initialNow: initialSavedSnapshot.initialNow,
        match: initialSavedSnapshot.match,
        seed: initialSavedSnapshot.seed,
        snapshot: initialSavedSnapshot.snapshot as never,
      })
    : createLocalSession(game, sessionOptions);
  let lastBatch: GameSuccessResult<TGame>["batch"] | null = null;
  let snapshot = session.getState();
  let playerViews = new Map<TMatch["players"][number], GamePlayerView<TGame>>();
  const listeners = new Set<() => void>();

  const notify = () => {
    for (const listener of listeners) {
      listener();
    }
  };

  const refreshCaches = () => {
    snapshot = session.getState();
    playerViews = new Map<TMatch["players"][number], GamePlayerView<TGame>>();
  };

  // `Object.fromEntries` widens to `Record<string, …>`; the static target
  // is the typed dispatch map with one property per declared event. The
  // assertion is load-bearing — TS cannot preserve literal keys produced by
  // a runtime `Object.keys` iteration.
  const dispatch = Object.fromEntries(
    Object.keys(game.events).map((eventName) => [
      eventName,
      (playerID: TMatch["players"][number], ...payloadArgs: unknown[]) =>
        dispatchByEvent(playerID, eventName as keyof TGame["events"] & string, ...payloadArgs as never),
    ]),
  ) as unknown as OpenturnMatchStore<TGame, TMatch>["dispatch"];

  function dispatchByEvent<TEventName extends keyof TGame["events"] & string>(
    playerID: TMatch["players"][number],
    event: TEventName,
    ...payload: Parameters<OpenturnMatchStore<TGame, TMatch>["dispatch"][TEventName]> extends [any, ...infer TRest] ? TRest : never
  ): DispatchResult {
    const result = session.dispatch[event](playerID, ...payload as never);

    if (!result.ok) {
      return result;
    }

    lastBatch = result.batch;
    refreshCaches();
    notify();
    return { ok: true };
  }

  return {
    dispatch,
    getLastBatch() {
      return lastBatch;
    },
    getReplayData() {
      return session.getReplayData();
    },
    getSnapshot() {
      return snapshot;
    },
    getPlayerView(playerID) {
      const cachedPlayerView = playerViews.get(playerID);

      if (cachedPlayerView !== undefined) {
        return cachedPlayerView;
      }

      const nextPlayerView = session.getPlayerView(playerID);
      playerViews.set(playerID, nextPlayerView);
      return nextPlayerView;
    },
    getStatus() {
      return "ready";
    },
    subscribe(listener) {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
    reset() {
      session = createLocalSession(game, sessionOptions);
      lastBatch = null;
      refreshCaches();
      notify();
    },
  };
}

export function createOpenturnBindings<TGame extends AnyGame>(
  game: TGame,
  options?: CreateOpenturnBindingsOptions<TGame>,
): OpenturnBindings<TGame> {
  const cachedBindings = openturnBindingsByGame.get(game);

  // Bindings are cached per game definition. The first call wires the
  // runtime + initial match; later calls in the same process (e.g. a deploy
  // shell entry plus the user's experience component sharing the same game)
  // reuse the cached bindings and may omit `options`.
  //
  // `openturnBindingsByGame: WeakMap<AnyGame, OpenturnBindings<AnyGame>>` is
  // keyed by the game-definition identity. The cast restores the per-game
  // generic on retrieval — TS cannot express a "key-dependent" map type, so
  // the erasure on insert (line below `set(game, …)`) and re-narrowing on
  // read are the standard idiom for this pattern.
  if (cachedBindings !== undefined) {
    return cachedBindings as unknown as OpenturnBindings<TGame>;
  }

  if (options === undefined) {
    throw new Error(
      "createOpenturnBindings: the first call for a game must supply `{ runtime, match? }`. Later calls (with the same game definition) may omit options to reuse the cached bindings.",
    );
  }

  const { runtime, match: defaultMatchInput, hosted: hostedOptions = {} } = options;

  if (runtime === "local" && defaultMatchInput === undefined) {
    throw new Error(
      'createOpenturnBindings: `runtime: "local"` requires a `match` option (the initial match input).',
    );
  }

  // Lazily build the default local store so we don't run a session in
  // environments that never render the provider (e.g. SSR analyses).
  let defaultLocalStore: OpenturnMatchStore<TGame> | null = null;
  function getDefaultLocalStore(): OpenturnMatchStore<TGame> {
    if (defaultLocalStore === null) {
      defaultLocalStore = createLocalMatchStore(game, {
        match: defaultMatchInput as MatchInput<GamePlayers<TGame>>,
      }) as OpenturnMatchStore<TGame>;
    }
    return defaultLocalStore;
  }

  const MatchViewContext = createContext<MatchView<TGame> | null>(null);
  const HostedRoomContext = createContext<HostedRoomState<TGame> | null>(null);

  function createLocalMatch<const TMatch extends MatchInput<GamePlayers<TGame>>>(
    options: LocalGameSessionOptions<TMatch["players"]> & {
      match: TMatch;
      initialSavedSnapshot?: LocalSavedSnapshot<TGame, TMatch>;
    },
  ): OpenturnMatchStore<TGame, TMatch> {
    return createLocalMatchStore(game, options);
  }

  function OpenturnProvider({ match, children }: OpenturnProviderProps<TGame>) {
    // 1. Explicit match prop — used for in-test fixtures and load-saved-game
    //    swaps. Wins over the runtime declaration so tests don't need to
    //    rebuild bindings to exercise a multiplayer game's reducer locally.
    if (match !== undefined) {
      return <LocalMatchViewPublisher matchStore={match}>{children}</LocalMatchViewPublisher>;
    }

    // 2. runtime: "local" — use the match declared at bindings-creation time.
    if (runtime === "local") {
      return (
        <LocalMatchViewPublisher matchStore={getDefaultLocalStore()}>{children}</LocalMatchViewPublisher>
      );
    }

    // 3. runtime: "multiplayer" — both `openturn dev` (locally) and
    //    openturn-cloud (in production) inject the same `#openturn-bridge=…`
    //    URL fragment, so the same provider expression works in both shells.
    //    Tests/Storybook can also stub a `hosted.readInit` callback at
    //    bindings-creation time to bypass the URL-fragment lookup.
    const hasCustomReadInit = typeof hostedOptions.readInit === "function";
    const bridgeDetected = hasCustomReadInit
      || (typeof window !== "undefined" && readBridgeFragmentFromLocation() !== null);
    if (!bridgeDetected) {
      throw new Error(
        'OpenturnProvider: `runtime: "multiplayer"` requires a host shell. Run via `openturn dev` for local development or deploy via openturn-cloud for production. To exercise the game in tests, pass a `match` prop to force in-process mode.',
      );
    }
    return <HostedProviderInner options={hostedOptions}>{children}</HostedProviderInner>;
  }

  function LocalMatchViewPublisher({
    matchStore,
    children,
  }: {
    matchStore: OpenturnMatchStore<TGame>;
    children: ReactNode;
  }) {
    const snapshot = useSyncExternalStore(
      matchStore.subscribe,
      () => matchStore.getSnapshot(),
      () => matchStore.getSnapshot(),
    );
    const lastBatch = useSyncExternalStore(
      matchStore.subscribe,
      () => matchStore.getLastBatch(),
      () => matchStore.getLastBatch(),
    );
    const status = useSyncExternalStore(
      matchStore.subscribe,
      () => matchStore.getStatus(),
      () => matchStore.getStatus(),
    );

    const view = useMemo<MatchView<TGame>>(() => ({
      mode: "local",
      snapshot,
      dispatch: matchStore.dispatch,
      status,
      state: {
        dispatch: matchStore.dispatch,
        game,
        lastBatch,
        replayData: matchStore.getReplayData(),
        reset: matchStore.reset ?? (() => {}),
        snapshot,
        status,
        getPlayerView: (playerID) => matchStore.getPlayerView(playerID),
      },
    }), [matchStore, snapshot, lastBatch, status]);

    return <MatchViewContext.Provider value={view}>{children}</MatchViewContext.Provider>;
  }

  function HostedProviderInner({
    options,
    children,
  }: {
    options: HostedMatchOptions;
    children: ReactNode;
  }) {
    const room = useHostedRoom<TGame>(game, options);
    const view = useMemo<MatchView<TGame> | null>(() => {
      if (room.game === null) return null;
      return {
        mode: "hosted",
        snapshot: room.game.snapshot,
        dispatch: room.game.dispatch,
        status: room.game.status,
        state: room.game,
      };
    }, [room.game]);

    return (
      <HostedRoomContext.Provider value={room}>
        <MatchViewContext.Provider value={view}>{children}</MatchViewContext.Provider>
      </HostedRoomContext.Provider>
    );
  }

  function useMatch(): MatchView<TGame> {
    const view = useContext(MatchViewContext);
    if (view === null) {
      throw new Error("useMatch() must be used within an OpenturnProvider with an active match.");
    }
    return view;
  }

  function useRoom(): HostedRoomState<TGame> {
    const room = useContext(HostedRoomContext);
    if (room === null) {
      throw new Error(
        'useRoom() requires `runtime: "multiplayer"` bindings rendered under a host shell that injects an `#openturn-bridge=…` URL fragment (`openturn dev` or openturn-cloud).',
      );
    }
    return room;
  }

  function useInspectorInternal(
    options: UseInspectorOptions<TGame> | undefined,
  ): UseInspectorResult | null {
    const match = useContext(MatchViewContext);
    return useInspectorFromMatch(game, match, options);
  }

  function useReplayInspector(
    source: UseReplayInspectorSource<TGame>,
    options?: UseInspectorOptions<TGame>,
  ): UseInspectorResult {
    const timeline = useMemo<ReplayTimeline<TGame>>(() => {
      if (source.timeline !== undefined) return source.timeline;
      return materializeSavedReplay(game, {
        ...source.envelope,
        playerID: options?.playerID ?? source.envelope.playerID,
      });
    }, [source.envelope, source.timeline, options?.playerID]);
    return useInspectorTimelineRuntime(timeline, game, false);
  }

  const bindings: OpenturnBindings<TGame> = {
    createLocalMatch,
    game,
    runtime,
    OpenturnProvider,
    useMatch,
    useRoom,
    useInspector: useInspectorInternal,
    useReplayInspector,
  };

  openturnBindingsByGame.set(game, bindings as unknown as OpenturnBindings<AnyGame>);

  return bindings;
}

// ---------------------------------------------------------------------------
// Shared inspector timeline runtime used by useInspector / useReplayInspector.
// Matches the legacy `InspectorRuntime` behavior but returns data only — the
// UI shell lives in @openturn/inspector-ui.
// ---------------------------------------------------------------------------

// localStorage keys for panel-width persistence. Keep the `devtools` prefix so
// state carries over from the legacy @openturn/inspector-ui helper.
const PANEL_WIDTH_STORAGE_KEYS: Record<PanelWidthKey, string> = {
  left: "openturn.devtools.panel.width.left",
  right: "openturn.devtools.panel.width.right",
  graph: "openturn.devtools.panel.width.graph",
};

function loadPersistedPanelWidths(): Partial<Record<PanelWidthKey, number>> | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const out: Partial<Record<PanelWidthKey, number>> = {};
    for (const key of Object.keys(PANEL_WIDTH_STORAGE_KEYS) as PanelWidthKey[]) {
      const raw = localStorage.getItem(PANEL_WIDTH_STORAGE_KEYS[key]);
      if (raw === null) continue;
      const n = Number(raw);
      if (!Number.isFinite(n)) continue;
      out[key] = clampPanelWidth(key, n);
    }
    return Object.keys(out).length > 0 ? out : null;
  } catch {
    return null;
  }
}

function persistPanelWidth(key: PanelWidthKey, width: number): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(PANEL_WIDTH_STORAGE_KEYS[key], String(clampPanelWidth(key, width)));
  } catch {
    /* ignore quota / private-mode failures */
  }
}

function useInspectorTimelineRuntime<TGame extends AnyGame>(
  replayTimeline: ReplayTimeline<TGame>,
  game: TGame,
  canReturnToLive: boolean,
): UseInspectorResult {
  const [state, dispatch] = useReducer(
    inspectorReducer,
    { canReturnToLive, maxRevision: replayTimeline.frames.length - 1 },
    createInspectorRuntimeState,
  );

  // Hydrate panel widths from localStorage on mount, then auto-persist on
  // change. Lets any consumer of useInspector get panel persistence without
  // opting into <InspectorShell>.
  useEffect(() => {
    const loaded = loadPersistedPanelWidths();
    if (loaded !== null) {
      dispatch({ type: "HYDRATE_PANEL_WIDTHS", widths: loaded });
    }
  }, []);

  useEffect(() => {
    for (const key of Object.keys(state.panelWidths) as PanelWidthKey[]) {
      persistPanelWidth(key, state.panelWidths[key]);
    }
  }, [state.panelWidths]);

  const timeline = useMemo<InspectorTimeline>(
    () => buildInspectorTimelineFromSource({ kind: "replay", timeline: replayTimeline, game }),
    [game, replayTimeline],
  );

  const maxRevision = timeline.frames.length - 1;
  const currentFrame = getSelectedFrame(timeline, state);
  const effectiveRevision = state.mode === "live"
    ? maxRevision
    : Math.min(state.selectedRevision, maxRevision);

  useEffect(() => {
    if (canReturnToLive && state.mode === "live") {
      dispatch({ type: "SYNC_LIVE_HEAD", maxRevision });
    }
  }, [canReturnToLive, maxRevision, state.mode]);

  useEffect(() => {
    if (state.isPlaying && effectiveRevision >= maxRevision) {
      dispatch({ type: "PAUSE" });
    }
  }, [state.isPlaying, effectiveRevision, maxRevision]);

  return {
    state,
    dispatch,
    timeline,
    currentFrame,
    canReturnToLive,
    canReplay: true,
    maxRevision,
    minReplayRevision: 0,
    effectiveRevision,
  };
}

/**
 * Unified inspector hook used by both `useInspector` (match-backed) and the
 * replay-only variant. Hook-order stable: all reducer/memo/effect calls run in
 * the same order regardless of which mode is active — unused branches produce
 * empty timelines.
 */
function useInspectorFromMatch<TGame extends AnyGame>(
  game: TGame,
  match: MatchView<TGame> | null,
  options: UseInspectorOptions<TGame> | undefined,
): UseInspectorResult | null {
  const localState: OpenturnMatchState<TGame> | null =
    match?.mode === "local" ? match.state : null;
  const hostedState: HostedMatchState<TGame> | null =
    match !== null && match.mode !== "local" ? match.state : null;

  const graph = useMemo(() => compileGameGraph(game), [game]);
  const queueSemantics = GAME_QUEUE_SEMANTICS;
  const validationReport = useMemo<GameValidationReport>(
    () => buildValidationReportForBridge(game),
    [game],
  );

  const replayTimeline = useMemo<ReplayTimeline<TGame> | null>(() => {
    if (localState === null) return null;
    return materializeReplay(game, {
      actions: localState.snapshot.meta.log,
      match: localState.replayData.match as MatchInput<GamePlayers<TGame>>,
      ...(options?.playerID === undefined ? {} : { playerID: options.playerID }),
    }) as ReplayTimeline<TGame>;
  }, [game, localState, options?.playerID]);

  const hostedEntries = useMemo<HostedBatchEntry[]>(() => {
    if (hostedState === null || hostedState.initialSnapshot === null) return [];
    return hostedBatchEntriesFromProtocol(
      hostedState.initialSnapshot as Parameters<typeof hostedBatchEntriesFromProtocol>[0],
      hostedState.batchHistory as Parameters<typeof hostedBatchEntriesFromProtocol>[1],
    );
  }, [hostedState]);

  const timeline = useMemo<InspectorTimeline>(() => {
    if (replayTimeline !== null) {
      return buildInspectorTimelineFromSource({ kind: "replay", timeline: replayTimeline, game });
    }
    return buildInspectorTimelineFromSource({
      kind: "hosted",
      entries: hostedEntries,
      graph,
      queueSemantics,
      validationReport,
    });
  }, [replayTimeline, hostedEntries, game, graph, queueSemantics, validationReport]);

  const firstReplayFrame = timeline.frames.find((frame) => frame.stepKind !== "initial") ?? null;
  const canReplay = firstReplayFrame !== null;
  const minReplayRevision = firstReplayFrame?.revision ?? 0;
  const maxRevision = Math.max(0, timeline.frames.length - 1);
  const canReturnToLive = true;

  const [state, dispatch] = useReducer(
    inspectorReducer,
    { canReturnToLive, maxRevision },
    createInspectorRuntimeState,
  );

  const clampedSelection = state.mode === "live"
    ? maxRevision
    : Math.min(Math.max(state.selectedRevision, minReplayRevision), maxRevision);
  const selectionState = state.mode === "live" || clampedSelection === state.selectedRevision
    ? state
    : { ...state, selectedRevision: clampedSelection };
  const currentFrame = getSelectedFrame(timeline, selectionState);
  const effectiveRevision = clampedSelection;

  useEffect(() => {
    if (state.mode === "live") {
      dispatch({ type: "SYNC_LIVE_HEAD", maxRevision });
    }
  }, [maxRevision, state.mode]);

  useEffect(() => {
    if (!canReplay && state.mode !== "live") {
      dispatch({ type: "RETURN_TO_LIVE" });
    }
    if (!canReplay && state.isPlaying) {
      dispatch({ type: "PAUSE" });
    }
  }, [canReplay, state.isPlaying, state.mode]);

  useEffect(() => {
    if (canReplay && state.mode === "replay" && state.selectedRevision < minReplayRevision) {
      dispatch({ type: "SELECT_REVISION", revision: minReplayRevision });
    }
  }, [canReplay, minReplayRevision, state.mode, state.selectedRevision]);

  useEffect(() => {
    if (state.isPlaying && effectiveRevision >= maxRevision) {
      dispatch({ type: "PAUSE" });
    }
  }, [state.isPlaying, effectiveRevision, maxRevision]);

  if (match === null) return null;

  return {
    state,
    dispatch,
    timeline,
    currentFrame,
    canReturnToLive,
    canReplay,
    maxRevision,
    minReplayRevision,
    effectiveRevision,
  };
}

function createInspectorRuntimeState({
  canReturnToLive,
  maxRevision,
}: {
  canReturnToLive: boolean;
  maxRevision: number;
}): InspectorState {
  const initial = createInitialInspectorState();
  return {
    ...initial,
    mode: canReturnToLive ? "live" : "replay",
    selectedRevision: Math.max(0, maxRevision),
  };
}

function createHostedDispatchMap<TGame extends AnyGame>(
  game: TGame,
  dispatchEvent: (
    event: keyof TGame["events"] & string,
    payload: ProtocolValue,
  ) => Promise<HostedDispatchResult>,
): HostedDispatchMap<TGame> {
  // Same pattern as the local-store dispatch builder above:
  // `Object.fromEntries` widens to `Record<string, …>`; the typed
  // `HostedDispatchMap<TGame>` has one property per declared event. TS
  // cannot statically reconstruct the move-name keys from a runtime
  // `Object.keys` iteration, so the assertion is required.
  return Object.fromEntries(
    Object.keys(game.events).map((eventName) => [
      eventName,
      (...payloadArgs: unknown[]) => {
        const payload = payloadArgs[0] as ProtocolValue | undefined;
        return dispatchEvent(
          eventName as keyof TGame["events"] & string,
          payload ?? null,
        );
      },
    ]),
  ) as unknown as HostedDispatchMap<TGame>;
}

function hostedOutcomeToDispatchResult(
  outcome: HostedDispatchOutcome<unknown, unknown>,
): HostedDispatchResult {
  if (outcome.ok) {
    return { ok: true, clientActionID: outcome.clientActionID };
  }
  return {
    ok: false,
    clientActionID: outcome.clientActionID,
    error: outcome.error,
    ...(outcome.details === undefined ? {} : { details: outcome.details }),
    ...(outcome.reason === undefined ? {} : { reason: outcome.reason }),
  };
}

function createHostedCanDispatchMap<TGame extends AnyGame>(
  game: TGame,
  canDispatch: boolean,
): HostedCanDispatchMap<TGame> {
  return Object.fromEntries(
    Object.keys(game.events).map((eventName) => [eventName, canDispatch]),
  ) as HostedCanDispatchMap<TGame>;
}

function useHostedMatch<
  TGame extends AnyGame,
  TPublicState = GamePlayerView<TGame>,
  TResult = GameResultState<TGame>,
>(
  connection: HostedConnectionDescriptor | null,
  game: TGame,
  options: UseHostedMatchOptions = {},
): HostedMatchState<TGame, TPublicState, TResult> {
  const clientRef = useRef<ReturnType<typeof createHostedClient<TPublicState, TResult>> | null>(null);
  const [state, setState] = useState<HostedClientState<TPublicState, TResult>>(
    IDLE_HOSTED_CLIENT_STATE as HostedClientState<TPublicState, TResult>,
  );
  const observerEnabled = useContext(HostedMatchObserverContext);
  const inspectorBridge = options.inspectorBridge ?? null;
  const retainBatchHistory =
    options.retainBatchHistory === true || observerEnabled || inspectorBridge !== null;
  const override = useContext(HostedMatchOverrideContext);

  useEffect(() => {
    if (connection === null) {
      clientRef.current?.disconnect();
      clientRef.current = null;
      setState(IDLE_HOSTED_CLIENT_STATE as HostedClientState<TPublicState, TResult>);
      return;
    }

    const client = createHostedClient<TPublicState, TResult>({
      ...connection,
      retainBatchHistory,
    });
    clientRef.current = client;
    setState(client.getState());

    const unsubscribe = client.subscribe(() => {
      setState(client.getState());
    });

    let unregisterBatchSource: (() => void) | null = null;
    if (inspectorBridge !== null) {
      const batchListeners = new Set<(batch: BatchApplied<TPublicState, TResult>) => void>();
      let lastSeenBatch: BatchApplied<TPublicState, TResult> | null = client.getState().lastBatch;
      const unsubscribeFromClient = client.subscribe(() => {
        const batch = client.getState().lastBatch;
        if (batch === null || batch === lastSeenBatch) return;
        lastSeenBatch = batch;
        for (const listener of batchListeners) {
          try {
            listener(batch);
          } catch {}
        }
      });
      inspectorBridge.registerBatchSource({
        getInitialSnapshot: () => ({
          hostedSnapshot: client.getInitialSnapshot(),
          graph: compileGameGraph(game),
          queueSemantics: structuredClone(GAME_QUEUE_SEMANTICS),
          validationReport: buildValidationReportForBridge(game),
          playerID: connection.playerID,
          roomID: connection.roomID,
        } satisfies InspectorLiveInitialPayload<TPublicState, TResult>),
        subscribe: (listener) => {
          batchListeners.add(listener as typeof batchListeners extends Set<infer L> ? L : never);
          for (const batch of client.getBatchHistory()) {
            try {
              (listener as (b: BatchApplied<TPublicState, TResult>) => void)(batch);
            } catch {}
          }
          return () => batchListeners.delete(listener as typeof batchListeners extends Set<infer L> ? L : never);
        },
      });
      unregisterBatchSource = () => {
        unsubscribeFromClient();
        batchListeners.clear();
        inspectorBridge.registerBatchSource(null);
      };
    }

    void client.connect();

    return () => {
      unsubscribe();
      unregisterBatchSource?.();
      client.disconnect();

      if (clientRef.current === client) {
        clientRef.current = null;
      }
    };
  }, [connection, inspectorBridge, retainBatchHistory]);

  const liveState = useMemo<HostedMatchState<TGame, TPublicState, TResult>>(() => {
    const client = clientRef.current;
    const batchHistory = retainBatchHistory && client !== null ? client.getBatchHistory() : EMPTY_BATCH_HISTORY;
    const initialSnapshot = retainBatchHistory && client !== null ? client.getInitialSnapshot() : null;
    const status: HostedMatchStatus = state.status === "idle"
      ? "idle"
      : state.status === "connecting" || state.status === "authorizing"
        ? "connecting"
        : state.status === "connected"
          ? "connected"
          : state.status === "disconnected"
            ? "disconnected"
            : "error";
    const playerID = connection?.playerID ?? null;
    const activePlayers = state.snapshot?.derived.activePlayers ?? [];
    const result = state.snapshot?.result ?? null;
    const isFinished = result !== null;
    const isActivePlayer = playerID !== null && activePlayers.includes(playerID);
    const canDispatch = status === "connected" && state.snapshot !== null && !isFinished && isActivePlayer;

    return {
      activePlayers,
      batchHistory,
      canAct(event) {
        return canDispatch && Object.hasOwn(game.events, event);
      },
      canDispatch: createHostedCanDispatchMap(game, canDispatch),
      disconnect() {
        clientRef.current?.disconnect();
      },
      dispatch: createHostedDispatchMap(game, async (event, payload) => {
        const client = clientRef.current;

        if (client === null) {
          return {
            error: "not_connected",
            ok: false,
          };
        }

        try {
          const outcome = await client.dispatchEvent(event, payload);
          return hostedOutcomeToDispatchResult(outcome);
        } catch (error) {
          return {
            error: error instanceof Error ? error.message : "dispatch_failed",
            ok: false,
          };
        }
      }),
      error: state.error,
      initialSnapshot,
      isActivePlayer,
      isFinished,
      lastAction: extractHostedLastAction<TGame>(state.lastBatch),
      lastAcknowledgedActionID: state.lastAcknowledgedActionID,
      lastBatch: state.lastBatch,
      playerID,
      reconnect() {
        const client = clientRef.current;

        if (client === null) {
          return Promise.resolve();
        }

        client.disconnect();
        return client.connect();
      },
      requestResync() {
        clientRef.current?.requestResync();
      },
      requestSync() {
        clientRef.current?.requestSync();
      },
      result,
      roomID: connection?.roomID ?? null,
      self: playerID === null ? null : { playerID, isActive: isActivePlayer },
      snapshot: state.snapshot,
      status,
    };
  }, [connection, game, retainBatchHistory, state]);

  useEffect(() => {
    if (observerEnabled) {
      publishHostedMatchObserverState(game, liveState);
    }
  }, [game, liveState, observerEnabled]);

  if (override !== null && override.active) {
    // `HostedMatchOverrideContext` is typed `<AnyGame>` because a single
    // context can be supplied at any level of the tree regardless of which
    // game the consuming hook is bound to. The cast re-narrows to the
    // hook's `TGame` — TS cannot express "this context value matches my
    // local TGame," so it is the contributor's responsibility to feed
    // override state matching the surrounding game.
    return override.state as unknown as HostedMatchState<TGame, TPublicState, TResult>;
  }

  return liveState;
}


export function createFrozenHostedMatchState<
  TGame extends AnyGame,
  TPublicState = GamePlayerView<TGame>,
  TResult = GameResultState<TGame>,
>(input: {
  game: TGame;
  playerID: string | null;
  roomID: string | null;
  snapshot: HostedSnapshot<TPublicState, TResult> | null;
  lastBatch: BatchApplied<TPublicState, TResult> | null;
  batchHistory: readonly BatchApplied<TPublicState, TResult>[];
  initialSnapshot: HostedSnapshot<TPublicState, TResult> | null;
  lastAcknowledgedActionID: string | null;
}): HostedMatchState<TGame, TPublicState, TResult> {
  const {
    game,
    playerID,
    roomID,
    snapshot,
    lastBatch,
    batchHistory,
    initialSnapshot,
    lastAcknowledgedActionID,
  } = input;
  const activePlayers = snapshot?.derived.activePlayers ?? [];
  const result = snapshot?.result ?? null;
  const isFinished = result !== null;
  const isActivePlayer = playerID !== null && activePlayers.includes(playerID);

  return {
    activePlayers,
    batchHistory,
    canAct() {
      return false;
    },
    canDispatch: createHostedCanDispatchMap(game, false),
    disconnect() {},
    dispatch: createHostedDispatchMap(game, async () => ({
      error: "inspector_frozen",
      ok: false,
    })),
    error: null,
    initialSnapshot,
    isActivePlayer,
    isFinished,
    lastAction: extractHostedLastAction<TGame>(lastBatch),
    lastAcknowledgedActionID,
    lastBatch,
    playerID,
    async reconnect() {},
    requestResync() {},
    requestSync() {},
    result: result as TResult | null,
    roomID,
    self: playerID === null ? null : { playerID, isActive: isActivePlayer },
    snapshot,
    status: "connected",
  };
}

// ---------------------------------------------------------------------------
// useHostedRoom: phase-aware hook that composes a lobby WebSocket, the
// lobby->game handoff, and the existing game HostedMatch state.
// ---------------------------------------------------------------------------

export type HostedRoomPhase =
  | "idle"
  | "missing_backend"
  | "connecting"
  | "lobby"
  | "transitioning"
  | "game"
  | "closed"
  | "error";

export interface HostedRoomState<
  TGame extends AnyGame,
  TPublicState = GamePlayerView<TGame>,
  TResult = GameResultState<TGame>,
> {
  phase: HostedRoomPhase;
  error: string | null;
  roomID: string | null;
  userID: string | null;
  userName: string | null;
  isHost: boolean;
  inviteURL: string | null;
  lobby: LobbyView | null;
  game: HostedMatchState<TGame, TPublicState, TResult> | null;
  // The underlying GameBridge handle, when the iframe has been wired via a
  // `#openturn-bridge=...` fragment. Use `bridge.capabilities.enable(preset, ...)`
  // to advertise game utilities (new-game, share-invite, ...) to the shell.
  // `null` in local-dev or when the bridge init is missing.
  bridge: GameBridge | null;
}

function buildInviteURL(roomID: string | null): string | null {
  if (typeof window === "undefined") return null;
  if (roomID === null || roomID.length === 0) return null;
  try {
    const url = new URL(window.location.href);
    url.searchParams.set("room", roomID);
    return url.toString();
  } catch {
    return null;
  }
}

function useHostedRoom<
  TGame extends AnyGame,
  TPublicState = GamePlayerView<TGame>,
  TResult = GameResultState<TGame>,
>(
  game: TGame,
  options: HostedMatchOptions = {},
): HostedRoomState<TGame, TPublicState, TResult> {
  const { parent, readInit, refreshSkewSeconds, retainBatchHistory, inspector } = options;
  const inspectorMode = inspector ?? "allow";

  const backendHolder = useMemo(() => {
    try {
      return {
        backend: createGameBridge({
          ...(parent === undefined ? {} : { parent }),
          ...(readInit === undefined ? {} : { readInit }),
          ...(refreshSkewSeconds === undefined ? {} : { refreshSkewSeconds }),
        }),
        error: null as string | null,
      };
    } catch (error) {
      if (error instanceof BridgeUnavailableError) {
        return { backend: null as GameBridge | null, error: "missing_hosted_backend" };
      }
      return {
        backend: null as GameBridge | null,
        error: error instanceof Error ? error.message : "hosted_backend_unavailable",
      };
    }
  }, [parent, readInit, refreshSkewSeconds]);

  const backend = backendHolder.backend;
  useEffect(() => {
    if (backend === null) return;
    backend.allowBatchStreaming(inspectorMode !== "deny");
  }, [backend, inspectorMode]);
  const [gameConnection, setGameConnection] = useState<HostedConnectionDescriptor | null>(
    () => (backend?.init.scope === "game" ? backend.connection : null),
  );
  useEffect(() => {
    if (backend === null) return;
    backend.setMatchActive(backend.init.scope === "game" || gameConnection !== null);
  }, [backend, gameConnection]);

  const handleTransition = (message: LobbyTransitionToGameMessage) => {
    setGameConnection({
      roomID: message.roomID,
      playerID: message.playerID,
      getRoomToken: async () => message.roomToken,
      createSocketURL({ token }) {
        const url = new URL(message.websocketURL);
        url.searchParams.set("token", token);
        return url.toString();
      },
    });
  };

  const lobbyInput = useMemo(() => {
    if (backend === null) return null;
    if (backend.init.scope !== "lobby") return null;
    return {
      roomID: backend.init.roomID,
      userID: backend.init.userID,
      websocketURL: backend.init.websocketURL,
      onTransitionToGame: handleTransition,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backend]);

  const lobbyToken = backend?.init.scope === "lobby" ? backend.token : null;
  const channel = useLobbyChannel(lobbyInput, lobbyToken);

  const gameMatch = useHostedMatch<TGame, TPublicState, TResult>(
    gameConnection,
    game,
    {
      retainBatchHistory: retainBatchHistory === true,
      inspectorBridge: backend,
    },
  );

  return useMemo<HostedRoomState<TGame, TPublicState, TResult>>(() => {
    if (backend === null) {
      return {
        phase: backendHolder.error === "missing_hosted_backend" ? "missing_backend" : "error",
        error: backendHolder.error,
        roomID: null,
        userID: null,
        userName: null,
        isHost: false,
        inviteURL: null,
        lobby: null,
        game: null,
        bridge: null,
      };
    }

    const init = backend.init;
    const inviteURL = buildInviteURL(init.roomID);

    if (init.scope === "game") {
      return {
        phase: "game",
        error: null,
        roomID: init.roomID,
        userID: init.userID,
        userName: init.userName,
        isHost: init.isHost,
        inviteURL,
        lobby: null,
        game: gameMatch,
        bridge: backend,
      };
    }

    const lobbyFallback = resolveLobbyCapacityFallback(game, init);
    const lobbyView = buildLobbyView({
      channel,
      userID: init.userID,
      capacityFallback: lobbyFallback.targetCapacity,
      minPlayersFallback: lobbyFallback.minPlayers,
      maxPlayersFallback: lobbyFallback.maxPlayers,
      hostUserIDFallback: init.hostUserID ?? init.userID,
    });

    let phase: HostedRoomPhase;
    if (gameConnection !== null) {
      phase = "game";
    } else if (channel.status === "connecting" || channel.status === "idle") {
      phase = "connecting";
    } else if (channel.status === "error") {
      phase = "error";
    } else if (channel.status === "closed") {
      phase = "closed";
    } else if (channel.status === "transitioning") {
      phase = "transitioning";
    } else {
      phase = "lobby";
    }

    return {
      phase,
      error: channel.error,
      roomID: init.roomID,
      userID: init.userID,
      userName: init.userName,
      isHost: init.isHost,
      inviteURL,
      lobby: gameConnection === null ? lobbyView : null,
      game: gameConnection === null ? null : gameMatch,
      bridge: backend,
    };
  }, [backend, backendHolder.error, channel, gameConnection, gameMatch]);
}

function resolveLobbyCapacityFallback<TGame extends AnyGame>(
  game: TGame,
  init: GameBridge["init"],
): { targetCapacity: number; minPlayers: number; maxPlayers: number } {
  const gameMaxPlayers = game.playerIDs.length;
  const gameMinPlayers = (game as { minPlayers?: number }).minPlayers ?? gameMaxPlayers;
  const maxPlayers = positiveIntegerOr(init.maxPlayers, gameMaxPlayers);
  const minPlayers = positiveIntegerOr(init.minPlayers, Math.min(gameMinPlayers, maxPlayers));
  const targetCapacity = positiveIntegerOr(init.targetCapacity, maxPlayers);
  const resolvedMinPlayers = clampInteger(minPlayers, 1, maxPlayers);

  return {
    maxPlayers,
    minPlayers: resolvedMinPlayers,
    targetCapacity: clampInteger(targetCapacity, resolvedMinPlayers, maxPlayers),
  };
}

function positiveIntegerOr(value: number, fallback: number): number {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function clampInteger(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

// ---------------------------------------------------------------------------
// Shell-capability helpers
//
// Games advertise utilities to the hosting shell through the bridge's
// capability registry. The plumbing (effect + disposer + null-bridge guard) is
// identical in every game, so bundle it here.
// ---------------------------------------------------------------------------

/**
 * Enable a preset shell capability for the lifetime of the component. Handles
 * the effect, the disposer, and the null-bridge case. Pass `false` or `null`
 * for `preset` to conditionally skip registration.
 *
 * ```tsx
 * useCapability(room.bridge, "new-game", () => match.reset());
 * useCapability(room.bridge, "current-turn", async () => ({ turn }), { badge: turn });
 * ```
 *
 * Capabilities run inside the iframe, invoked by the shell over postMessage.
 * That round-trip drops the user-gesture, so APIs that require one
 * (`navigator.share`, `navigator.clipboard.writeText`, etc.) won't work from a
 * capability handler — keep those on the host shell side.
 *
 * The handler is always up-to-date via an internal ref, so you do not need to
 * memoize it. The effect re-registers when the preset, badge, or disabled flag
 * changes (or when the bridge changes).
 */
export function useCapability(
  bridge: GameBridge | null,
  preset: BridgeCapabilityPreset | false | null | undefined,
  handler: (args: unknown) => unknown | Promise<unknown>,
  options?: CapabilityEnableOptions,
): void {
  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  const optionsKey =
    preset === false || preset == null
      ? null
      : JSON.stringify({
          badge: options?.badge ?? null,
          disabled: options?.disabled ?? null,
        });

  useEffect(() => {
    if (bridge === null || preset === false || preset == null) return;
    const off = bridge.capabilities.enable(
      preset,
      (args) => handlerRef.current(args),
      options,
    );
    return () => {
      try { off(); } catch {}
    };
    // optionsKey is the stable serialization; options itself would trigger a
    // re-register on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridge, preset, optionsKey]);
}

// ---------------------------------------------------------------------------
// Dispatch error formatting
//
// Every hosted game writes the same switch statement mapping
// ProtocolErrorCode + reason → user-facing message. Ship a sensible default
// and let authors override per-reason.
// ---------------------------------------------------------------------------

export interface DispatchErrorLike {
  error: string;
  reason?: string;
  details?: ProtocolValue;
}

export interface FormatDispatchErrorOptions {
  /** Exact-match overrides keyed by `outcome.error`. */
  byError?: Readonly<Record<string, string>>;
  /** Exact-match overrides keyed by `outcome.reason`. Wins over `byError`. */
  byReason?: Readonly<Record<string, string>>;
  /** Message used when no mapping applies. Defaults to `"That move was rejected."`. */
  fallback?: string;
}

const DEFAULT_DISPATCH_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  ambiguous_transition: "The server could not decide how to apply that move.",
  dispatch_failed: "The move could not be sent.",
  disconnected: "Disconnected from the room before the move was confirmed.",
  game_over: "The match is already finished.",
  inactive_player: "It is not your turn.",
  inspector_frozen: "This view is a frozen snapshot — moves are disabled.",
  invalid_event: "That move is not allowed right now.",
  invalid_transition_result: "The server rejected that move.",
  non_serializable_args: "That move's payload could not be encoded.",
  not_connected: "Not connected to the room.",
  stale_revision: "That move was based on outdated state. Please retry.",
  unauthorized: "You are not authorized to make that move.",
  unknown_event: "That move is not defined for this game.",
  unknown_match: "The room is no longer available.",
  unknown_player: "That player is not seated in this match.",
};

/**
 * Map a rejected dispatch outcome to a user-facing string. Checks
 * `options.byReason[reason]` → `options.byError[error]` → a built-in default
 * table → `options.fallback`. Use directly on the `{ ok: false }` branch of
 * `await match.dispatch.X(...)`.
 *
 * ```ts
 * const outcome = await match.dispatch.placeMark({ row, col });
 * if (!outcome.ok) setMessage(formatDispatchError(outcome, {
 *   byReason: { occupied: "That square is already occupied." },
 * }));
 * ```
 */
export function formatDispatchError(
  outcome: DispatchErrorLike,
  options: FormatDispatchErrorOptions = {},
): string {
  const { byReason, byError, fallback = "That move was rejected." } = options;
  if (outcome.reason !== undefined && byReason !== undefined) {
    const overridden = byReason[outcome.reason];
    if (overridden !== undefined) return overridden;
  }
  if (byError !== undefined) {
    const overridden = byError[outcome.error];
    if (overridden !== undefined) return overridden;
  }
  return DEFAULT_DISPATCH_ERROR_MESSAGES[outcome.error] ?? fallback;
}

// ---------------------------------------------------------------------------
// <HostedRoom> — phase-routing component
//
// Every multiplayer app writes the same if/else tree over HostedRoomState.phase:
// missing_backend / connecting / lobby / game / closed / error. Ship a single
// component that owns that tree and takes render functions per phase.
// ---------------------------------------------------------------------------

export interface HostedRoomProps<
  TGame extends AnyGame,
  TPublicState = GamePlayerView<TGame>,
  TResult = GameResultState<TGame>,
> {
  room: HostedRoomState<TGame, TPublicState, TResult>;
  /** Renders while the lobby is live. */
  lobby: (
    lobby: NonNullable<HostedRoomState<TGame, TPublicState, TResult>["lobby"]>,
    room: HostedRoomState<TGame, TPublicState, TResult>,
  ) => ReactNode;
  /** Renders once the match has started. */
  game: (
    match: NonNullable<HostedRoomState<TGame, TPublicState, TResult>["game"]>,
    room: HostedRoomState<TGame, TPublicState, TResult>,
  ) => ReactNode;
  /** Pre-backend state (no bridge fragment, no dev provider). */
  missingBackend?: ReactNode;
  /** Fragment present, connecting to the lobby websocket. */
  connecting?: ReactNode;
  /** Transitioning from lobby to game (between lobby WS close and game WS open). */
  transitioning?: ReactNode;
  /** Room has closed cleanly (host left / closed). */
  closed?: ReactNode;
  /** Protocol-level error. */
  error?: (message: string) => ReactNode;
  /** Anything else — catches `"idle"` and serves as a default for un-overridden phases. */
  fallback?: ReactNode;
}

export function HostedRoom<
  TGame extends AnyGame,
  TPublicState = GamePlayerView<TGame>,
  TResult = GameResultState<TGame>,
>(props: HostedRoomProps<TGame, TPublicState, TResult>): ReactNode {
  const { room } = props;
  const fallback = props.fallback ?? null;

  if (room.phase === "missing_backend") {
    return props.missingBackend ?? fallback;
  }
  if (room.phase === "error") {
    return props.error?.(room.error ?? "room_error") ?? fallback;
  }
  if (room.phase === "closed") {
    return props.closed ?? fallback;
  }
  if (room.lobby !== null) {
    return props.lobby(room.lobby, room);
  }
  if (room.game !== null) {
    return props.game(room.game, room);
  }
  if (room.phase === "transitioning") {
    return props.transitioning ?? props.connecting ?? fallback;
  }
  if (room.phase === "connecting") {
    return props.connecting ?? fallback;
  }
  return fallback;
}

export type {
  BatchApplied,
  MatchInput,
};

/**
 * @deprecated Lobby exports moved to `@openturn/lobby/react`. Re-exported here
 * for backwards-compatibility; new code should import from `@openturn/lobby/react`
 * directly. The shim will be removed in a future major.
 */
export type {
  LobbyChannelHandle,
  LobbyChannelStatus,
  LobbyView,
  LobbyProps,
  LobbySeatButtonProps,
} from "@openturn/lobby/react";
export { Lobby, useLobbyChannel, buildLobbyView } from "@openturn/lobby/react";
