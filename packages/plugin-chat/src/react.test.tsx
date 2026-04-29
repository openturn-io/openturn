// @vitest-environment jsdom

import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { ChatBubble, type ChatHostMatch, type ChatHostRoom } from "./react";

afterEach(() => {
  cleanup();
});

function fakeRoom(overrides: Partial<ChatHostMatch> = {}): ChatHostRoom {
  const dispatch = vi.fn(async () => ({ ok: true as const, clientActionID: "x" }));
  return {
    userID: "u1",
    userName: "Alex",
    game: {
      snapshot: { G: { plugins: { chat: { messages: [] } } } },
      dispatch: { chat__send: dispatch as never } as never,
      playerID: "0",
      ...overrides,
    },
  };
}

describe("ChatBubble", () => {
  test("renders the floating bubble at the bottom-right of the viewport", () => {
    render(<ChatBubble room={fakeRoom()} />);

    const bubble = document.querySelector("button[aria-label^=\"Open chat\"]");
    expect(bubble).toBeTruthy();

    const root = bubble!.parentElement!;
    expect(root.parentElement).toBe(document.body);

    const style = root.style;
    expect(style.position).toBe("fixed");
    expect(style.bottom).toBe("24px");
    expect(style.right).toBe("24px");
  });

  test("stays in bottom-right when the host page sets `body > div { width: 100%; height: 100% }`", () => {
    // Reproduces the integration with example/tic-tac-toe-with-chat where
    // styles.css declares `body > div { width: 100%; height: 100% }` — the
    // portal target is document.body, so the bubble's own root div would
    // otherwise inherit those dimensions and stretch across the viewport.
    const sheet = document.createElement("style");
    sheet.textContent = "body > div { width: 100%; height: 100%; min-height: 100%; }";
    document.head.appendChild(sheet);

    try {
      render(<ChatBubble room={fakeRoom()} />);

      const root = document.querySelector("button[aria-label^=\"Open chat\"]")!.parentElement!;
      const computed = window.getComputedStyle(root);
      expect(computed.width).not.toBe("100%");
      expect(computed.height).not.toBe("100%");
    } finally {
      sheet.remove();
    }
  });

  test("opens the panel and sends a message via the Send button", async () => {
    const room = fakeRoom();
    const dispatch = (room.game!.dispatch as Record<string, ReturnType<typeof vi.fn>>).chat__send;

    render(<ChatBubble room={room} />);

    fireEvent.click(document.querySelector("button[aria-label^=\"Open chat\"]")!);

    const input = document.querySelector("input[aria-label=\"Message\"]") as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.disabled).toBe(false);

    fireEvent.change(input, { target: { value: "hello" } });

    const sendBtn = document.querySelector("button[aria-label=\"Send message\"]") as HTMLButtonElement;
    expect(sendBtn.type).toBe("button"); // not "submit" — sandboxed iframes without `allow-forms` would block form submission
    expect(sendBtn.disabled).toBe(false);

    await act(async () => {
      fireEvent.click(sendBtn);
    });

    expect(dispatch).toHaveBeenCalledWith({ text: "hello", displayName: "Alex" });
  });

  test("sends on Enter key in the input (no form element involved)", async () => {
    const room = fakeRoom();
    const dispatch = (room.game!.dispatch as Record<string, ReturnType<typeof vi.fn>>).chat__send;

    render(<ChatBubble room={room} />);

    fireEvent.click(document.querySelector("button[aria-label^=\"Open chat\"]")!);

    const input = document.querySelector("input[aria-label=\"Message\"]") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "hi via enter" } });

    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });

    expect(dispatch).toHaveBeenCalledWith({ text: "hi via enter", displayName: "Alex" });
  });

  test("uses a player label when the hosted identity is anonymous", async () => {
    const room = { ...fakeRoom(), userID: "WtnIVz9", userName: "Anonymous" };
    const dispatch = (room.game!.dispatch as Record<string, ReturnType<typeof vi.fn>>).chat__send;

    render(<ChatBubble room={room} />);

    fireEvent.click(document.querySelector("button[aria-label^=\"Open chat\"]")!);

    const input = document.querySelector("input[aria-label=\"Message\"]") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "hello" } });

    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });

    expect(dispatch).toHaveBeenCalledWith({ text: "hello", displayName: "Player WtnIVz" });
  });

  test("does not render a <form> element (avoids sandboxed-iframe blocks)", () => {
    render(<ChatBubble room={fakeRoom()} />);

    fireEvent.click(document.querySelector("button[aria-label^=\"Open chat\"]")!);

    expect(document.querySelector("form")).toBeNull();
  });

  test("disables send when sendDispatch is missing", () => {
    const room = fakeRoom();
    (room.game!.dispatch as Record<string, unknown>) = { placeMark: () => {} };

    render(<ChatBubble room={room} />);

    fireEvent.click(document.querySelector("button[aria-label^=\"Open chat\"]")!);

    const input = document.querySelector("input[aria-label=\"Message\"]") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "hi" } });

    const sendBtn = document.querySelector("button[aria-label=\"Send message\"]") as HTMLButtonElement;
    expect(sendBtn.disabled).toBe(true);
  });
});
