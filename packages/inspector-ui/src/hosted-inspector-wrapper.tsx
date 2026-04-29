import {
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from "react";

import {
  compileGameGraph,
  GAME_QUEUE_SEMANTICS,
  getGameValidationReport,
  type AnyGame,
  type GameGraph,
  type GameQueueSemantics,
  type GameValidationReport,
} from "@openturn/core";
import {
  buildInspectorTimelineFromSource,
  hostedBatchEntriesFromProtocol,
  type HostedBatchEntry,
  type InspectorTimeline,
} from "@openturn/inspector";
import {
  createFrozenHostedMatchState,
  HostedMatchOverrideContext,
  type HostedMatchOverride,
  type HostedMatchState,
} from "@openturn/react";

import { InspectorContext, type InspectorContextValue } from "./inspector-context";
import {
  createInitialInspectorState,
  getSelectedFrame,
  inspectorReducer,
} from "./inspector-state";
import { InspectorShell } from "./ui/inspector-shell";

export interface HostedInspectorProps<TGame extends AnyGame> {
  active?: boolean;
  hostedState: HostedMatchState<TGame>;
  children: ReactNode;
}

/**
 * Drop-in inspector component for a live hosted match. Uses
 * `HostedMatchOverrideContext` to inject a frozen hosted-match state into the
 * subtree when the user scrubs into replay mode, so `useMatch()` inside the
 * children resolves to the replayed frame. Reach for
 * `bindings.useInspector()` in `@openturn/react` when you need a custom layout
 * around the timeline.
 */
export function createHostedInspectorFromGame<TGame extends AnyGame>(game: TGame) {
  const graph = compileGameGraph(game);
  const queueSemantics = GAME_QUEUE_SEMANTICS;
  // Default seating for validation: every declared player. The hosted match
  // provides the real seated subset via batches, so this is purely for the
  // structural game-validation report (which reads `match.players` to detect
  // unseated player IDs in `activePlayers` outputs).
  const defaultMatch = { players: game.playerIDs };

  function HostedInspector({
    active = true,
    hostedState,
    children,
  }: HostedInspectorProps<TGame>) {
    const validationReport = useMemo<GameValidationReport>(
      () => getGameValidationReport(game, { match: defaultMatch, now: 0, seed: "dev" }),
      [],
    );

    return (
      <HostedInspectorRuntime
        active={active}
        game={game}
        graph={graph}
        hostedState={hostedState}
        queueSemantics={queueSemantics}
        validationReport={validationReport}
      >
        {children}
      </HostedInspectorRuntime>
    );
  }

  return HostedInspector;
}

function HostedInspectorRuntime<TGame extends AnyGame>({
  active,
  children,
  game,
  graph,
  hostedState,
  queueSemantics,
  validationReport,
}: {
  active: boolean;
  children: ReactNode;
  game: TGame;
  graph: GameGraph;
  hostedState: HostedMatchState<TGame>;
  queueSemantics: GameQueueSemantics;
  validationReport: GameValidationReport;
}) {
  const { batchHistory, initialSnapshot } = hostedState;

  const entries = useMemo<HostedBatchEntry[]>(() => {
    if (initialSnapshot === null) {
      return [];
    }
    return hostedBatchEntriesFromProtocol(
      initialSnapshot as Parameters<typeof hostedBatchEntriesFromProtocol>[0],
      batchHistory as Parameters<typeof hostedBatchEntriesFromProtocol>[1],
    );
  }, [initialSnapshot, batchHistory]);

  const timeline = useMemo<InspectorTimeline>(
    () => buildInspectorTimelineFromSource({
      kind: "hosted",
      entries,
      graph,
      queueSemantics,
      validationReport,
    }),
    [entries, graph, queueSemantics, validationReport],
  );
  const firstReplayFrame = timeline.frames.find((frame) => frame.stepKind !== "initial") ?? null;
  const canReplay = firstReplayFrame !== null;
  const minReplayRevision = firstReplayFrame?.revision ?? 0;
  const effectiveTimeline = useMemo<InspectorTimeline>(
    () => !canReplay
      ? createEmptyHostedTimeline(graph, queueSemantics, validationReport)
      : timeline,
    [canReplay, graph, queueSemantics, timeline, validationReport],
  );

  const [state, dispatch] = useReducer(
    inspectorReducer,
    { maxRevision: Math.max(0, effectiveTimeline.frames.length - 1) },
    createRuntimeInspectorState,
  );

  const maxRevision = Math.max(0, effectiveTimeline.frames.length - 1);
  const selectedRevision = state.mode === "live"
    ? maxRevision
    : Math.min(Math.max(state.selectedRevision, minReplayRevision), maxRevision);
  const selectionState = state.mode === "live" || selectedRevision === state.selectedRevision
    ? state
    : { ...state, selectedRevision };
  const currentFrame = getSelectedFrame(effectiveTimeline, selectionState);
  const effectiveRevision = selectedRevision;

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

  const contextValue = useMemo<InspectorContextValue | null>(() => {
    if (currentFrame === null) {
      return null;
    }
    return {
      canReturnToLive: true,
      canReplay,
      state,
      dispatch,
      timeline: effectiveTimeline,
      currentFrame,
      maxRevision,
      minReplayRevision,
      effectiveRevision,
    };
  }, [canReplay, currentFrame, effectiveRevision, effectiveTimeline, maxRevision, minReplayRevision, state]);

  const overrideActive = active && canReplay && state.mode === "replay" && currentFrame !== null && currentFrame.stepKind !== "initial";

  const overrideValue = useMemo<HostedMatchOverride<AnyGame> | null>(() => {
    if (!overrideActive || currentFrame === null) {
      return null;
    }

    const frozenSnapshot = findHostedSnapshotAtRevision(
      initialSnapshot,
      batchHistory,
      currentFrame.revision,
    );
    const containingBatch = findBatchContainingRevision(
      batchHistory,
      currentFrame.revision,
    );

    return {
      active: true,
      state: createFrozenHostedMatchState({
        game,
        playerID: hostedState.playerID,
        roomID: hostedState.roomID,
        snapshot: frozenSnapshot,
        lastBatch: containingBatch,
        batchHistory,
        initialSnapshot,
        lastAcknowledgedActionID: hostedState.lastAcknowledgedActionID,
      }),
    } as unknown as HostedMatchOverride<AnyGame>;
  }, [
    overrideActive,
    currentFrame,
    batchHistory,
    game,
    hostedState.lastAcknowledgedActionID,
    hostedState.playerID,
    hostedState.roomID,
    initialSnapshot,
  ]);

  // Always mount the override provider so children don't remount when the
  // inspector toggles between live and replay modes. A conditional wrapper
  // would change the element type at this tree position, which React treats
  // as an unmount/remount — and that would reset the page's own useState
  // (e.g. `gameConnection` inside useHostedRoom) and tear down the hosted
  // WebSocket client, clearing the batch history and snapshot dots.
  return (
    <InspectorContext.Provider value={contextValue}>
      <InspectorShell active={active}>
        <HostedMatchOverrideContext.Provider value={overrideValue}>
          {children}
        </HostedMatchOverrideContext.Provider>
      </InspectorShell>
    </InspectorContext.Provider>
  );
}

function createRuntimeInspectorState({ maxRevision }: { maxRevision: number }) {
  const initialState = createInitialInspectorState();
  return {
    ...initialState,
    mode: "live" as const,
    selectedRevision: maxRevision,
  };
}

function createEmptyHostedTimeline(
  graph: GameGraph,
  queueSemantics: GameQueueSemantics,
  validationReport: GameValidationReport,
): InspectorTimeline {
  return {
    frames: [
      {
        revision: 0,
        turn: 0,
        stepKind: "initial",
        eventName: null,
        actionID: null,
        playerID: null,
        payload: null,
        snapshot: null,
        playerView: null,
        transition: null,
        evaluations: [],
        diffs: [],
        controlSummary: null,
        controlHandoff: null,
        graphHighlight: null,
      },
    ],
    graph,
    queueSemantics,
    validationReport,
  };
}

function findHostedSnapshotAtRevision(
  initialSnapshot: { revision: number } | null,
  batches: readonly { steps: readonly { snapshot: { revision: number } }[] }[],
  revision: number,
): any {
  if (initialSnapshot !== null && initialSnapshot.revision === revision) {
    return initialSnapshot;
  }
  for (const batch of batches) {
    for (const step of batch.steps) {
      if (step.snapshot.revision === revision) {
        return step.snapshot;
      }
    }
  }
  return null;
}

function findBatchContainingRevision<TBatch extends { revision: number; steps: readonly unknown[] }>(
  batches: readonly TBatch[],
  revision: number,
): TBatch | null {
  for (const batch of batches) {
    const firstRevision = batch.revision - batch.steps.length + 1;
    if (revision >= firstRevision && revision <= batch.revision) {
      return batch;
    }
  }
  return null;
}
