import { describe, expect, test } from "bun:test";

import { createLocalSession, defineGame } from "@openturn/core";

import {
  addReplayBranch,
  createReplayCursor,
  createSavedReplayFromSession,
  materializeReplay,
  materializeSavedReplay,
  parseSavedReplay,
  serializeSavedReplay,
} from "./index";

const MATCH = {
  players: ["0", "1"] as const,
};

const replayGame = defineGame({
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
      label: ({ G }) => `Total ${G.total}`,
    },
  },
  transitions: [
    {
      event: "attack",
      from: "idle",
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
      resolve: ({ G, event }) => ({
        G: {
          total: G.total + event.payload.amount,
        },
      }),
      to: "done",
    },
  ],
});

describe("@openturn/replay", () => {
  test("materializes action and internal-event frames from the strict core log", () => {
    const session = createLocalSession(replayGame, { match: MATCH });
    const result = session.applyEvent("0", "attack", { amount: 2 });

    expect(result.ok).toBe(true);

    const timeline = materializeReplay(replayGame, {
      actions: session.getState().meta.log,
      match: MATCH,
    });

    expect(timeline.frames).toHaveLength(3);
    expect(timeline.frames[1]?.action?.actionID).toBe("m_1");
    expect(timeline.frames[1]?.step?.kind).toBe("action");
    expect(timeline.frames[2]?.step?.kind).toBe("internal");
    expect(timeline.frames[2]?.snapshot.G.total).toBe(6);
    expect(timeline.frames[2]?.snapshot.position.name).toBe("done");
  });

  test("supports branching and cursor navigation over strict-core frames", () => {
    const session = createLocalSession(replayGame, { match: MATCH });
    session.applyEvent("0", "attack", { amount: 1 });

    const timeline = addReplayBranch(
      materializeReplay(replayGame, {
        actions: session.getState().meta.log,
        match: MATCH,
      }),
      "m_1",
      "analysis",
    );
    const cursor = createReplayCursor(timeline);

    cursor.seekRevision(2);
    expect(cursor.getState().currentFrame.snapshot.G.total).toBe(4);

    cursor.undo();
    expect(cursor.getState().currentFrame.snapshot.G.total).toBe(2);

    cursor.redo();
    cursor.setSpeed(2);
    cursor.setBranch("analysis");

    expect(cursor.getState().branch.branchID).toBe("analysis");
    expect(cursor.getState().speed).toBe(2);
    expect(timeline.branches.at(-1)).toEqual({
      branchID: "analysis",
      createdAtActionID: "m_1",
      createdAtRevision: 1,
      headActionID: "m_1",
      parentBranchID: "main",
    });
  });

  test("serializes and parses canonical saved replay envelopes", () => {
    const session = createLocalSession(replayGame, { match: MATCH, now: 12, seed: "seed-7" });
    expect(session.applyEvent("0", "attack", { amount: 2 }).ok).toBe(true);

    const envelope = createSavedReplayFromSession({
      gameID: "tests/replay-game",
      metadata: {
        label: "attack replay",
      },
      playerID: "0",
      session,
    });

    const parsed = parseSavedReplay(serializeSavedReplay(envelope));
    const expectedTimeline = materializeReplay(replayGame, {
      actions: session.getState().meta.log,
      initialNow: 12,
      match: MATCH,
      playerID: "0",
      seed: "seed-7",
    });

    expect(parsed).toEqual(envelope);
    expect(materializeSavedReplay(replayGame, parsed)).toEqual(expectedTimeline);
  });

  test("rejects malformed saved replay envelopes", () => {
    expect(() => parseSavedReplay(JSON.stringify({
      actions: [],
      gameID: "",
      initialNow: 0,
      match: {
        players: ["0", "1"],
      },
      seed: "seed-1",
      version: 1,
    }))).toThrow("saved replay.gameID must be a non-empty string.");

    expect(() => parseSavedReplay(JSON.stringify({
      actions: [
        {
          actionID: "m_1",
          at: 0,
          event: "attack",
          payload: null,
          playerID: "0",
          turn: 1,
          type: "internal",
        },
      ],
      gameID: "tests/replay-game",
      initialNow: 0,
      match: {
        players: ["0", "1"],
      },
      seed: "seed-1",
      version: 1,
    }))).toThrow('saved replay.actions[0].type must be "event".');
  });
});
