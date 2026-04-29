import {
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import type {
  AnyGame,
  GamePlayers,
  MatchInput,
} from "@openturn/core";
import {
  buildInspectorTimelineFromSource,
  type InspectorTimeline,
} from "@openturn/inspector";
import type { OpenturnBindings, OpenturnMatchStore } from "@openturn/react";
import {
  materializeReplay,
  materializeSavedReplay,
  type ReplayTimeline,
  type SavedReplayEnvelope,
} from "@openturn/replay";

import { InspectorContext, type InspectorContextValue } from "./inspector-context";
import {
  createFrozenMatchStore,
  getReplayBatchByRevision,
  getReplayFrameByRevision,
} from "./match-store";
import { InspectorShell } from "./ui/inspector-shell";
import {
  createInitialInspectorState,
  getSelectedFrame,
  inspectorReducer,
} from "./inspector-state";

export interface InspectorProps<TGame extends AnyGame> {
  matchStore: OpenturnMatchStore<TGame>;
  match: MatchInput<GamePlayers<TGame>>;
  children: ReactNode;
  active?: boolean;
  playerID?: GamePlayers<TGame>[number];
}

type ReplayInspectorSourceProps<TGame extends AnyGame> =
  | {
      replayEnvelope: SavedReplayEnvelope<GamePlayers<TGame>>;
      replayTimeline?: never;
    }
  | {
      replayEnvelope?: never;
      replayTimeline: ReplayTimeline<TGame>;
    };

export type ReplayInspectorProps<TGame extends AnyGame> =
  ReplayInspectorSourceProps<TGame> & {
    children: ReactNode;
    playerID?: GamePlayers<TGame>[number];
  };

interface InspectorRootProps<TGame extends AnyGame> extends InspectorProps<TGame> {
  game: TGame;
  OpenturnProvider: OpenturnBindings<TGame>["OpenturnProvider"];
}

type ReplayInspectorRootProps<TGame extends AnyGame> = ReplayInspectorProps<TGame> & {
  game: TGame;
  OpenturnProvider: OpenturnBindings<TGame>["OpenturnProvider"];
};

export function createLocalInspector<TGame extends AnyGame>(bindings: OpenturnBindings<TGame>) {
  const { game, OpenturnProvider } = bindings;

  function Inspector(props: InspectorProps<TGame>) {
    return <InspectorRoot {...props} OpenturnProvider={OpenturnProvider} game={game} />;
  }

  return Inspector;
}

export function createSavedReplayInspector<TGame extends AnyGame>(bindings: OpenturnBindings<TGame>) {
  const { game, OpenturnProvider } = bindings;

  function ReplayInspector(props: ReplayInspectorProps<TGame>) {
    return <ReplayInspectorRoot {...props} OpenturnProvider={OpenturnProvider} game={game} />;
  }

  return ReplayInspector;
}

function InspectorRoot<TGame extends AnyGame>({
  active = true,
  matchStore,
  game,
  match,
  children,
  playerID,
  OpenturnProvider,
}: InspectorRootProps<TGame>) {
  const snapshot = useSyncExternalStore(
    matchStore.subscribe,
    () => matchStore.getSnapshot(),
    () => matchStore.getSnapshot(),
  );

  const replayTimeline = useMemo(() => {
    return materializeReplay(game, {
      actions: snapshot.meta.log,
      match,
      playerID,
    });
  }, [game, match, snapshot, playerID]);

  return (
    <InspectorRuntime
      OpenturnProvider={OpenturnProvider}
      active={active}
      canReturnToLive
      children={children}
      game={game}
      getLiveMatchStore={() => matchStore}
      replayTimeline={replayTimeline}
    />
  );
}

function ReplayInspectorRoot<TGame extends AnyGame>({
  children,
  game,
  playerID,
  replayEnvelope,
  replayTimeline,
  OpenturnProvider,
}: ReplayInspectorRootProps<TGame>) {
  const resolvedReplayTimeline = useMemo(() => {
    if (replayTimeline !== undefined) {
      return replayTimeline;
    }

    return materializeSavedReplay(game, {
      ...replayEnvelope,
      playerID: playerID ?? replayEnvelope.playerID,
    });
  }, [game, playerID, replayEnvelope, replayTimeline]);

  return (
    <InspectorRuntime
      OpenturnProvider={OpenturnProvider}
      active
      canReturnToLive={false}
      children={children}
      game={game}
      replayTimeline={resolvedReplayTimeline}
    />
  );
}

function InspectorRuntime<TGame extends AnyGame>({
  OpenturnProvider,
  active,
  canReturnToLive,
  children,
  game,
  getLiveMatchStore,
  replayTimeline,
}: {
  OpenturnProvider: OpenturnBindings<TGame>["OpenturnProvider"];
  active: boolean;
  canReturnToLive: boolean;
  children: ReactNode;
  game: TGame;
  getLiveMatchStore?: () => OpenturnMatchStore<TGame>;
  replayTimeline: ReplayTimeline<TGame>;
}) {
  const [state, dispatch] = useReducer(
    inspectorReducer,
    {
      canReturnToLive,
      maxRevision: replayTimeline.frames.length - 1,
    },
    createRuntimeInspectorState,
  );

  const timeline = useMemo<InspectorTimeline>(
    () => buildInspectorTimelineFromSource({ kind: "replay", timeline: replayTimeline, game }),
    [game, replayTimeline],
  );

  const maxRevision = timeline.frames.length - 1;
  const currentFrame = getSelectedFrame(timeline, state);
  const currentReplayFrame = getReplayFrameByRevision(replayTimeline.frames, currentFrame.revision);
  const effectiveRevision = state.mode === "live"
    ? maxRevision
    : Math.min(state.selectedRevision, maxRevision);

  useEffect(() => {
    if (canReturnToLive && state.mode === "live") {
      dispatch({ type: "SYNC_LIVE_HEAD", maxRevision });
    }
  }, [canReturnToLive, maxRevision, state.mode]);

  const playbackRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!state.isPlaying) {
      if (playbackRef.current !== null) {
        clearInterval(playbackRef.current);
        playbackRef.current = null;
      }
      return;
    }

    const intervalMs = 600 / state.speed;

    playbackRef.current = setInterval(() => {
      dispatch({ type: "PLAY_TICK" });
    }, intervalMs);

    return () => {
      if (playbackRef.current !== null) {
        clearInterval(playbackRef.current);
        playbackRef.current = null;
      }
    };
  }, [state.isPlaying, state.speed]);

  useEffect(() => {
    if (state.isPlaying && effectiveRevision >= maxRevision) {
      dispatch({ type: "PAUSE" });
    }
  }, [state.isPlaying, effectiveRevision, maxRevision]);

  const contextValue = useMemo<InspectorContextValue>(() => ({
    canReturnToLive,
    canReplay: true,
    state,
    dispatch,
    timeline,
    currentFrame,
    maxRevision,
    minReplayRevision: 0,
    effectiveRevision,
  }), [canReturnToLive, state, timeline, currentFrame, maxRevision, effectiveRevision]);

  const wrappedMatchStore = useMemo<OpenturnMatchStore<TGame>>(() => {
    if (canReturnToLive && (!active || state.mode === "live") && getLiveMatchStore !== undefined) {
      return getLiveMatchStore();
    }

    const replayBatch = getReplayBatchByRevision(replayTimeline.frames, currentReplayFrame.revision);
    const subscribeToUpdates = canReturnToLive && getLiveMatchStore !== undefined
      ? getLiveMatchStore().subscribe
      : undefined;

    return createFrozenMatchStore(
      game,
      currentReplayFrame.snapshot as ReturnType<OpenturnMatchStore<TGame>["getSnapshot"]>,
      replayBatch,
      subscribeToUpdates,
    );
  }, [active, canReturnToLive, currentReplayFrame, game, getLiveMatchStore, replayTimeline.frames, state.mode]);

  return (
    <InspectorContext.Provider value={contextValue}>
      <InspectorShell active={active}>
        <OpenturnProvider match={wrappedMatchStore}>{children}</OpenturnProvider>
      </InspectorShell>
    </InspectorContext.Provider>
  );
}

function createRuntimeInspectorState({
  canReturnToLive,
  maxRevision,
}: {
  canReturnToLive: boolean;
  maxRevision: number;
}) {
  const initialState = createInitialInspectorState();
  return {
    ...initialState,
    mode: canReturnToLive ? "live" as const : "replay" as const,
    selectedRevision: maxRevision,
  };
}
