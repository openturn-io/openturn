import { describe, expect, test } from "bun:test";

import { createReplayCursor, materializeReplay } from "@openturn/replay";
import { createCursorInspector } from "@openturn/inspector";
import { protocolizeGameSnapshot } from "@openturn/protocol";

import { createTicTacToeMachineSession, ticTacToeMachine } from "./index";

const ticTacToeMachineMatch = { players: ticTacToeMachine.playerIDs };

describe("ticTacToe core example game", () => {
  test("starts with an empty 3x3 board and a compiled graph", () => {
    const session = createTicTacToeMachineSession();

    expect(session.getState().G.board).toEqual([
      [null, null, null],
      [null, null, null],
      [null, null, null],
    ]);
    expect(session.getState().position).toEqual({
      name: "play",
      path: ["play"],
      turn: 1,
    });
    expect(session.getState().derived).toEqual({
      activePlayers: ["0"],
      control: {
        status: "playing",
      },
      controlMeta: {
        deadline: null,
        label: "Player 0 to play",
        metadata: [
          {
            key: "currentPlayer",
            value: "0",
          },
        ],
        pendingTargets: ["won", "drawn", "play"],
      },
      selectors: {
        boardFull: false,
        winnerMark: null,
      },
    });
    expect(session.getGraph()).toEqual({
      edges: [
        { event: "place_mark", from: "play", resolver: "place_mark_to_won", to: "won", turn: "preserve" },
        { event: "place_mark", from: "play", resolver: "place_mark_to_drawn", to: "drawn", turn: "preserve" },
        { event: "place_mark", from: "play", resolver: "place_mark_continue", to: "play", turn: "preserve" },
      ],
      initial: "play",
      nodes: [
        { id: "drawn", kind: "leaf", parent: null, path: ["drawn"] },
        { id: "play", kind: "leaf", parent: null, path: ["play"] },
        { id: "won", kind: "leaf", parent: null, path: ["won"] },
      ],
    });
  });

  test("derives next turn and rejects illegal occupied-cell moves", () => {
    const session = createTicTacToeMachineSession();

    const firstMove = session.applyEvent("0", "place_mark", { row: 0, col: 0 });

    expect(firstMove.ok).toBe(true);
    expect(session.getState().G.board[0]?.[0]).toBe("X");
    expect(session.getState().derived.activePlayers).toEqual(["1"]);
    expect(session.getState().derived.control).toEqual({
      status: "playing",
    });
    expect(session.getState().derived.controlMeta).toEqual({
      deadline: null,
      label: "Player 1 to play",
      metadata: [
        {
          key: "currentPlayer",
          value: "1",
        },
      ],
      pendingTargets: ["won", "drawn", "play"],
    });
    expect(session.getState().position).toEqual({
      name: "play",
      path: ["play"],
      turn: 2,
    });

    expect(session.applyEvent("1", "place_mark", { row: 0, col: 0 })).toEqual({
      ok: false,
      error: "invalid_event",
    });
  });

  test("detects a win and exposes public/player views", () => {
    const session = createTicTacToeMachineSession();

    session.applyEvent("0", "place_mark", { row: 0, col: 0 });
    session.applyEvent("1", "place_mark", { row: 1, col: 0 });
    session.applyEvent("0", "place_mark", { row: 0, col: 1 });
    session.applyEvent("1", "place_mark", { row: 1, col: 1 });
    session.applyEvent("0", "place_mark", { row: 0, col: 2 });

    expect(session.getResult()).toEqual({ winner: "0" });
    expect(session.getState().derived).toEqual({
      activePlayers: [],
      control: {
        status: "won",
      },
      controlMeta: {
        deadline: null,
        label: "Winner",
        metadata: [
          {
            key: "winnerMark",
            value: "X",
          },
        ],
        pendingTargets: [],
      },
      selectors: {
        boardFull: false,
        winnerMark: "X",
      },
    });
    expect(session.getPublicView()).toEqual({
      board: [
        ["X", "X", "X"],
        ["O", "O", null],
        [null, null, null],
      ],
      currentPlayer: "1",
    });
    expect(session.getPlayerView("1")).toEqual({
      board: [
        ["X", "X", "X"],
        ["O", "O", null],
        [null, null, null],
      ],
      currentPlayer: "1",
      myMark: "O",
    });
  });

  test("detects a draw", () => {
    const session = createTicTacToeMachineSession();

    session.applyEvent("0", "place_mark", { row: 0, col: 0 });
    session.applyEvent("1", "place_mark", { row: 0, col: 1 });
    session.applyEvent("0", "place_mark", { row: 0, col: 2 });
    session.applyEvent("1", "place_mark", { row: 1, col: 1 });
    session.applyEvent("0", "place_mark", { row: 1, col: 0 });
    session.applyEvent("1", "place_mark", { row: 1, col: 2 });
    session.applyEvent("0", "place_mark", { row: 2, col: 1 });
    session.applyEvent("1", "place_mark", { row: 2, col: 0 });
    session.applyEvent("0", "place_mark", { row: 2, col: 2 });

    expect(session.getResult()).toEqual({ draw: true });
    expect(session.getState().position.name).toBe("drawn");
    expect(session.getState().derived.control).toEqual({
      status: "drawn",
    });
    expect(session.getState().derived.controlMeta).toEqual({
      deadline: null,
      label: "Draw",
      metadata: [],
      pendingTargets: [],
    });
    expect(session.getState().derived.selectors).toEqual({
      boardFull: true,
      winnerMark: null,
    });
  });

  test("replay reproduces core snapshots and devtools inspects observed edges", () => {
    const session = createTicTacToeMachineSession();

    session.applyEvent("0", "place_mark", { row: 0, col: 0 });
    session.applyEvent("1", "place_mark", { row: 1, col: 1 });

    const timeline = materializeReplay(ticTacToeMachine, {
      actions: session.getState().meta.log,
      match: ticTacToeMachineMatch,
      playerID: "0",
    });
    const cursor = createReplayCursor(timeline);
    const inspector = createCursorInspector(cursor, ticTacToeMachine);

    cursor.seekRevision(1);
    expect(inspector.getObservedTransition()).toEqual({
      enqueued: [],
      event: "place_mark",
      evaluations: [
        {
          event: "place_mark",
          from: "play",
          matchedTo: "play",
          outcome: "selected",
          path: ["play"],
          transitions: [
            {
              from: "play",
              matched: false,
              rejectedBy: "resolver",
              resolver: "place_mark_to_won",
              to: "won",
            },
            {
              from: "play",
              matched: false,
              rejectedBy: "resolver",
              resolver: "place_mark_to_drawn",
              to: "drawn",
            },
            {
              from: "play",
              matched: true,
              rejectedBy: null,
              resolver: "place_mark_continue",
              to: "play",
            },
          ],
        },
      ],
      from: "play",
      fromPath: ["play"],
      matchedFrom: "play",
      matchedFromPath: ["play"],
      resolver: "place_mark_continue",
      rng: null,
      to: "play",
      toPath: ["play"],
      turn: "increment",
    });
    expect(inspector.getGraph().initial).toBe("play");
    expect(inspector.getMatchedFamilyEvaluations()).toEqual(inspector.getObservedTransition()?.evaluations ?? []);
    expect(inspector.getRngTrace()).toBeNull();
    expect(timeline.frames.at(-1)?.snapshot).toEqual(session.getState());
    expect(protocolizeGameSnapshot(session.getState(), { matchID: "ttt_machine", revision: 2 })).toEqual({
      derived: {
        activePlayers: ["0"],
        control: {
          status: "playing",
        },
        controlMeta: {
          deadline: null,
          label: "Player 0 to play",
          metadata: [
            {
              key: "currentPlayer",
              value: "0",
            },
          ],
          pendingTargets: ["won", "drawn", "play"],
        },
        selectors: {
          boardFull: false,
          winnerMark: null,
        },
      },
      G: {
        board: [
          ["X", null, null],
          [null, "O", null],
          [null, null, null],
        ],
      },
      log: [
        {
          actionID: "m_1",
          at: 0,
          event: "place_mark",
          payload: { row: 0, col: 0 },
          playerID: "0",
          turn: 1,
          type: "event",
        },
        {
          actionID: "m_2",
          at: 0,
          event: "place_mark",
          payload: { row: 1, col: 1 },
          playerID: "1",
          turn: 2,
          type: "event",
        },
      ],
      position: {
        node: "play",
        path: ["play"],
        turn: 3,
      },
      matchID: "ttt_machine",
      result: null,
      revision: 2,
    });
  });
});
