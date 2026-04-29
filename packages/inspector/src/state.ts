import type {
  InspectorFrame,
  InspectorTimeline,
} from "./index";

export type InspectorMode = "live" | "replay";
export type RightRailPanel = "inspector" | "graph";
export type PlaybackSpeed = 0.25 | 0.5 | 1 | 2 | 4;

export const PLAYBACK_SPEEDS: readonly PlaybackSpeed[] = [0.25, 0.5, 1, 2, 4];

export type PanelWidthKey = "left" | "right" | "graph";

export interface PanelWidthsState {
  left: number;
  right: number;
  graph: number;
}

export const DEFAULT_PANEL_WIDTHS = {
  left: 280,
  right: 320,
  graph: 640,
} as const;

export const PANEL_WIDTH_LIMITS: Record<PanelWidthKey, { min: number; max: number }> = {
  left: { min: 200, max: 560 },
  right: { min: 260, max: 720 },
  graph: { min: 360, max: 1200 },
};

export function clampPanelWidth(key: PanelWidthKey, width: number): number {
  const { min, max } = PANEL_WIDTH_LIMITS[key];
  return Math.round(Math.min(max, Math.max(min, width)));
}

export interface InspectorState {
  mode: InspectorMode;
  selectedRevision: number;
  isPlaying: boolean;
  speed: PlaybackSpeed;
  leftPanelOpen: boolean;
  rightPanel: RightRailPanel | null;
  panelWidths: PanelWidthsState;
  dockCollapsed: boolean;
}

export type InspectorAction =
  | { type: "SET_MODE"; mode: InspectorMode }
  | { type: "SELECT_REVISION"; revision: number }
  | { type: "STEP_FORWARD" }
  | { type: "PLAY_TICK" }
  | { type: "STEP_BACKWARD" }
  | { type: "JUMP_TO_START" }
  | { type: "JUMP_TO_END" }
  | { type: "PLAY" }
  | { type: "PAUSE" }
  | { type: "SET_SPEED"; speed: PlaybackSpeed }
  | { type: "TOGGLE_LEFT_PANEL" }
  | { type: "TOGGLE_RIGHT_PANEL" }
  | { type: "TOGGLE_GRAPH_PANEL" }
  | { type: "SET_PANEL_WIDTH"; panel: PanelWidthKey; width: number }
  | { type: "HYDRATE_PANEL_WIDTHS"; widths: Partial<PanelWidthsState> }
  | { type: "TOGGLE_DOCK" }
  | { type: "RETURN_TO_LIVE" }
  | { type: "SYNC_LIVE_HEAD"; maxRevision: number };

export function createInitialInspectorState(): InspectorState {
  return {
    mode: "live",
    selectedRevision: 0,
    isPlaying: false,
    speed: 1,
    leftPanelOpen: false,
    rightPanel: null,
    panelWidths: {
      left: DEFAULT_PANEL_WIDTHS.left,
      right: DEFAULT_PANEL_WIDTHS.right,
      graph: DEFAULT_PANEL_WIDTHS.graph,
    },
    dockCollapsed: false,
  };
}

export function inspectorReducer(state: InspectorState, action: InspectorAction): InspectorState {
  switch (action.type) {
    case "SET_MODE":
      return { ...state, mode: action.mode, isPlaying: false };

    case "SELECT_REVISION":
      return {
        ...state,
        mode: "replay",
        selectedRevision: Math.max(0, action.revision),
        isPlaying: false,
      };

    case "STEP_FORWARD":
      return {
        ...state,
        mode: "replay",
        selectedRevision: state.selectedRevision + 1,
        isPlaying: false,
      };

    case "PLAY_TICK":
      return {
        ...state,
        mode: "replay",
        selectedRevision: state.selectedRevision + 1,
        isPlaying: true,
      };

    case "STEP_BACKWARD":
      return {
        ...state,
        mode: "replay",
        selectedRevision: Math.max(0, state.selectedRevision - 1),
        isPlaying: false,
      };

    case "JUMP_TO_START":
      return {
        ...state,
        mode: "replay",
        selectedRevision: 0,
        isPlaying: false,
      };

    case "JUMP_TO_END":
      return { ...state, mode: "replay", isPlaying: false };

    case "PLAY":
      return { ...state, mode: "replay", isPlaying: true };

    case "PAUSE":
      return { ...state, isPlaying: false };

    case "SET_SPEED":
      return { ...state, speed: action.speed };

    case "TOGGLE_LEFT_PANEL":
      return { ...state, leftPanelOpen: !state.leftPanelOpen };

    case "TOGGLE_RIGHT_PANEL":
      if (state.rightPanel === "inspector") {
        return { ...state, rightPanel: null };
      }
      return { ...state, rightPanel: "inspector" };

    case "TOGGLE_GRAPH_PANEL":
      if (state.rightPanel === "graph") {
        return { ...state, rightPanel: null };
      }
      return { ...state, rightPanel: "graph" };

    case "SET_PANEL_WIDTH": {
      const clamped = clampPanelWidth(action.panel, action.width);
      if (state.panelWidths[action.panel] === clamped) {
        return state;
      }
      return {
        ...state,
        panelWidths: { ...state.panelWidths, [action.panel]: clamped },
      };
    }

    case "HYDRATE_PANEL_WIDTHS": {
      const next = { ...state.panelWidths };
      let changed = false;
      for (const key of Object.keys(action.widths) as PanelWidthKey[]) {
        const v = action.widths[key];
        if (v === undefined) {
          continue;
        }
        const clamped = clampPanelWidth(key, v);
        if (next[key] !== clamped) {
          next[key] = clamped;
          changed = true;
        }
      }
      return changed ? { ...state, panelWidths: next } : state;
    }

    case "TOGGLE_DOCK":
      return { ...state, dockCollapsed: !state.dockCollapsed };

    case "RETURN_TO_LIVE":
      return { ...state, mode: "live", isPlaying: false };

    case "SYNC_LIVE_HEAD":
      if (state.mode === "live") {
        return { ...state, selectedRevision: action.maxRevision };
      }
      return state;

    default:
      return state;
  }
}

export function getSelectedFrame(
  timeline: InspectorTimeline,
  state: InspectorState,
): InspectorFrame {
  const maxRevision = timeline.frames.length - 1;

  if (state.mode === "live") {
    return timeline.frames[maxRevision]!;
  }

  const clamped = Math.min(Math.max(0, state.selectedRevision), maxRevision);
  return timeline.frames[clamped]!;
}

export function clampRevision(
  state: InspectorState,
  maxRevision: number,
): InspectorState {
  if (state.selectedRevision > maxRevision) {
    return { ...state, selectedRevision: maxRevision };
  }
  return state;
}
