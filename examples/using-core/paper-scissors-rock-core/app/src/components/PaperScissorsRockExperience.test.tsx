// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";

import { paperScissorsRock } from "@openturn/example-paper-scissors-rock-core-game";

const paperScissorsRockMatch = { players: paperScissorsRock.playerIDs };
import { createOpenturnBindings } from "@openturn/react";

import { PaperScissorsRockExperience } from "./PaperScissorsRockExperience";

const bindings = createOpenturnBindings(paperScissorsRock, {
  runtime: "local",
  match: paperScissorsRockMatch,
});

describe("PaperScissorsRockExperience", () => {
  test("renders the initial match state", () => {
    renderWithFreshMatch();

    expect(screen.getByText("Hidden turns. Shared round. Local match.")).toBeTruthy();
    expect(screen.getByText("Local-only multiplayer")).toBeTruthy();
    expect(screen.getByTestId("round-value").textContent).toBe("1");
    expect(screen.getByTestId("clock-value").textContent).toBe("0 / 3");
  });

  test("keeps incomplete rounds open until every player has submitted", () => {
    renderWithFreshMatch();

    fireEvent.click(screen.getByTestId("0-rock"));
    fireEvent.click(screen.getByTestId("1-paper"));

    expect(screen.getByTestId("clock-value").textContent).toBe("2 / 3");
    expect(screen.getByTestId("status-message").textContent).toContain("locked");
    expect((screen.getByTestId("0-rock") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId("2-rock") as HTMLButtonElement).disabled).toBe(false);
  });

  test("resolves a full round and restart clears the local match state", () => {
    renderWithFreshMatch();

    fireEvent.click(screen.getByTestId("0-rock"));
    fireEvent.click(screen.getByTestId("1-rock"));
    fireEvent.click(screen.getByTestId("2-scissors"));

    expect(screen.getByTestId("outcome-summary").textContent).toContain("Round 1:");
    expect(screen.getByTestId("score-0").textContent).toContain("1 points");
    expect(screen.getByTestId("score-1").textContent).toContain("1 points");
    expect(screen.getByTestId("revealed-2").textContent).toContain("Scissors");

    fireEvent.click(screen.getByText("Restart match"));
    expect(screen.getByTestId("round-value").textContent).toBe("1");
    expect(screen.getByTestId("clock-value").textContent).toBe("0 / 3");
    expect(screen.getByTestId("outcome-summary").textContent).toBe("No rounds resolved yet");
  });
});

afterEach(() => {
  cleanup();
});

function renderWithFreshMatch() {
  const matchStore = bindings.createLocalMatch({ match: paperScissorsRockMatch });

  return render(
    <bindings.OpenturnProvider match={matchStore}>
      <PaperScissorsRockExperience />
    </bindings.OpenturnProvider>,
  );
}
