import { describe, expect, test } from "bun:test";

import { turn } from "@openturn/gamekit";
import { createLocalSession } from "@openturn/core";

import { definePlugin, withPlugins } from "./index";

const noopMatch = { players: ["0", "1"] as const };

interface CounterState {
  ticks: number;
}

const baseGame = {
  playerIDs: noopMatch.players,
  setup: (): CounterState => ({ ticks: 0 }),
  turn: turn.roundRobin(),
  moves: ({ move }: { move: (def: unknown) => unknown }) => ({
    tick: move({
      run({ G, move }: { G: CounterState; move: { endTurn: (patch?: unknown) => unknown } }) {
        return move.endTurn({ ticks: G.ticks + 1 });
      },
    }),
  }),
  views: {
    public: ({ G }: { G: CounterState }) => ({ ticks: G.ticks }),
    player: ({ G }: { G: CounterState }) => ({ ticks: G.ticks }),
  },
};

interface ChatSlice {
  messages: { from: string; text: string }[];
}

const chatPlugin = definePlugin({
  id: "chat",
  setup: (): ChatSlice => ({ messages: [] }),
  moves: {
    send: {
      run({ G, args, player }) {
        const text = (args as { text: string }).text;
        if (text.length === 0) {
          return { kind: "invalid", reason: "empty" };
        }
        return {
          kind: "stay",
          patch: { messages: [...G.messages, { from: player.id, text }] },
        };
      },
    },
  },
});

interface VotesSlice {
  voters: string[];
}

const votesPlugin = definePlugin({
  id: "votes",
  setup: (): VotesSlice => ({ voters: [] }),
  moves: {
    castVote: {
      run({ G, player }) {
        if (G.voters.includes(player.id)) {
          return { kind: "invalid", reason: "duplicate" };
        }
        return { kind: "stay", patch: { voters: [...G.voters, player.id] } };
      },
    },
  },
});

describe("withPlugins", () => {
  test("merges plugin setup into G.plugins", () => {
    const game = withPlugins(baseGame, [chatPlugin, votesPlugin]);
    const session = createLocalSession(game, { match: noopMatch });
    const snapshot = session.getState();

    expect(snapshot.G).toMatchObject({
      ticks: 0,
      plugins: {
        chat: { messages: [] },
        votes: { voters: [] },
      },
    });
  });

  test("plugin moves are namespaced and dispatchable by any player", () => {
    const game = withPlugins(baseGame, [chatPlugin]);
    const session = createLocalSession(game, { match: noopMatch });

    // Player "1" is not the active player at turn 0 (round-robin starts at "0").
    // Plugin moves default to canPlayer = () => true, so this should succeed.
    const outcome = (session.dispatch as Record<string, (...args: unknown[]) => { ok: boolean }>)
      .chat__send("1", { text: "hi" });
    expect(outcome.ok).toBe(true);

    const snapshot = session.getState();
    const slice = (snapshot.G as { plugins: { chat: ChatSlice } }).plugins.chat;
    expect(slice.messages).toEqual([{ from: "1", text: "hi" }]);
  });

  test("invalid plugin outcome rejects the move", () => {
    const game = withPlugins(baseGame, [chatPlugin]);
    const session = createLocalSession(game, { match: noopMatch });

    const outcome = (session.dispatch as Record<string, (...args: unknown[]) => { ok: boolean }>)
      .chat__send("0", { text: "" });
    expect(outcome.ok).toBe(false);
  });

  test("plugin moves do not advance the turn", () => {
    const game = withPlugins(baseGame, [chatPlugin]);
    const session = createLocalSession(game, { match: noopMatch });

    const before = session.getState().position.turn;
    (session.dispatch as Record<string, (...args: unknown[]) => unknown>).chat__send("0", { text: "hi" });
    const after = session.getState().position.turn;
    expect(after).toBe(before);
  });

  test("multiple plugins coexist and own their own slices", () => {
    const game = withPlugins(baseGame, [chatPlugin, votesPlugin]);
    const session = createLocalSession(game, { match: noopMatch });

    (session.dispatch as Record<string, (...args: unknown[]) => unknown>).chat__send("0", { text: "hello" });
    (session.dispatch as Record<string, (...args: unknown[]) => unknown>).votes__castVote("1", undefined);

    const snapshot = session.getState();
    const slices = (snapshot.G as { plugins: { chat: ChatSlice; votes: VotesSlice } }).plugins;
    expect(slices.chat.messages).toHaveLength(1);
    expect(slices.votes.voters).toEqual(["1"]);
  });

  test("plugin slices appear in player views", () => {
    const game = withPlugins(baseGame, [chatPlugin]);
    const session = createLocalSession(game, { match: noopMatch });

    (session.dispatch as Record<string, (...args: unknown[]) => unknown>).chat__send("0", { text: "visible" });

    const view = session.getPlayerView("1") as { plugins: { chat: ChatSlice } };
    expect(view.plugins.chat.messages).toEqual([{ from: "0", text: "visible" }]);
  });

  test("rejects duplicate plugin ids", () => {
    expect(() => withPlugins(baseGame, [chatPlugin, chatPlugin])).toThrow(/duplicate plugin id/);
  });

  test("base move still works alongside plugin moves", () => {
    const game = withPlugins(baseGame, [chatPlugin]);
    const session = createLocalSession(game, { match: noopMatch });

    const outcome = (session.dispatch as Record<string, (...args: unknown[]) => { ok: boolean }>)
      .tick("0", undefined);
    expect(outcome.ok).toBe(true);
    const snapshot = session.getState();
    expect((snapshot.G as { ticks: number }).ticks).toBe(1);
  });
});
