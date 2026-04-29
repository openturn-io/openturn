import { useCallback, useRef } from "react";

import {
  ArrowRight,
  ChevronDown,
  ChevronUp,
  ChevronsLeft,
  ChevronsRight,
  Circle,
  Network,
  PanelLeft,
  PanelRight,
  Pause,
  Play,
  SkipBack,
  SkipForward,
} from "lucide-react";

import { useInspector, type InspectorContextValue } from "../inspector-context";
import { PLAYBACK_SPEEDS, type PlaybackSpeed } from "../inspector-state";
import { Button } from "../components/ui/button";
import { cn } from "../lib/utils";

export function InspectorDock() {
  const { state, dispatch, timeline, effectiveRevision, maxRevision, minReplayRevision, canReplay } = useInspector();

  const onToggleDock = useCallback(() => {
    dispatch({ type: "TOGGLE_DOCK" });
  }, [dispatch]);

  return (
    <div
      className="ot-inspector__dock"
      data-collapsed={state.dockCollapsed}
    >
      <Button
        className="ot-inspector__dock-toggle h-6 w-full rounded-none font-mono text-[10px] tracking-wide"
        onClick={onToggleDock}
        type="button"
        variant="ghost"
      >
        {state.dockCollapsed
          ? (
              <>
                <ChevronUp data-icon="inline-start" />
                Inspector
              </>
            )
          : (
              <>
                <ChevronDown data-icon="inline-start" />
                Inspector
              </>
            )}
      </Button>

      {!state.dockCollapsed && (
        <>
          <TimelineTrack
            canReplay={canReplay}
            effectiveRevision={effectiveRevision}
            maxRevision={maxRevision}
            minReplayRevision={minReplayRevision}
            timeline={timeline}
          />
          <PlaybackControls />
        </>
      )}
    </div>
  );
}

function TimelineTrack({
  canReplay,
  effectiveRevision,
  maxRevision,
  minReplayRevision,
  timeline,
}: {
  canReplay: boolean;
  effectiveRevision: number;
  maxRevision: number;
  minReplayRevision: number;
  timeline: InspectorContextValue["timeline"];
}) {
  const { dispatch } = useInspector();
  const railRef = useRef<HTMLDivElement>(null);

  const replaySpan = maxRevision - minReplayRevision;
  const fillPct = replaySpan > 0
    ? ((effectiveRevision - minReplayRevision) / replaySpan) * 100
    : canReplay ? 100 : 0;

  const onRailClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const rail = railRef.current;
      if (!canReplay || rail === null) return;

      const rect = rail.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const revision = minReplayRevision + Math.round(pct * Math.max(0, maxRevision - minReplayRevision));
      dispatch({ type: "SELECT_REVISION", revision });
    },
    [canReplay, dispatch, maxRevision, minReplayRevision],
  );

  const onMarkerClick = useCallback(
    (revision: number) => (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!canReplay) return;
      dispatch({ type: "SELECT_REVISION", revision });
    },
    [canReplay, dispatch],
  );

  return (
    <div className="ot-inspector__timeline">
      <span className="ot-inspector__timeline-rev">
        {effectiveRevision}
      </span>

      <div className="ot-inspector__timeline-track">
        <div
          className="ot-inspector__timeline-rail"
          aria-disabled={!canReplay}
          ref={railRef}
          onClick={onRailClick}
        >
          <div
            className="ot-inspector__timeline-fill"
            style={{ width: `${fillPct}%` }}
          />
          <div className="ot-inspector__timeline-markers">
            {timeline.frames.map((frame) => {
              if (frame.stepKind === "initial") return null;
              const pct = replaySpan > 0
                ? ((frame.revision - minReplayRevision) / replaySpan) * 100
                : 100;
              const isActive = frame.revision === effectiveRevision;

              let className = "ot-inspector__timeline-marker";
              if (frame.stepKind === "action") {
                className += " ot-inspector__timeline-marker--action";
              } else {
                className += " ot-inspector__timeline-marker--internal";
              }
              if (isActive) {
                className += " ot-inspector__timeline-marker--active";
              }

              return (
                <div
                  className={className}
                  key={frame.revision}
                  onClick={onMarkerClick(frame.revision)}
                  style={{ left: `${pct}%` }}
                  title={`Rev ${frame.revision}: ${frame.eventName ?? "initial"}`}
                />
              );
            })}
          </div>
        </div>
      </div>

      <span className="ot-inspector__timeline-rev">
        {canReplay ? maxRevision : 0}
      </span>
    </div>
  );
}

function PlaybackControls() {
  const {
    state,
    dispatch,
    effectiveRevision,
    maxRevision,
    minReplayRevision,
    canReturnToLive,
    canReplay,
  } = useInspector();
  const canStepBackward = canReplay && effectiveRevision > minReplayRevision;
  const canStepForward = canReplay && effectiveRevision < maxRevision;

  const onJumpStart = useCallback(() => {
    if (canReplay) dispatch({ type: "SELECT_REVISION", revision: minReplayRevision });
  }, [canReplay, dispatch, minReplayRevision]);
  const onStepBack = useCallback(() => {
    if (canStepBackward) dispatch({ type: "STEP_BACKWARD" });
  }, [canStepBackward, dispatch]);
  const onPlayPause = useCallback(() => {
    if (!canReplay) return;
    dispatch({ type: state.isPlaying ? "PAUSE" : "PLAY" });
  }, [canReplay, dispatch, state.isPlaying]);
  const onStepForward = useCallback(() => {
    if (canStepForward) dispatch({ type: "STEP_FORWARD" });
  }, [canStepForward, dispatch]);
  const onJumpEnd = useCallback(() => {
    if (!canReplay) return;
    dispatch({ type: "JUMP_TO_END" });
    dispatch({ type: "SELECT_REVISION", revision: maxRevision });
  }, [canReplay, dispatch, maxRevision]);
  const onReturnToLive = useCallback(() => dispatch({ type: "RETURN_TO_LIVE" }), [dispatch]);
  const onToggleLeft = useCallback(() => dispatch({ type: "TOGGLE_LEFT_PANEL" }), [dispatch]);
  const onToggleRight = useCallback(() => dispatch({ type: "TOGGLE_RIGHT_PANEL" }), [dispatch]);
  const onToggleGraph = useCallback(() => dispatch({ type: "TOGGLE_GRAPH_PANEL" }), [dispatch]);

  const onSetSpeed = useCallback(
    (speed: PlaybackSpeed) => () => {
      if (canReplay) dispatch({ type: "SET_SPEED", speed });
    },
    [canReplay, dispatch],
  );

  const controlIconMuted = "text-muted-foreground group-hover/button:text-foreground";
  const controlIconOnPanel =
    "text-primary-foreground group-hover/button:text-primary-foreground";

  return (
    <div className="ot-inspector__controls">
      <Button
        className="size-7 border-border bg-[var(--ot-bg-raised)] hover:bg-[var(--ot-bg-hover)]"
        data-ot-accent={state.leftPanelOpen ? true : undefined}
        onClick={onToggleLeft}
        title="Action Log"
        type="button"
        variant="outline"
        size="icon-sm"
      >
        <PanelLeft
          className={cn("size-3.5", state.leftPanelOpen ? controlIconOnPanel : controlIconMuted)}
          data-icon="icon"
        />
      </Button>

      <div className="w-2 shrink-0" />

      <Button
        className="size-7 border-border bg-[var(--ot-bg-raised)] hover:bg-[var(--ot-bg-hover)]"
        disabled={!canStepBackward}
        onClick={onJumpStart}
        title="Jump to start"
        type="button"
        variant="outline"
        size="icon-sm"
      >
        <SkipBack className={cn("size-3.5", controlIconMuted)} data-icon="icon" />
      </Button>
      <Button
        className="size-7 border-border bg-[var(--ot-bg-raised)] hover:bg-[var(--ot-bg-hover)]"
        disabled={!canStepBackward}
        onClick={onStepBack}
        title="Step backward"
        type="button"
        variant="outline"
        size="icon-sm"
      >
        <ChevronsLeft className={cn("size-3.5", controlIconMuted)} data-icon="icon" />
      </Button>
      <Button
        className="size-7 border-border bg-[var(--ot-bg-raised)] hover:bg-[var(--ot-bg-hover)]"
        data-ot-accent={state.isPlaying ? true : undefined}
        disabled={!canReplay}
        onClick={onPlayPause}
        title={state.isPlaying ? "Pause" : "Play"}
        type="button"
        variant="outline"
        size="icon-sm"
      >
        {state.isPlaying
          ? (
              <Pause
                className={cn("size-3.5", state.isPlaying ? controlIconOnPanel : controlIconMuted)}
                data-icon="icon"
              />
            )
          : (
              <Play className={cn("size-3.5", controlIconMuted)} data-icon="icon" />
            )}
      </Button>
      <Button
        className="size-7 border-border bg-[var(--ot-bg-raised)] hover:bg-[var(--ot-bg-hover)]"
        disabled={!canStepForward}
        onClick={onStepForward}
        title="Step forward"
        type="button"
        variant="outline"
        size="icon-sm"
      >
        <ChevronsRight className={cn("size-3.5", controlIconMuted)} data-icon="icon" />
      </Button>
      <Button
        className="size-7 border-border bg-[var(--ot-bg-raised)] hover:bg-[var(--ot-bg-hover)]"
        disabled={!canStepForward}
        onClick={onJumpEnd}
        title="Jump to end"
        type="button"
        variant="outline"
        size="icon-sm"
      >
        <SkipForward className={cn("size-3.5", controlIconMuted)} data-icon="icon" />
      </Button>

      <div className="w-1 shrink-0" />

      {PLAYBACK_SPEEDS.map((speed) => (
        <Button
          className="h-[22px] min-w-0 border-border bg-[var(--ot-bg-raised)] px-1.5 font-mono text-[10px] text-muted-foreground hover:bg-[var(--ot-bg-hover)] hover:text-foreground"
          data-ot-accent={state.speed === speed ? true : undefined}
          disabled={!canReplay}
          key={speed}
          onClick={onSetSpeed(speed)}
          type="button"
          variant="outline"
          size="xs"
        >
          {`${speed}x`}
        </Button>
      ))}

      <div className="w-2 shrink-0" />

      <Button
        className={cn(
          "h-7 px-2.5 font-mono text-[10px] font-semibold tracking-wide",
          state.mode === "live" ? "" : "border-border bg-[var(--ot-bg-raised)] hover:bg-[var(--ot-bg-hover)]",
        )}
        disabled={!canReturnToLive}
        data-live={state.mode === "live"}
        data-ot-live={state.mode === "live" ? true : undefined}
        onClick={onReturnToLive}
        title="Return to live"
        type="button"
        variant="outline"
        size="sm"
      >
        {state.mode === "live" && canReturnToLive
          ? (
              <>
                <Circle className="size-2 fill-current" data-icon="inline-start" />
                LIVE
              </>
            )
          : (
              <>
                <ArrowRight className="size-3" data-icon="inline-start" />
                {canReturnToLive ? "LIVE" : "REPLAY"}
              </>
            )}
      </Button>

      <div className="w-2 shrink-0" />

      <Button
        className="size-7 border-border bg-[var(--ot-bg-raised)] hover:bg-[var(--ot-bg-hover)]"
        data-ot-accent={state.rightPanel === "graph" ? true : undefined}
        onClick={onToggleGraph}
        title="Graph view"
        type="button"
        variant="outline"
        size="icon-sm"
      >
        <Network
          className={cn("size-3.5", state.rightPanel === "graph" ? controlIconOnPanel : controlIconMuted)}
          data-icon="icon"
        />
      </Button>
      <Button
        className="size-7 border-border bg-[var(--ot-bg-raised)] hover:bg-[var(--ot-bg-hover)]"
        data-ot-accent={state.rightPanel === "inspector" ? true : undefined}
        onClick={onToggleRight}
        title="State Inspector"
        type="button"
        variant="outline"
        size="icon-sm"
      >
        <PanelRight
          className={cn("size-3.5", state.rightPanel === "inspector" ? controlIconOnPanel : controlIconMuted)}
          data-icon="icon"
        />
      </Button>
    </div>
  );
}
