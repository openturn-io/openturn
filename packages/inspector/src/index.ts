export {
  PLAYBACK_SPEEDS,
  DEFAULT_PANEL_WIDTHS,
  PANEL_WIDTH_LIMITS,
  clampPanelWidth,
  createInitialInspectorState,
  inspectorReducer,
  getSelectedFrame,
  clampRevision,
  type InspectorMode,
  type RightRailPanel,
  type PlaybackSpeed,
  type PanelWidthKey,
  type PanelWidthsState,
  type InspectorState,
  type InspectorAction,
} from "./state";

import {
  compileGameGraph,
  getGameControlSummary,
  getGameValidationReport,
  GAME_QUEUE_SEMANTICS,
  type AnyGame,
  type GameControlSummary,
  type GameGraph,
  type GameGraphNode,
  type GameGraphEdge,
  type GameObservedTransition,
  type GameQueueSemantics,
  type GameTransitionFamilyEvaluation,
  type ReplayValue,
} from "@openturn/core";
import {
  type ReplayCursor,
  type ReplayFrame,
  type ReplayTimeline,
} from "@openturn/replay";
import type {
  BatchApplied,
  MatchSnapshot,
  PlayerViewSnapshot,
  ProtocolValue,
} from "@openturn/protocol";
import type { GameValidationReport } from "@openturn/core";

// ---------------------------------------------------------------------------
// Shell-owned inspector live payloads
//
// Shape the game bridge ships to its hosting shell when the shell requests an
// inspector batch stream. Lives here (rather than `@openturn/react`) because
// both the producer (react, game-side) and the consumer (inspector-ui,
// shell-side) are inspector concerns — the types belong with the inspector
// domain, not the React binding.
// ---------------------------------------------------------------------------

export interface InspectorLiveInitialPayload<
  TPublicState = ProtocolValue,
  TResult = ProtocolValue | null,
> {
  hostedSnapshot:
    | MatchSnapshot<TPublicState, TResult>
    | PlayerViewSnapshot<TPublicState, TResult>
    | null;
  graph: GameGraph;
  queueSemantics: GameQueueSemantics;
  validationReport: GameValidationReport;
  playerID: string | null;
  roomID: string;
}

export type InspectorLiveBatchPayload<
  TPublicState = ProtocolValue,
  TResult = ProtocolValue | null,
> = BatchApplied<TPublicState, TResult>;

// ---------------------------------------------------------------------------
// Snapshot diff
// ---------------------------------------------------------------------------

export interface SnapshotDiffEntry {
  after: ReplayValue | null;
  before: ReplayValue | null;
  path: string;
}

// ---------------------------------------------------------------------------
// Normalized inspector frame — source-agnostic timeline entry
// ---------------------------------------------------------------------------

export type InspectorStepKind = "action" | "internal" | "initial";

export interface InspectorFrame {
  revision: number;
  turn: number;
  stepKind: InspectorStepKind;

  eventName: string | null;
  actionID: string | null;
  playerID: string | null;
  payload: ReplayValue | null;

  snapshot: ReplayValue;
  playerView: ReplayValue | null;

  transition: GameObservedTransition | null;
  evaluations: readonly GameTransitionFamilyEvaluation[];
  diffs: readonly SnapshotDiffEntry[];
  controlSummary: GameControlSummary | null;
  controlHandoff: InspectorControlHandoff | null;

  graphHighlight: InspectorGraphHighlight | null;
}

export type InspectorControlHandoffKind = "same" | "pass" | "shared" | "terminal" | "unknown";

export interface InspectorControlHandoff {
  beforeActivePlayers: readonly string[];
  afterActivePlayers: readonly string[];
  handoffKind: InspectorControlHandoffKind;
  handoffLabel: string;
  summary: string;
}

export interface InspectorGraphHighlight {
  currentNode: string;
  lastTraversedEdge: { from: string; to: string } | null;
  pendingTargets: readonly string[];
  matchedBranch: string | null;
  controlHandoff: InspectorControlHandoff;
}

export interface InspectorTimeline {
  frames: readonly InspectorFrame[];
  graph: GameGraph;
  queueSemantics: GameQueueSemantics;
  validationReport: GameValidationReport;
}

// ---------------------------------------------------------------------------
// Build normalized timeline from local replay (internal helper — callers use
// `buildInspectorTimelineFromSource`).
// ---------------------------------------------------------------------------

function buildReplayInspectorTimeline<TGame extends AnyGame>(
  timeline: ReplayTimeline<TGame>,
  game: TGame,
): InspectorTimeline {
  const firstFrame = timeline.frames[0]!;
  const validationReport = getGameValidationReport(game, {
    match: firstFrame.snapshot.meta.match,
    now: firstFrame.snapshot.meta.now,
    seed: firstFrame.snapshot.meta.seed,
  });
  const graph = compileGameGraph(game);

  const entries: HostedBatchEntry[] = timeline.frames.map((frame) => {
    const stepKind: InspectorStepKind =
      frame.step === null
        ? "initial"
        : frame.step.kind === "action"
          ? "action"
          : "internal";
    const transition = frame.step !== null ? structuredClone(frame.step.transition) : null;
    const evaluations = frame.step !== null ? structuredClone(frame.step.transition.evaluations) : [];
    return {
      revision: frame.revision,
      turn: frame.snapshot.position.turn,
      stepKind,
      eventName: frame.step?.event.event ?? null,
      actionID: frame.action?.actionID ?? null,
      playerID: frame.step?.event.playerID ?? null,
      payload: (frame.step?.event.payload ?? null) as ReplayValue | null,
      snapshot: frame.snapshot.G as ReplayValue,
      playerView: (frame.playerView ?? null) as ReplayValue | null,
      transition,
      evaluations,
      controlSummary: safeGetControlSummary(game, frame.snapshot as never),
    };
  });

  return buildInspectorTimelineCore(
    entries,
    graph,
    structuredClone(GAME_QUEUE_SEMANTICS),
    structuredClone(validationReport),
  );
}

// ---------------------------------------------------------------------------
// Unified entry point — normalizes either source into a timeline
// ---------------------------------------------------------------------------

export type InspectorSource<TGame extends AnyGame> =
  | { kind: "replay"; timeline: ReplayTimeline<TGame>; game: TGame }
  | {
      kind: "hosted";
      entries: readonly HostedBatchEntry[];
      graph: GameGraph;
      queueSemantics: GameQueueSemantics;
      validationReport: GameValidationReport;
    };

export function buildInspectorTimelineFromSource<TGame extends AnyGame>(
  source: InspectorSource<TGame>,
): InspectorTimeline {
  if (source.kind === "replay") {
    return buildReplayInspectorTimeline(source.timeline, source.game);
  }
  return buildInspectorTimelineCore(
    source.entries,
    source.graph,
    source.queueSemantics,
    source.validationReport,
  );
}

// Shared per-frame builder: walks entries, fills in diffs, control handoff,
// and graph highlight. Both branches of `buildInspectorTimelineFromSource`
// delegate here so the normalization rules live in exactly one place.
function buildInspectorTimelineCore(
  entries: readonly HostedBatchEntry[],
  graph: GameGraph,
  queueSemantics: GameQueueSemantics,
  validationReport: GameValidationReport,
): InspectorTimeline {
  const frames: InspectorFrame[] = [];

  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i]!;
    const prevEntry: HostedBatchEntry | null = i > 0 ? entries[i - 1]! : null;

    const transition = entry.transition ?? null;
    const evaluations = entry.evaluations ?? [];
    const diffs = prevEntry !== null
      ? diffReplayValues(prevEntry.snapshot, entry.snapshot)
      : [];

    const controlSummary = entry.controlSummary ?? null;
    const controlHandoff = buildControlHandoff(prevEntry?.controlSummary ?? null, controlSummary);
    const graphHighlight = buildGraphHighlight(transition, controlSummary, controlHandoff);

    frames.push({
      revision: entry.revision,
      turn: entry.turn,
      stepKind: entry.stepKind,
      eventName: entry.eventName,
      actionID: entry.actionID,
      playerID: entry.playerID,
      payload: entry.payload,
      snapshot: entry.snapshot,
      playerView: entry.playerView ?? null,
      transition,
      evaluations,
      diffs,
      controlSummary,
      controlHandoff,
      graphHighlight,
    });
  }

  return { frames, graph, queueSemantics, validationReport };
}

function buildGraphHighlight(
  transition: GameObservedTransition | null,
  controlSummary: GameControlSummary | null,
  controlHandoff: InspectorControlHandoff | null,
): InspectorGraphHighlight | null {
  if (controlSummary === null || controlHandoff === null) {
    return null;
  }

  return {
    currentNode: controlSummary.current.node,
    lastTraversedEdge: transition !== null
      ? { from: transition.from, to: transition.to }
      : null,
    pendingTargets: controlSummary.current.meta.pendingTargets as readonly string[],
    matchedBranch: transition?.resolver ?? null,
    controlHandoff,
  };
}

function safeGetControlSummary<TGame extends AnyGame>(
  game: TGame,
  snapshot: ReplayFrame<TGame>["snapshot"],
): GameControlSummary | null {
  try {
    return getGameControlSummary(game, snapshot as never);
  } catch {
    return null;
  }
}

function buildControlHandoff(
  previousControlSummary: GameControlSummary | null,
  controlSummary: GameControlSummary | null,
): InspectorControlHandoff | null {
  if (controlSummary === null) {
    return null;
  }

  const beforeActivePlayers = previousControlSummary?.activePlayers ?? [];
  const afterActivePlayers = controlSummary.activePlayers;
  const beforeLabel = formatPlayers(beforeActivePlayers);
  const afterLabel = formatPlayers(afterActivePlayers);

  if (previousControlSummary === null) {
    return {
      beforeActivePlayers: [],
      afterActivePlayers: [...afterActivePlayers],
      handoffKind: afterActivePlayers.length > 1 ? "shared" : afterActivePlayers.length === 0 ? "terminal" : "unknown",
      handoffLabel: afterActivePlayers.length === 0 ? "none" : afterActivePlayers.length > 1 ? "shared" : `Start: ${afterLabel}`,
      summary: afterActivePlayers.length === 0 ? "Starts with no active players" : afterActivePlayers.length > 1 ? `Starts shared with ${afterLabel}` : `Starts with ${afterLabel}`,
    };
  }

  if (afterActivePlayers.length === 0) {
    return {
      beforeActivePlayers: [...beforeActivePlayers],
      afterActivePlayers: [],
      handoffKind: "terminal",
      handoffLabel: "none",
      summary: beforeActivePlayers.length > 0 ? `Control leaves ${beforeLabel}` : "No active players remain",
    };
  }

  if (afterActivePlayers.length > 1) {
    return {
      beforeActivePlayers: [...beforeActivePlayers],
      afterActivePlayers: [...afterActivePlayers],
      handoffKind: "shared",
      handoffLabel: "shared",
      summary: `Shared control: ${afterLabel}`,
    };
  }

  if (beforeActivePlayers.length === 1 && beforeActivePlayers[0] === afterActivePlayers[0]) {
    return {
      beforeActivePlayers: [...beforeActivePlayers],
      afterActivePlayers: [...afterActivePlayers],
      handoffKind: "same",
      handoffLabel: `${beforeLabel} -> ${afterLabel}`,
      summary: `Control stays with ${afterLabel}`,
    };
  }

  return {
    beforeActivePlayers: [...beforeActivePlayers],
    afterActivePlayers: [...afterActivePlayers],
    handoffKind: beforeActivePlayers.length === 1 ? "pass" : "unknown",
    handoffLabel: beforeActivePlayers.length === 0 ? afterLabel : `${beforeLabel} -> ${afterLabel}`,
    summary: beforeActivePlayers.length === 1 ? `Control passes from ${beforeLabel} to ${afterLabel}` : `Control shifts to ${afterLabel}`,
  };
}

function formatPlayers(players: readonly string[]): string {
  if (players.length === 0) {
    return "none";
  }

  return players.map((playerID) => `P${playerID}`).join(", ");
}

// ---------------------------------------------------------------------------
// Build normalized timeline from hosted protocol batch traces
// ---------------------------------------------------------------------------

export interface HostedBatchEntry {
  revision: number;
  turn: number;
  stepKind: InspectorStepKind;
  eventName: string | null;
  actionID: string | null;
  playerID: string | null;
  payload: ReplayValue | null;
  snapshot: ReplayValue;
  playerView?: ReplayValue | null;
  transition?: GameObservedTransition | null;
  evaluations?: readonly GameTransitionFamilyEvaluation[];
  controlSummary?: GameControlSummary | null;
}

export interface ProtocolBatchInput {
  readonly revision: number;
  readonly steps: readonly ProtocolStepInput[];
}

export interface ProtocolStepInput {
  readonly kind: "action" | "internal";
  readonly event: {
    readonly actionID: string;
    readonly event: string;
    readonly payload: ReplayValue;
    readonly type: "event" | "internal";
    readonly playerID: string | null;
  };
  readonly snapshot: {
    readonly revision: number;
    readonly position: { readonly turn: number };
    readonly G: ReplayValue;
  };
  readonly transition: GameObservedTransition;
}

export interface ProtocolInitialSnapshotInput {
  readonly revision: number;
  readonly position: { readonly turn: number };
  readonly G: ReplayValue;
}

export function hostedBatchEntriesFromProtocol(
  initialSnapshot: ProtocolInitialSnapshotInput,
  batches: readonly ProtocolBatchInput[],
): HostedBatchEntry[] {
  const entries: HostedBatchEntry[] = [
    {
      revision: initialSnapshot.revision,
      turn: initialSnapshot.position.turn,
      stepKind: "initial",
      eventName: null,
      actionID: null,
      playerID: null,
      payload: null,
      snapshot: initialSnapshot.G,
      playerView: initialSnapshot.G,
      controlSummary: null,
    },
  ];

  let lastRevision = initialSnapshot.revision;

  for (const batch of batches) {
    for (const step of batch.steps) {
      if (step.snapshot.revision <= lastRevision) {
        continue;
      }
      lastRevision = step.snapshot.revision;

      entries.push({
        revision: step.snapshot.revision,
        turn: step.snapshot.position.turn,
        stepKind: step.kind,
        eventName: step.event.event,
        actionID: step.event.actionID,
        playerID: step.event.type === "event" ? step.event.playerID : null,
        payload: step.event.payload,
        snapshot: step.snapshot.G,
        playerView: step.snapshot.G,
        transition: step.transition,
        evaluations: step.transition.evaluations,
        controlSummary: null,
      });
    }
  }

  return entries;
}

// ---------------------------------------------------------------------------
// Cursor-based replay inspector. Lazy, imperative queries against a
// `ReplayCursor`. Most callers want `buildInspectorTimelineFromSource`
// (returns plain data); reach for this when you want to tie an inspector to a
// cursor's live position without materializing the full timeline upfront.
// ---------------------------------------------------------------------------

export interface CursorInspector<TGame extends AnyGame> {
  getControlSummary(): GameControlSummary;
  getCurrentFrame(): ReplayFrame<TGame>;
  getDiff(): readonly SnapshotDiffEntry[];
  getGraph(): GameGraph;
  getMatchedFamilyEvaluations(): readonly GameTransitionFamilyEvaluation[];
  getObservedTransition(): GameObservedTransition | null;
  getPreviousFrame(): ReplayFrame<TGame> | null;
  getQueueSemantics(): GameQueueSemantics;
  getRngTrace(): GameObservedTransition["rng"] | null;
  getValidationReport(): GameValidationReport;
}

export function createCursorInspector<TGame extends AnyGame>(
  cursor: ReplayCursor<TGame>,
  game: TGame,
): CursorInspector<TGame> {
  const initialFrame = cursor.getState().currentFrame;
  const validationReport = getGameValidationReport(game, {
    match: initialFrame.snapshot.meta.match,
    now: initialFrame.snapshot.meta.now,
    seed: initialFrame.snapshot.meta.seed,
  });

  return {
    getControlSummary() {
      return getGameControlSummary(game, this.getCurrentFrame().snapshot as never);
    },
    getCurrentFrame() {
      return cursor.getState().currentFrame;
    },
    getDiff() {
      const previous = this.getPreviousFrame();

      if (previous === null) {
        return [];
      }

      return diffReplayValues(previous.snapshot.G as ReplayValue, this.getCurrentFrame().snapshot.G as ReplayValue);
    },
    getGraph() {
      return compileGameGraph(game);
    },
    getMatchedFamilyEvaluations() {
      const current = this.getCurrentFrame();

      if (current.step === null) {
        return [];
      }

      return structuredClone(current.step.transition.evaluations);
    },
    getObservedTransition() {
      const current = this.getCurrentFrame();

      if (current.step === null) {
        return null;
      }

      return structuredClone(current.step.transition);
    },
    getPreviousFrame() {
      const state = cursor.getState();

      if (state.currentFrame.revision === 0) {
        return null;
      }

      cursor.undo();
      const previous = cursor.getState().currentFrame;
      cursor.redo();
      return previous;
    },
    getQueueSemantics() {
      return structuredClone(GAME_QUEUE_SEMANTICS);
    },
    getRngTrace() {
      const current = this.getCurrentFrame();

      if (current.step === null) {
        return null;
      }

      return structuredClone(current.step.transition.rng);
    },
    getValidationReport() {
      return structuredClone(validationReport);
    },
  };
}

export function diffReplayValues(
  before: ReplayValue,
  after: ReplayValue,
  path = "$",
): readonly SnapshotDiffEntry[] {
  if (isSameValue(before, after)) {
    return [];
  }

  if (Array.isArray(before) && Array.isArray(after)) {
    const length = Math.max(before.length, after.length);
    const diffs: SnapshotDiffEntry[] = [];

    for (let index = 0; index < length; index += 1) {
      diffs.push(...diffReplayValues(before[index] ?? null, after[index] ?? null, `${path}[${index}]`));
    }

    return diffs;
  }

  if (isRecord(before) && isRecord(after)) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    const diffs: SnapshotDiffEntry[] = [];

    for (const key of keys) {
      diffs.push(...diffReplayValues(before[key] ?? null, after[key] ?? null, `${path}.${key}`));
    }

    return diffs;
  }

  return [
    {
      after,
      before,
      path,
    },
  ];
}

function isRecord(value: ReplayValue): value is { readonly [key: string]: ReplayValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSameValue(left: ReplayValue, right: ReplayValue): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
