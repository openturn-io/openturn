import { describe, expect, test } from "vitest";

import type { InspectorTimeline, InspectorFrame } from "@openturn/inspector";

import {
  clampRevision,
  createInitialInspectorState,
  getSelectedFrame,
  inspectorReducer,
} from "./inspector-state";

function makeFrame(revision: number, stepKind: "initial" | "action" | "internal" = "action"): InspectorFrame {
  return {
    revision,
    turn: revision,
    stepKind,
    eventName: stepKind === "initial" ? null : "test",
    actionID: stepKind === "action" ? `act-${revision}` : null,
    playerID: "0",
    payload: null,
    snapshot: { value: revision },
    playerView: null,
    transition: null,
    evaluations: [],
    diffs: [],
    controlSummary: null,
    graphHighlight: null,
  };
}

function makeTimeline(frameCount: number): InspectorTimeline {
  const frames = Array.from({ length: frameCount }, (_, i) =>
    makeFrame(i, i === 0 ? "initial" : "action"),
  );

  return {
    frames,
    graph: { nodes: [], edges: [] },
    queueSemantics: { ordering: "fifo", priorities: "none", recursionLimit: null },
    validationReport: { ok: true, diagnostics: [], summary: { errors: 0, warnings: 0, info: 0 } },
  } as unknown as InspectorTimeline;
}

describe("inspector-state", () => {
  test("createInitialInspectorState returns live mode", () => {
    const state = createInitialInspectorState();
    expect(state.mode).toBe("live");
    expect(state.isPlaying).toBe(false);
    expect(state.speed).toBe(1);
    expect(state.leftPanelOpen).toBe(false);
    expect(state.rightPanel).toBeNull();
    expect(state.panelWidths.left).toBeGreaterThan(0);
    expect(state.panelWidths.right).toBeGreaterThan(0);
    expect(state.panelWidths.graph).toBeGreaterThan(0);
  });

  test("SELECT_REVISION switches to replay mode", () => {
    let state = createInitialInspectorState();
    state = inspectorReducer(state, { type: "SELECT_REVISION", revision: 3 });
    expect(state.mode).toBe("replay");
    expect(state.selectedRevision).toBe(3);
    expect(state.isPlaying).toBe(false);
  });

  test("STEP_FORWARD and STEP_BACKWARD adjust revision", () => {
    let state = createInitialInspectorState();
    state = inspectorReducer(state, { type: "SELECT_REVISION", revision: 5 });
    state = inspectorReducer(state, { type: "STEP_FORWARD" });
    expect(state.selectedRevision).toBe(6);

    state = inspectorReducer(state, { type: "STEP_BACKWARD" });
    expect(state.selectedRevision).toBe(5);

    state = inspectorReducer(state, { type: "SELECT_REVISION", revision: 0 });
    state = inspectorReducer(state, { type: "STEP_BACKWARD" });
    expect(state.selectedRevision).toBe(0);
  });

  test("RETURN_TO_LIVE restores live mode", () => {
    let state = createInitialInspectorState();
    state = inspectorReducer(state, { type: "SELECT_REVISION", revision: 3 });
    state = inspectorReducer(state, { type: "RETURN_TO_LIVE" });
    expect(state.mode).toBe("live");
  });

  test("PLAY and PAUSE toggle playback", () => {
    let state = createInitialInspectorState();
    state = inspectorReducer(state, { type: "PLAY" });
    expect(state.isPlaying).toBe(true);
    expect(state.mode).toBe("replay");

    state = inspectorReducer(state, { type: "PAUSE" });
    expect(state.isPlaying).toBe(false);
  });

  test("PLAY_TICK advances without pausing playback", () => {
    let state = createInitialInspectorState();
    state = inspectorReducer(state, { type: "SELECT_REVISION", revision: 1 });
    state = inspectorReducer(state, { type: "PLAY" });
    state = inspectorReducer(state, { type: "PLAY_TICK" });
    expect(state.selectedRevision).toBe(2);
    expect(state.isPlaying).toBe(true);
    expect(state.mode).toBe("replay");
  });

  test("SET_SPEED changes playback speed", () => {
    let state = createInitialInspectorState();
    state = inspectorReducer(state, { type: "SET_SPEED", speed: 4 });
    expect(state.speed).toBe(4);
  });

  test("left and right inspector can both be open", () => {
    let state = createInitialInspectorState();
    state = inspectorReducer(state, { type: "TOGGLE_LEFT_PANEL" });
    expect(state.leftPanelOpen).toBe(true);
    state = inspectorReducer(state, { type: "TOGGLE_RIGHT_PANEL" });
    expect(state.rightPanel).toBe("inspector");
    expect(state.leftPanelOpen).toBe(true);
  });

  test("graph replaces right inspector without affecting left", () => {
    let state = createInitialInspectorState();
    state = inspectorReducer(state, { type: "TOGGLE_LEFT_PANEL" });
    state = inspectorReducer(state, { type: "TOGGLE_RIGHT_PANEL" });
    expect(state.rightPanel).toBe("inspector");

    state = inspectorReducer(state, { type: "TOGGLE_GRAPH_PANEL" });
    expect(state.rightPanel).toBe("graph");
    expect(state.leftPanelOpen).toBe(true);

    state = inspectorReducer(state, { type: "TOGGLE_RIGHT_PANEL" });
    expect(state.rightPanel).toBe("inspector");
    expect(state.leftPanelOpen).toBe(true);
  });

  test("TOGGLE_GRAPH_PANEL opens and closes graph on the right rail", () => {
    let state = createInitialInspectorState();
    state = inspectorReducer(state, { type: "TOGGLE_GRAPH_PANEL" });
    expect(state.rightPanel).toBe("graph");
    state = inspectorReducer(state, { type: "TOGGLE_GRAPH_PANEL" });
    expect(state.rightPanel).toBeNull();
  });

  test("each width update only affects its own panel key", () => {
    const initial = createInitialInspectorState();
    let state = initial;
    state = inspectorReducer(state, { type: "SET_PANEL_WIDTH", panel: "left", width: 400 });
    expect(state.panelWidths.left).toBe(400);
    expect(state.panelWidths.right).toBe(initial.panelWidths.right);
    expect(state.panelWidths.graph).toBe(initial.panelWidths.graph);

    state = inspectorReducer(state, { type: "SET_PANEL_WIDTH", panel: "graph", width: 600 });
    expect(state.panelWidths.graph).toBe(600);
    expect(state.panelWidths.right).toBe(initial.panelWidths.right);
  });

  test("HYDRATE_PANEL_WIDTHS applies client storage widths", () => {
    let state = createInitialInspectorState();
    state = inspectorReducer(state, {
      type: "HYDRATE_PANEL_WIDTHS",
      widths: { left: 240, right: 400, graph: 520 },
    });
    expect(state.panelWidths.left).toBe(240);
    expect(state.panelWidths.right).toBe(400);
    expect(state.panelWidths.graph).toBe(520);
  });

  test("SYNC_LIVE_HEAD only updates in live mode", () => {
    let state = createInitialInspectorState();
    state = inspectorReducer(state, { type: "SYNC_LIVE_HEAD", maxRevision: 10 });
    expect(state.selectedRevision).toBe(10);

    state = inspectorReducer(state, { type: "SELECT_REVISION", revision: 3 });
    state = inspectorReducer(state, { type: "SYNC_LIVE_HEAD", maxRevision: 15 });
    expect(state.selectedRevision).toBe(3);
  });

  test("getSelectedFrame returns last frame in live mode", () => {
    const timeline = makeTimeline(5);
    const state = createInitialInspectorState();
    const frame = getSelectedFrame(timeline, state);
    expect(frame.revision).toBe(4);
  });

  test("getSelectedFrame returns selected frame in replay mode", () => {
    const timeline = makeTimeline(5);
    let state = createInitialInspectorState();
    state = inspectorReducer(state, { type: "SELECT_REVISION", revision: 2 });
    const frame = getSelectedFrame(timeline, state);
    expect(frame.revision).toBe(2);
  });

  test("getSelectedFrame clamps to bounds", () => {
    const timeline = makeTimeline(3);
    let state = createInitialInspectorState();
    state = inspectorReducer(state, { type: "SELECT_REVISION", revision: 99 });
    const frame = getSelectedFrame(timeline, state);
    expect(frame.revision).toBe(2);
  });

  test("clampRevision adjusts when over max", () => {
    let state = createInitialInspectorState();
    state = inspectorReducer(state, { type: "SELECT_REVISION", revision: 10 });
    const clamped = clampRevision(state, 5);
    expect(clamped.selectedRevision).toBe(5);
  });

  test("clampRevision is a no-op when within bounds", () => {
    let state = createInitialInspectorState();
    state = inspectorReducer(state, { type: "SELECT_REVISION", revision: 3 });
    const clamped = clampRevision(state, 5);
    expect(clamped.selectedRevision).toBe(3);
  });

  test("JUMP_TO_START resets revision to 0", () => {
    let state = createInitialInspectorState();
    state = inspectorReducer(state, { type: "SELECT_REVISION", revision: 5 });
    state = inspectorReducer(state, { type: "JUMP_TO_START" });
    expect(state.selectedRevision).toBe(0);
    expect(state.mode).toBe("replay");
  });
});
