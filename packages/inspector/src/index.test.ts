import { describe, expect, test } from "bun:test";

import { createLocalSession, defineGame, compileGameGraph, GAME_QUEUE_SEMANTICS, getGameValidationReport } from "@openturn/core";
import { createReplayCursor, materializeReplay } from "@openturn/replay";

import {
  buildInspectorTimelineFromSource,
  createCursorInspector,
  hostedBatchEntriesFromProtocol,
} from "./index";
import type { HostedBatchEntry } from "./index";

const MATCH = {
  players: ["0", "1"] as const,
};

const inspectedGame = defineGame({
  playerIDs: MATCH.players,
  events: {
    attack: {
      amount: 0,
    },
    finalize: {
      amount: 0,
    },
  },
  initial: "idle",
  selectors: {
    doubledTotal: ({ G }) => G.total * 2,
  },
  setup: () => ({
    total: 0,
  }),
  states: {
    done: {
      activePlayers: () => [],
      label: "Done",
    },
    idle: {
      activePlayers: ({ match, position }) => [match.players[(position.turn - 1) % match.players.length]!],
      control: ({ G }) => ({
        total: G.total,
      }),
      label: ({ G }) => `Total ${G.total}`,
      metadata: ({ G }) => [
        {
          key: "total",
          value: G.total,
        },
      ],
    },
  },
  transitions: [
    {
      event: "attack",
      from: "idle",
      label: "attack_resolver",
      resolve: ({ G, event }) => {
        const amount = event.payload.amount + 1;

        return {
          G: {
            total: G.total + amount,
          },
          enqueue: [
            {
              kind: "finalize",
              payload: {
                amount,
              },
            },
          ],
          turn: "increment",
        };
      },
      to: "idle",
    },
    {
      event: "finalize",
      from: "idle",
      label: "finalize_resolver",
      resolve: ({ G, event }) => ({
        G: {
          total: G.total + event.payload.amount,
        },
      }),
      to: "done",
    },
  ],
});

describe("@openturn/inspector", () => {
  test("inspects prepared payloads, matched families, diffs, and control summaries", () => {
    const session = createLocalSession(inspectedGame, { match: MATCH });
    const result = session.applyEvent("0", "attack", { amount: 2 });

    expect(result.ok).toBe(true);

    const timeline = materializeReplay(inspectedGame, {
      actions: session.getState().meta.log,
      match: MATCH,
    });
    const cursor = createReplayCursor(timeline);
    const inspector = createCursorInspector(cursor, inspectedGame);

    cursor.seekRevision(1);
    expect(inspector.getRngTrace()).toBeNull();
    expect(inspector.getObservedTransition()).toMatchObject({
      event: "attack",
      from: "idle",
      matchedFrom: "idle",
      resolver: "attack_resolver",
      to: "idle",
    });
    expect(inspector.getMatchedFamilyEvaluations()).toEqual([
      {
        event: "attack",
        from: "idle",
        matchedTo: "idle",
        outcome: "selected",
        path: ["idle"],
        transitions: [
          {
            from: "idle",
            matched: true,
            resolver: "attack_resolver",
            rejectedBy: null,
            to: "idle",
          },
        ],
      },
    ]);
    expect(inspector.getDiff()).toEqual([
      {
        after: 3,
        before: 0,
        path: "$.total",
      },
    ]);
    expect(inspector.getControlSummary()).toEqual({
      activePlayers: ["1"],
      control: {
        total: 3,
      },
      current: {
        meta: {
          deadline: null,
          label: "Total 3",
          metadata: [
            {
              key: "total",
              value: 3,
            },
          ],
          pendingTargets: ["idle", "done"],
        },
        node: "idle",
        path: ["idle"],
      },
      pendingTargetDetails: [
        {
          deadline: null,
          label: "Total 3",
          metadata: [
            {
              key: "total",
              value: 3,
            },
          ],
          node: "idle",
          path: ["idle"],
        },
        {
          deadline: null,
          label: "Done",
          metadata: [],
          node: "done",
          path: ["done"],
        },
      ],
    });
    expect(inspector.getValidationReport().ok).toBe(true);
    expect(inspector.getQueueSemantics()).toEqual({
      ordering: "fifo",
      priorities: "none",
      recursionLimit: null,
    });

    cursor.seekRevision(2);
    expect(inspector.getRngTrace()).toBeNull();
    expect(inspector.getObservedTransition()).toMatchObject({
      event: "finalize",
      from: "idle",
      resolver: "finalize_resolver",
      to: "done",
    });
  });

  test("buildInspectorTimelineFromSource (replay) creates normalized frames from local replay", () => {
    const session = createLocalSession(inspectedGame, { match: MATCH });
    session.applyEvent("0", "attack", { amount: 2 });

    const replayTimeline = materializeReplay(inspectedGame, {
      actions: session.getState().meta.log,
      match: MATCH,
    });
    const inspectorTimeline = buildInspectorTimelineFromSource({
      kind: "replay",
      timeline: replayTimeline,
      game: inspectedGame,
    });

    expect(inspectorTimeline.frames.length).toBe(3);

    const frame0 = inspectorTimeline.frames[0]!;
    expect(frame0.stepKind).toBe("initial");
    expect(frame0.revision).toBe(0);
    expect(frame0.eventName).toBeNull();
    expect(frame0.diffs).toEqual([]);
    expect(frame0.snapshot).toEqual({ total: 0 });
    expect(frame0.controlHandoff).toEqual({
      beforeActivePlayers: [],
      afterActivePlayers: ["0"],
      handoffKind: "unknown",
      handoffLabel: "Start: P0",
      summary: "Starts with P0",
    });

    const frame1 = inspectorTimeline.frames[1]!;
    expect(frame1.stepKind).toBe("action");
    expect(frame1.revision).toBe(1);
    expect(frame1.eventName).toBe("attack");
    expect(frame1.playerID).toBe("0");
    expect(frame1.diffs).toEqual([
      { after: 3, before: 0, path: "$.total" },
    ]);
    expect(frame1.transition).toMatchObject({
      event: "attack",
      from: "idle",
      to: "idle",
    });
    expect(frame1.evaluations.length).toBe(1);
    expect(frame1.graphHighlight).not.toBeNull();
    expect(frame1.graphHighlight!.currentNode).toBe("idle");
    expect(frame1.graphHighlight!.lastTraversedEdge).toEqual({ from: "idle", to: "idle" });
    expect(frame1.controlHandoff).toEqual({
      beforeActivePlayers: ["0"],
      afterActivePlayers: ["1"],
      handoffKind: "pass",
      handoffLabel: "P0 -> P1",
      summary: "Control passes from P0 to P1",
    });
    expect(frame1.graphHighlight!.controlHandoff).toEqual(frame1.controlHandoff);

    const frame2 = inspectorTimeline.frames[2]!;
    expect(frame2.stepKind).toBe("internal");
    expect(frame2.eventName).toBe("finalize");
    expect(frame2.controlHandoff).toEqual({
      beforeActivePlayers: ["1"],
      afterActivePlayers: [],
      handoffKind: "terminal",
      handoffLabel: "none",
      summary: "Control leaves P1",
    });

    expect(inspectorTimeline.graph.nodes.length).toBeGreaterThan(0);
    expect(inspectorTimeline.validationReport.ok).toBe(true);
  });

  test("buildInspectorTimelineFromSource (replay) includes player-view-aware frames", () => {
    const session = createLocalSession(inspectedGame, { match: MATCH });
    session.applyEvent("0", "attack", { amount: 1 });

    const replayTimeline = materializeReplay(inspectedGame, {
      actions: session.getState().meta.log,
      match: MATCH,
      playerID: "0",
    });
    const inspectorTimeline = buildInspectorTimelineFromSource({
      kind: "replay",
      timeline: replayTimeline,
      game: inspectedGame,
    });

    for (const frame of inspectorTimeline.frames) {
      expect(frame.playerView).not.toBeNull();
    }
  });

  test("buildInspectorTimelineFromSource (hosted) builds from protocol batch traces", () => {
    const graph = compileGameGraph(inspectedGame);
    const queueSemantics = GAME_QUEUE_SEMANTICS;
    const validationReport = getGameValidationReport(inspectedGame, {
      match: MATCH,
      now: 0,
      seed: "test",
    });

    const entries: HostedBatchEntry[] = [
      {
        revision: 0,
        turn: 1,
        stepKind: "initial",
        eventName: null,
        actionID: null,
        playerID: null,
        payload: null,
        snapshot: { total: 0 },
      },
      {
        revision: 1,
        turn: 2,
        stepKind: "action",
        eventName: "attack",
        actionID: "act-1",
        playerID: "0",
        payload: { amount: 5 },
        snapshot: { total: 6 },
      },
    ];

    const timeline = buildInspectorTimelineFromSource({
      kind: "hosted",
      entries,
      graph,
      queueSemantics,
      validationReport,
    });

    expect(timeline.frames.length).toBe(2);
    expect(timeline.frames[0]!.stepKind).toBe("initial");
    expect(timeline.frames[1]!.stepKind).toBe("action");
    expect(timeline.frames[1]!.eventName).toBe("attack");
    expect(timeline.frames[1]!.diffs).toEqual([
      { after: 6, before: 0, path: "$.total" },
    ]);
    expect(timeline.frames[1]!.controlHandoff).toBeNull();
    expect(timeline.graph).toBe(graph);
    expect(timeline.validationReport).toBe(validationReport);
  });

  test("hostedBatchEntriesFromProtocol maps initial snapshot + batch steps to entries", () => {
    const initialSnapshot = {
      revision: 0,
      position: { turn: 1 },
      G: { total: 0 },
    };

    const transition = {
      enqueued: [],
      evaluations: [
        {
          event: "attack",
          from: "idle",
          matchedTo: "idle",
          outcome: "selected" as const,
          path: ["idle"],
          transitions: [],
        },
      ],
      event: "attack",
      from: "idle",
      fromPath: ["idle"],
      matchedFrom: "idle",
      matchedFromPath: ["idle"],
      resolver: "attack_resolver",
      rng: null,
      to: "idle",
      toPath: ["idle"],
      turn: "increment" as const,
    };

    const batches = [
      {
        revision: 1,
        steps: [
          {
            kind: "action" as const,
            event: {
              actionID: "a_1",
              event: "attack",
              payload: { amount: 5 },
              type: "event" as const,
              playerID: "0",
            },
            snapshot: { revision: 1, position: { turn: 2 }, G: { total: 6 } },
            transition,
          },
        ],
      },
      {
        revision: 2,
        steps: [
          {
            kind: "internal" as const,
            event: {
              actionID: "i_1",
              event: "finalize",
              payload: { amount: 0 },
              type: "internal" as const,
              playerID: null,
            },
            snapshot: { revision: 2, position: { turn: 2 }, G: { total: 6 } },
            transition,
          },
        ],
      },
    ];

    const entries = hostedBatchEntriesFromProtocol(initialSnapshot, batches);

    expect(entries).toHaveLength(3);
    expect(entries[0]!.stepKind).toBe("initial");
    expect(entries[0]!.revision).toBe(0);
    expect(entries[1]!.stepKind).toBe("action");
    expect(entries[1]!.eventName).toBe("attack");
    expect(entries[1]!.playerID).toBe("0");
    expect(entries[1]!.payload).toEqual({ amount: 5 });
    expect(entries[1]!.snapshot).toEqual({ total: 6 });
    expect(entries[1]!.evaluations).toHaveLength(1);
    expect(entries[2]!.stepKind).toBe("internal");
    expect(entries[2]!.playerID).toBeNull();
  });

  test("hostedBatchEntriesFromProtocol dedupes steps whose revision was already emitted", () => {
    const initialSnapshot = { revision: 0, position: { turn: 1 }, G: { total: 0 } };
    const transition = {
      enqueued: [],
      evaluations: [],
      event: "attack",
      from: "idle",
      fromPath: ["idle"],
      matchedFrom: "idle",
      matchedFromPath: ["idle"],
      resolver: null,
      rng: null,
      to: "idle",
      toPath: ["idle"],
      turn: "preserve" as const,
    };

    const duplicatedBatch = {
      revision: 1,
      steps: [
        {
          kind: "action" as const,
          event: {
            actionID: "a_1",
            event: "attack",
            payload: null,
            type: "event" as const,
            playerID: "0",
          },
          snapshot: { revision: 1, position: { turn: 2 }, G: { total: 1 } },
          transition,
        },
      ],
    };

    const entries = hostedBatchEntriesFromProtocol(initialSnapshot, [duplicatedBatch, duplicatedBatch]);
    expect(entries).toHaveLength(2);
  });
});
