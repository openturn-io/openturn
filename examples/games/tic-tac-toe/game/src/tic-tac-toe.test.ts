import { describe, expect, test } from "bun:test";

import { createLocalSession } from "@openturn/core";

import { ticTacToe } from "./index";

const ticTacToeMatch = { players: ticTacToe.playerIDs };

describe("ticTacToe example game", () => {
  test("starts on an empty board with player 0 to act", () => {
    const session = createLocalSession(ticTacToe, { match: ticTacToeMatch });

    expect(session.getState().G.board).toEqual([
      [null, null, null],
      [null, null, null],
      [null, null, null],
    ]);
    expect(session.getState().position.name).toBe("play");
    expect(session.getState().derived.activePlayers).toEqual(["0"]);
  });

  test("alternates turns, rejects occupied cells, and detects wins", () => {
    const session = createLocalSession(ticTacToe, { match: ticTacToeMatch });

    expect(session.applyEvent("0", "placeMark", { row: 0, col: 0 }).ok).toBe(true);
    expect(session.getState().derived.activePlayers).toEqual(["1"]);
    expect(session.applyEvent("1", "placeMark", { row: 0, col: 0 })).toEqual({
      details: {
        col: 0,
        row: 0,
      },
      error: "invalid_event",
      ok: false,
      reason: "occupied",
    });

    session.applyEvent("1", "placeMark", { row: 1, col: 0 });
    session.applyEvent("0", "placeMark", { row: 0, col: 1 });
    session.applyEvent("1", "placeMark", { row: 1, col: 1 });
    session.applyEvent("0", "placeMark", { row: 0, col: 2 });

    expect(session.getResult()).toEqual({ winner: "0" });
    expect(session.getState().position.name).toBe("__gamekit_finished");
    expect(session.getState().derived.activePlayers).toEqual([]);
  });

  test("detects a draw", () => {
    const session = createLocalSession(ticTacToe, { match: ticTacToeMatch });

    session.applyEvent("0", "placeMark", { row: 0, col: 0 });
    session.applyEvent("1", "placeMark", { row: 0, col: 1 });
    session.applyEvent("0", "placeMark", { row: 0, col: 2 });
    session.applyEvent("1", "placeMark", { row: 1, col: 1 });
    session.applyEvent("0", "placeMark", { row: 1, col: 0 });
    session.applyEvent("1", "placeMark", { row: 1, col: 2 });
    session.applyEvent("0", "placeMark", { row: 2, col: 1 });
    session.applyEvent("1", "placeMark", { row: 2, col: 0 });
    session.applyEvent("0", "placeMark", { row: 2, col: 2 });

    expect(session.getResult()).toEqual({ draw: true });
    expect(session.getState().position.name).toBe("__gamekit_finished");
  });
});
