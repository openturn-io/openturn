import {
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";

import type { BridgeHost } from "@openturn/bridge";
import {
  compileGameGraph,
  GAME_QUEUE_SEMANTICS,
  getGameValidationReport,
  type AnyGame,
  type GameGraph,
  type GamePlayers,
  type GameQueueSemantics,
  type GameValidationReport,
} from "@openturn/core";
import {
  buildInspectorTimelineFromSource,
  hostedBatchEntriesFromProtocol,
  type HostedBatchEntry,
  type InspectorLiveInitialPayload,
  type InspectorTimeline,
} from "@openturn/inspector";
import {
  materializeSavedReplay,
  type ReplayTimeline,
  type SavedReplayEnvelope,
} from "@openturn/replay";

import { InspectorContext, type InspectorContextValue } from "./inspector-context";
import {
  createInitialInspectorState,
  getSelectedFrame,
  inspectorReducer,
} from "./inspector-state";
import { InspectorShell } from "./ui/inspector-shell";

/**
 * Shell-owned inspector entry point. Pass one of:
 *  - `host`: live mode — subscribes to the bridge batch stream.
 *  - `timeline`: pre-built inspector timeline (e.g. loaded from cloud replay API).
 *  - `source` + `game`: saved-replay envelope + game definition (local use).
 */
export type InspectorPanelProps =
  | { host: BridgeHost; timeline?: never; source?: never; game?: never }
  | { host?: never; timeline: InspectorTimeline; source?: never; game?: never }
  | {
      host?: never;
      timeline?: never;
      source: SavedReplayEnvelope<GamePlayers<AnyGame>>;
      game: AnyGame;
    };

export function InspectorPanel(props: InspectorPanelProps): ReactNode {
  if ("host" in props && props.host !== undefined) {
    return <LiveInspectorPanel host={props.host} />;
  }
  if ("timeline" in props && props.timeline !== undefined) {
    return <StaticInspectorPanel timeline={props.timeline} />;
  }
  if ("source" in props && props.source !== undefined && props.game !== undefined) {
    return <ReplayInspectorPanel source={props.source} game={props.game} />;
  }
  return null;
}

function LiveInspectorPanel({ host }: { host: BridgeHost }) {
  const [initialPayload, setInitialPayload] = useState<InspectorLiveInitialPayload | null>(null);
  const [batches, setBatches] = useState<readonly any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    if (!startedRef.current) {
      startedRef.current = true;
      host.requestBatchStream().then((status) => {
        if (cancelled) return;
        if (status !== "allowed") {
          setError(
            status === "denied-by-game"
              ? "This game disabled the inspector."
              : "Inspector stream not available.",
          );
        }
      }).catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "inspector_unavailable");
      });
    }

    const offBatch = host.onBatch<InspectorLiveInitialPayload, any>((payload) => {
      if (cancelled) return;
      if (payload.initialSnapshot !== null) {
        setInitialPayload(payload.initialSnapshot);
      }
      if (payload.lastBatch !== null) {
        setBatches((prev) => {
          if (prev.includes(payload.lastBatch)) return prev;
          return [...prev, payload.lastBatch];
        });
      }
    });

    return () => {
      cancelled = true;
      offBatch();
    };
  }, [host]);

  const timeline = useMemo<InspectorTimeline | null>(() => {
    if (initialPayload === null) return null;
    const hosted = initialPayload.hostedSnapshot;
    if (hosted === null) return null;
    const entries: HostedBatchEntry[] = hostedBatchEntriesFromProtocol(
      {
        revision: (hosted as { revision: number }).revision,
        position: (hosted as { position: { turn: number } }).position,
        G: (hosted as { G: unknown }).G as never,
      },
      batches as never[],
    );
    return buildInspectorTimelineFromSource({
      kind: "hosted",
      entries,
      graph: initialPayload.graph,
      queueSemantics: initialPayload.queueSemantics,
      validationReport: initialPayload.validationReport,
    });
  }, [batches, initialPayload]);

  if (error !== null) {
    return <InspectorMessage message={error} />;
  }
  if (timeline === null) {
    return <InspectorMessage message="Waiting for game state…" />;
  }

  return <InspectorPanelRuntime timeline={timeline} canReturnToLive />;
}

function StaticInspectorPanel({ timeline }: { timeline: InspectorTimeline }) {
  return <InspectorPanelRuntime timeline={timeline} canReturnToLive={false} />;
}

function ReplayInspectorPanel({
  game,
  source,
}: {
  game: AnyGame;
  source: SavedReplayEnvelope<GamePlayers<AnyGame>>;
}) {
  const timeline = useMemo(() => {
    const replayTimeline: ReplayTimeline<AnyGame> = materializeSavedReplay(game, {
      ...source,
    });
    return buildInspectorTimelineFromSource({ kind: "replay", timeline: replayTimeline, game });
  }, [game, source]);
  const fallbackTimeline = useMemo<InspectorTimeline>(() => {
    if (timeline.frames.length > 0) return timeline;
    return emptyTimeline(
      compileGameGraph(game),
      structuredClone(GAME_QUEUE_SEMANTICS),
      safeValidationReport(game),
    );
  }, [game, timeline]);
  return <InspectorPanelRuntime timeline={fallbackTimeline} canReturnToLive={false} />;
}

function InspectorPanelRuntime({
  timeline,
  canReturnToLive,
}: {
  timeline: InspectorTimeline;
  canReturnToLive: boolean;
}) {
  const [state, dispatch] = useReducer(
    inspectorReducer,
    { maxRevision: Math.max(0, timeline.frames.length - 1) },
    ({ maxRevision }) => ({
      ...createInitialInspectorState(),
      mode: canReturnToLive ? ("live" as const) : ("replay" as const),
      selectedRevision: maxRevision,
    }),
  );

  const maxRevision = Math.max(0, timeline.frames.length - 1);
  const firstReplayFrame = timeline.frames.find((frame) => frame.stepKind !== "initial") ?? null;
  const canReplay = firstReplayFrame !== null;
  const minReplayRevision = firstReplayFrame?.revision ?? 0;
  const selectedRevision = state.mode === "live"
    ? maxRevision
    : Math.min(Math.max(state.selectedRevision, minReplayRevision), maxRevision);
  const selectionState = state.mode === "live" || selectedRevision === state.selectedRevision
    ? state
    : { ...state, selectedRevision };
  const currentFrame = getSelectedFrame(timeline, selectionState);
  const effectiveRevision = selectedRevision;

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

  const contextValue = useMemo<InspectorContextValue | null>(() => {
    if (currentFrame === null) return null;
    return {
      canReturnToLive,
      canReplay,
      state,
      dispatch,
      timeline,
      currentFrame,
      maxRevision,
      minReplayRevision,
      effectiveRevision,
    };
  }, [canReplay, canReturnToLive, currentFrame, effectiveRevision, maxRevision, minReplayRevision, state, timeline]);

  return (
    <InspectorContext.Provider value={contextValue}>
      <InspectorShell active>{null}</InspectorShell>
    </InspectorContext.Provider>
  );
}

function InspectorMessage({ message }: { message: string }) {
  return (
    <div
      style={{
        padding: "16px",
        fontSize: "13px",
        color: "var(--muted-foreground, #94a3b8)",
      }}
    >
      {message}
    </div>
  );
}

function emptyTimeline(
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

function safeValidationReport(game: AnyGame): GameValidationReport {
  try {
    return getGameValidationReport(game);
  } catch {
    return { diagnostics: [] } as unknown as GameValidationReport;
  }
}
