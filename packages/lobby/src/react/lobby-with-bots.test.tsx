import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, within } from "@testing-library/react";

afterEach(() => {
  cleanup();
});

import type { LobbyAvailableBot, LobbySeat } from "@openturn/protocol";

import { LobbyWithBots } from "./lobby-with-bots";
import type { LobbyView } from "./lobby";

function makeView(overrides: Partial<LobbyView> = {}): LobbyView {
  const seats: readonly LobbySeat[] = overrides.seats ?? [
    { kind: "open", seatIndex: 0 },
    { kind: "open", seatIndex: 1 },
  ];
  const availableBots: readonly LobbyAvailableBot[] = overrides.availableBots ?? [
    { botID: "random", label: "Random", difficulty: "easy" },
    { botID: "minimax-hard", label: "Minimax · hard", difficulty: "hard" },
  ];
  return {
    phase: "lobby",
    hostUserID: "host",
    targetCapacity: 2,
    minPlayers: 2,
    maxPlayers: 2,
    seats,
    canStart: false,
    mySeatIndex: null,
    myReady: false,
    seatedCount: seats.filter((s) => s.kind !== "open").length,
    isHost: true,
    availableBots,
    status: "connected",
    error: null,
    lastRejection: null,
    closedReason: null,
    takeSeat: vi.fn(),
    leaveSeat: vi.fn(),
    setReady: vi.fn(),
    start: vi.fn(),
    close: vi.fn(),
    assignBot: vi.fn(),
    clearSeat: vi.fn(),
    setTargetCapacity: vi.fn(),
    ...overrides,
  };
}

describe("<LobbyWithBots />", () => {
  test("host viewer sees Take seat + Assign bot dropdown on open seats", () => {
    const view = makeView();
    render(<LobbyWithBots lobby={view} />);

    const slot = document.querySelector('[data-seat-index="0"][data-seat-kind="open"]');
    expect(slot).not.toBeNull();
    expect(within(slot as HTMLElement).getByRole("button", { name: /take seat/i })).toBeTruthy();
    expect(within(slot as HTMLElement).getByRole("button", { name: /assign bot/i })).toBeTruthy();
  });

  test("non-host viewer sees only Take seat (no bot dropdown)", () => {
    const view = makeView({ isHost: false, hostUserID: "someone-else" });
    render(<LobbyWithBots lobby={view} />);

    const slot = document.querySelector('[data-seat-index="0"][data-seat-kind="open"]');
    expect(slot).not.toBeNull();
    // Non-host open seat is a single <button aria-label="Take seat 1"> with no bot menu.
    expect((slot as HTMLElement).getAttribute("aria-label")).toMatch(/take seat/i);
    expect(
      within(slot as HTMLElement).queryByRole("button", { name: /assign bot/i }),
    ).toBeNull();
  });

  test("clicking Assign bot reveals the bot list and dispatches on selection", () => {
    const view = makeView();
    render(<LobbyWithBots lobby={view} />);

    const slot = document.querySelector('[data-seat-index="0"][data-seat-kind="open"]') as HTMLElement;
    const trigger = within(slot).getByRole("button", { name: /assign bot/i });
    fireEvent.click(trigger);

    const table = document.querySelector(".openturn-lobby__table") as HTMLElement;
    expect(table.className).toContain("z-20");
    expect(slot.parentElement?.className).toContain("focus-within:z-30");

    const menu = within(slot).getByRole("menu");
    expect(menu.className).toContain("z-50");

    const minimaxOption = within(slot).getByRole("menuitem", { name: /Minimax/i });
    fireEvent.click(minimaxOption);

    expect(view.assignBot).toHaveBeenCalledWith(0, "minimax-hard");
  });

  test("renders bot seat as a chip with Clear (host) and no dropdown", () => {
    const view = makeView({
      seats: [
        { kind: "bot", seatIndex: 0, botID: "random", label: "Random" },
        { kind: "open", seatIndex: 1 },
      ],
      seatedCount: 1,
    });
    render(<LobbyWithBots lobby={view} />);

    const slot = document.querySelector('[data-seat-index="0"][data-seat-kind="bot"]') as HTMLElement;
    expect(slot).not.toBeNull();
    expect(within(slot).getByText(/Bot · Random/i)).toBeTruthy();
    const clearBtn = within(slot).getByRole("button", { name: /clear bot/i });
    fireEvent.click(clearBtn);
    expect(view.clearSeat).toHaveBeenCalledWith(0);
  });

  test("non-host viewer sees a bot seat as a read-only chip", () => {
    const view = makeView({
      isHost: false,
      hostUserID: "someone-else",
      seats: [
        { kind: "bot", seatIndex: 0, botID: "random", label: "Random" },
        { kind: "open", seatIndex: 1 },
      ],
      seatedCount: 1,
    });
    render(<LobbyWithBots lobby={view} />);

    const slot = document.querySelector('[data-seat-index="0"][data-seat-kind="bot"]') as HTMLElement;
    expect(within(slot).getByText(/Bot · Random/i)).toBeTruthy();
    expect(within(slot).queryByRole("button", { name: /clear bot/i })).toBeNull();
  });

  test("human seat (mine) shows Leave; (other) shows Kick when host", () => {
    const view = makeView({
      mySeatIndex: 0,
      seats: [
        {
          kind: "human",
          seatIndex: 0,
          userID: "alice",
          userName: "Alice",
          ready: false,
          connected: true,
        },
        {
          kind: "human",
          seatIndex: 1,
          userID: "bob",
          userName: "Bob",
          ready: true,
          connected: true,
        },
      ],
      seatedCount: 2,
    });
    render(<LobbyWithBots lobby={view} />);

    const mySlot = document.querySelector('[data-seat-index="0"][data-seat-kind="human"]') as HTMLElement;
    fireEvent.click(within(mySlot).getByRole("button", { name: /leave seat/i }));
    expect(view.leaveSeat).toHaveBeenCalledTimes(1);

    const otherSlot = document.querySelector('[data-seat-index="1"][data-seat-kind="human"]') as HTMLElement;
    fireEvent.click(within(otherSlot).getByRole("button", { name: /kick player/i }));
    expect(view.clearSeat).toHaveBeenCalledWith(1);
  });

  test("disables actions when phase is not 'lobby'", () => {
    const view = makeView({ phase: "active" });
    render(<LobbyWithBots lobby={view} />);

    const slot = document.querySelector('[data-seat-index="0"][data-seat-kind="open"]') as HTMLElement;
    const takeBtn = within(slot).getByRole("button", { name: /take seat/i });
    expect((takeBtn as HTMLButtonElement).disabled).toBe(true);
  });
});
