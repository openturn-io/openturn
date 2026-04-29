// Canonical state lives in @openturn/inspector. Re-exported here so existing
// imports (inspector-ui internal files, external consumers) keep working.
export {
  PLAYBACK_SPEEDS,
  createInitialInspectorState,
  inspectorReducer,
  getSelectedFrame,
  clampRevision,
  type InspectorMode,
  type RightRailPanel,
  type PlaybackSpeed,
  type PanelWidthsState,
  type InspectorState,
  type InspectorAction,
} from "@openturn/inspector";
