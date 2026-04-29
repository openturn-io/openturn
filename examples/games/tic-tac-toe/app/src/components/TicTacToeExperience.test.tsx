// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { ticTacToe } from "@openturn/example-tic-tac-toe-game";
import { createOpenturnBindings } from "@openturn/react";

import { TicTacToeExperience } from "./TicTacToeExperience";

const ticTacToeMatch = { players: ticTacToe.playerIDs };

const ticTacToeBindings = createOpenturnBindings(ticTacToe, {
  runtime: "local",
  match: ticTacToeMatch,
});

describe("TicTacToeExperience", () => {
  test("renders the initial local match state", () => {
    renderWithLocalMatch();

    expect(screen.getByText("One engine. Local now. Hosted next.")).toBeTruthy();
    expect(screen.getByText("Player X")).toBeTruthy();
    expect(screen.getByText("In progress")).toBeTruthy();
  });

  test("updates the board across alternating moves and shows a winner", () => {
    renderWithLocalMatch();

    fireEvent.click(screen.getByLabelText("Row 1 Column 1"));
    fireEvent.click(screen.getByLabelText("Row 2 Column 1"));
    fireEvent.click(screen.getByLabelText("Row 1 Column 2"));
    fireEvent.click(screen.getByLabelText("Row 2 Column 2"));
    fireEvent.click(screen.getByLabelText("Row 1 Column 3"));

    expect(screen.getByText("Player X wins")).toBeTruthy();
  });

  test("shows invalid move feedback without changing the board", () => {
    renderWithLocalMatch();

    fireEvent.click(screen.getByLabelText("Row 1 Column 1"));
    fireEvent.click(screen.getByLabelText("Row 1 Column 1"));

    expect(screen.getByText("That square is occupied. Pick a clean lane.")).toBeTruthy();
    expect(screen.getAllByText("X")).toHaveLength(1);
  });

  test("animates the latest placement and restart resets the match", () => {
    vi.useFakeTimers();

    renderWithLocalMatch();

    const cell = screen.getByLabelText("Row 1 Column 1");
    fireEvent.click(cell);
    expect(cell.getAttribute("data-animated")).toBe("true");

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(cell.getAttribute("data-animated")).toBe("false");

    fireEvent.click(screen.getByText("Restart match"));
    expect(screen.getByText("Fresh board. Set the tempo.")).toBeTruthy();
    expect(screen.getByText("Player X")).toBeTruthy();
  });

  test("exports a saved replay json file from the local match", async () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const createObjectURLSpy = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:tic-tac-toe-replay");
    const revokeObjectURLSpy = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});

    renderWithLocalMatch();

    fireEvent.click(screen.getByLabelText("Row 1 Column 1"));
    fireEvent.click(screen.getByText("Export replay JSON"));

    const [blob] = createObjectURLSpy.mock.calls[0] ?? [];
    expect(blob).toBeInstanceOf(Blob);
    await expect((blob as Blob).text()).resolves.toContain("\"gameID\":\"example/tic-tac-toe\"");
    await expect((blob as Blob).text()).resolves.toContain("\"event\":\"placeMark\"");
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectURLSpy).toHaveBeenCalledWith("blob:tic-tac-toe-replay");
  });
});

function renderWithLocalMatch() {
  const { OpenturnProvider } = ticTacToeBindings;
  const localMatch = ticTacToeBindings.createLocalMatch({ match: ticTacToeMatch });

  return render(
    <OpenturnProvider match={localMatch}>
      <TicTacToeExperience />
    </OpenturnProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
