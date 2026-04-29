import { describe, expect, test } from "bun:test";

import { createLocalSession } from "@openturn/core";

import { paperScissorsRock } from "./index";

const paperScissorsRockMatch = { players: paperScissorsRock.playerIDs };

describe("paperScissorsRock gamekit example game", () => {
  test("starts with all players active in the planning state", () => {
    const session = createLocalSession(paperScissorsRock, { match: paperScissorsRockMatch });

    expect(session.getState().position.name).toBe("plan");
    expect(session.getState().derived.activePlayers).toEqual(["0", "1", "2"]);
    expect(session.getState().G.round).toBe(1);
  });

  test("keeps submissions hidden per player until the round resolves", () => {
    const session = createLocalSession(paperScissorsRock, { match: paperScissorsRockMatch });

    expect(session.applyEvent("0", "submitChoice", "rock").ok).toBe(true);
    expect(session.applyEvent("0", "submitChoice", "paper")).toEqual({
      error: "inactive_player",
      ok: false,
    });
    expect(session.getPlayerView("0")).toEqual({
      lastOutcome: {
        kind: "pending",
        round: 0,
        submittedPlayers: [],
        winners: [],
        winningChoice: null,
      },
      lastRevealed: {
        "0": null,
        "1": null,
        "2": null,
      },
      mySubmission: "rock",
      round: 1,
      scores: {
        "0": 0,
        "1": 0,
        "2": 0,
      },
    });
    expect(session.getState().derived.activePlayers).toEqual(["1", "2"]);
  });

  test("resolves a full round and awards every winner", () => {
    const session = createLocalSession(paperScissorsRock, { match: paperScissorsRockMatch });

    session.applyEvent("0", "submitChoice", "rock");
    session.applyEvent("1", "submitChoice", "rock");
    const result = session.applyEvent("2", "submitChoice", "scissors");

    expect(result.ok).toBe(true);
    expect(session.getState().G.lastOutcome).toEqual({
      kind: "win",
      round: 1,
      submittedPlayers: ["0", "1", "2"],
      winners: ["0", "1"],
      winningChoice: "rock",
    });
    expect(session.getState().G.scores).toEqual({
      "0": 1,
      "1": 1,
      "2": 0,
    });
    expect(session.getState().G.round).toBe(2);
    expect(session.getState().derived.activePlayers).toEqual(["0", "1", "2"]);
  });

  test("draws when everyone submits the same choice or the full set appears", () => {
    const sameChoiceSession = createLocalSession(paperScissorsRock, { match: paperScissorsRockMatch });

    sameChoiceSession.applyEvent("0", "submitChoice", "paper");
    sameChoiceSession.applyEvent("1", "submitChoice", "paper");
    sameChoiceSession.applyEvent("2", "submitChoice", "paper");
    expect(sameChoiceSession.getState().G.lastOutcome.kind).toBe("draw");

    const fullSetSession = createLocalSession(paperScissorsRock, { match: paperScissorsRockMatch });

    fullSetSession.applyEvent("0", "submitChoice", "paper");
    fullSetSession.applyEvent("1", "submitChoice", "scissors");
    fullSetSession.applyEvent("2", "submitChoice", "rock");
    expect(fullSetSession.getState().G.lastOutcome.kind).toBe("draw");
  });
});
