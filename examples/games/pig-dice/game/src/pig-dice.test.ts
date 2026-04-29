import { describe, expect, test } from "bun:test";

import { createLocalSession } from "@openturn/core";

import { PIG_DICE_TARGET_SCORE, pigDice } from "./index";

const pigDiceMatch = { players: pigDice.playerIDs };

describe("pigDice example game", () => {
  test("starts with zero scores and player 0 active", () => {
    const session = createLocalSession(pigDice, { match: pigDiceMatch });

    expect(session.getState().G).toEqual({
      __gamekit: {
        result: null,
      },
      lastRoll: null,
      scores: { "0": 0, "1": 0 },
      turnTotal: 0,
    });
    expect(session.getState().derived.activePlayers).toEqual(["0"]);
  });

  test("rolling above one keeps the turn and rolling one passes it", () => {
    const session = createLocalSession(pigDice, { match: pigDiceMatch });

    expect(session.applyEvent("0", "roll", { value: 5 }).ok).toBe(true);
    expect(session.getState().G.lastRoll).toBe(5);
    expect(session.getState().G.turnTotal).toBe(5);
    expect(session.getState().derived.activePlayers).toEqual(["0"]);

    expect(session.applyEvent("0", "roll", { value: 1 }).ok).toBe(true);
    expect(session.getState().G.lastRoll).toBe(1);
    expect(session.getState().G.turnTotal).toBe(0);
    expect(session.getState().derived.activePlayers).toEqual(["1"]);
  });

  test("holding banks points, rejects empty holds, and can end the game", () => {
    const session = createLocalSession(pigDice, { match: pigDiceMatch });

    expect(session.applyEvent("0", "hold", undefined)).toEqual({
      details: {
        turnTotal: 0,
      },
      error: "invalid_event",
      ok: false,
      reason: "empty_turn",
    });

    session.applyEvent("0", "roll", { value: 6 });
    expect(session.applyEvent("0", "hold", undefined).ok).toBe(true);
    expect(session.getState().G.scores["0"]).toBe(6);
    expect(session.getState().derived.activePlayers).toEqual(["1"]);

    const winningSession = createLocalSession(pigDice, { match: pigDiceMatch });
    winningSession.applyEvent("0", "roll", { value: 6 });
    winningSession.applyEvent("0", "roll", { value: 6 });
    winningSession.applyEvent("0", "roll", { value: 6 });
    winningSession.applyEvent("0", "roll", { value: 6 });
    winningSession.applyEvent("0", "hold", undefined);

    expect(winningSession.getResult()).toEqual({ winner: "0" });
    expect(winningSession.getState().G.scores["0"]).toBeGreaterThanOrEqual(PIG_DICE_TARGET_SCORE);
  });
});
