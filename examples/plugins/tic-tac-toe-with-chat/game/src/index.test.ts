import { describe, expect, test } from "bun:test";

import { createLocalSession } from "@openturn/core";

import { ticTacToeWithChat } from "./index";

const ticTacToeWithChatMatch = { players: ticTacToeWithChat.playerIDs };

describe("ticTacToeWithChat composed game", () => {
  test("base placeMark move still rejects non-current players", () => {
    const session = createLocalSession(ticTacToeWithChat, { match: ticTacToeWithChatMatch });

    const dispatch = session.dispatch as Record<string, (...args: unknown[]) => { ok: boolean }>;
    // Player "1" tries to place when it's player "0"'s turn — must be rejected
    // by the wrapped `canPlayer = currentPlayer` shim that `withPlugins` adds.
    const offTurn = dispatch.placeMark!("1", { row: 0, col: 0 });
    expect(offTurn.ok).toBe(false);

    const onTurn = dispatch.placeMark!("0", { row: 0, col: 0 });
    expect(onTurn.ok).toBe(true);
  });

  test("chat__send is dispatchable by either player", () => {
    const session = createLocalSession(ticTacToeWithChat, { match: ticTacToeWithChatMatch });
    const dispatch = session.dispatch as Record<string, (...args: unknown[]) => { ok: boolean }>;

    const fromCurrent = dispatch.chat__send!("0", { text: "hi from X", displayName: "Alex" });
    expect(fromCurrent.ok).toBe(true);

    const fromOther = dispatch.chat__send!("1", { text: "hi from O", displayName: "Bo" });
    expect(fromOther.ok).toBe(true);

    const view = session.getPlayerView("1") as { plugins?: { chat?: { messages: Array<{ text: string }> } } };
    expect(view.plugins?.chat?.messages.map((m) => m.text)).toEqual(["hi from X", "hi from O"]);
  });

  test("chat does not advance the turn", () => {
    const session = createLocalSession(ticTacToeWithChat, { match: ticTacToeWithChatMatch });
    const dispatch = session.dispatch as Record<string, (...args: unknown[]) => { ok: boolean }>;

    const before = session.getState().position.turn;
    dispatch.chat__send!("0", { text: "noop", displayName: "Alex" });
    const after = session.getState().position.turn;
    expect(after).toBe(before);
  });

  test("placeMark advances the turn after composition", () => {
    const session = createLocalSession(ticTacToeWithChat, { match: ticTacToeWithChatMatch });
    const dispatch = session.dispatch as Record<string, (...args: unknown[]) => { ok: boolean }>;

    const before = session.getState().position.turn;
    dispatch.placeMark!("0", { row: 1, col: 1 });
    const after = session.getState().position.turn;
    expect(after).toBe(before + 1);
  });

  test("chat history is included in player views (no hidden info)", () => {
    const session = createLocalSession(ticTacToeWithChat, { match: ticTacToeWithChatMatch });
    const dispatch = session.dispatch as Record<string, (...args: unknown[]) => { ok: boolean }>;

    dispatch.chat__send!("0", { text: "visible", displayName: "Alex" });

    const viewForP0 = session.getPlayerView("0") as { plugins?: { chat?: { messages: unknown[] } } };
    const viewForP1 = session.getPlayerView("1") as { plugins?: { chat?: { messages: unknown[] } } };
    expect(viewForP0.plugins?.chat?.messages).toHaveLength(1);
    expect(viewForP1.plugins?.chat?.messages).toHaveLength(1);
  });
});
