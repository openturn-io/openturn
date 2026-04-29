// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { ticTacToe, ticTacToeGameID } from "@openturn/example-tic-tac-toe-game";
import { createOpenturnBindings } from "@openturn/react";
import { createSavedReplayEnvelope, serializeSavedReplay } from "@openturn/replay";

import { TicTacToeReplayViewer } from "./TicTacToeReplayViewer";

const ticTacToeMatch = { players: ticTacToe.playerIDs };

const ticTacToeBindings = createOpenturnBindings(ticTacToe, {
  runtime: "local",
  match: ticTacToeMatch,
});

describe("TicTacToeReplayViewer", () => {
  test("starts with only the replay file upload affordance", () => {
    renderWithOpenturnProvider();

    expect(screen.getByLabelText("Choose replay JSON")).toBeTruthy();
    expect(screen.queryByLabelText("Replay JSON")).toBeNull();
    expect(screen.queryByText("Load replay")).toBeNull();
    expect(screen.queryByText("Shell history")).toBeNull();
  });

  test("loads one saved tic-tac-toe replay file into the shell match history", async () => {
    renderWithOpenturnProvider();

    const replayFile = new File([createReplayText(ticTacToeGameID)], "tic-tac-toe-replay.json", {
      type: "application/json",
    });

    fireEvent.change(screen.getByLabelText("Choose replay JSON"), {
      target: { files: [replayFile] },
    });

    await waitFor(() => {
      expect(screen.getByText("Loaded replay into the dev shell history.")).toBeTruthy();
    });

    expect(screen.getByText("Shell history")).toBeTruthy();
    expect(screen.getByLabelText("Row 1 Column 1").textContent).toBe("X");
    expect(screen.queryByLabelText("Choose replay JSON")).toBeNull();
    expect(screen.queryByText("Load replay")).toBeNull();
  });

  test("alerts on invalid json and leaves the upload affordance in place", async () => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    renderWithOpenturnProvider();

    const replayFile = new File(["not json"], "bad-replay.json", {
      type: "application/json",
    });

    fireEvent.change(screen.getByLabelText("Choose replay JSON"), {
      target: { files: [replayFile] },
    });

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalled();
    });
    expect(screen.getByLabelText("Choose replay JSON")).toBeTruthy();
    expect(screen.queryByText("Shell history")).toBeNull();
  });

  test("alerts on unsupported replay game ids", async () => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    renderWithOpenturnProvider();

    const replayFile = new File([createReplayText("example/unknown")], "unknown-replay.json", {
      type: "application/json",
    });

    fireEvent.change(screen.getByLabelText("Choose replay JSON"), {
      target: { files: [replayFile] },
    });

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith("Unknown replay game \"example/unknown\".");
    });
    expect(screen.getByLabelText("Choose replay JSON")).toBeTruthy();
    expect(screen.queryByText("Shell history")).toBeNull();
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function createReplayText(gameID: string): string {
  return serializeSavedReplay(createSavedReplayEnvelope({
    actions: [
      {
        actionID: "m_1",
        at: 0,
        event: "placeMark",
        payload: { row: 0, col: 0 },
        playerID: "0",
        turn: 1,
        type: "event",
      },
    ],
    gameID,
    initialNow: 0,
    match: ticTacToeMatch,
    playerID: "0",
    seed: "default",
  }));
}

function renderWithOpenturnProvider() {
  const matchStore = ticTacToeBindings.createLocalMatch({ match: ticTacToeMatch });

  return render(
    <ticTacToeBindings.OpenturnProvider match={matchStore}>
      <TicTacToeReplayViewer />
    </ticTacToeBindings.OpenturnProvider>,
  );
}
