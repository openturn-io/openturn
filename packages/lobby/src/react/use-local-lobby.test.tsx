import { afterEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { defineBot } from "@openturn/bot";
import { defineGame, turn } from "@openturn/gamekit";

import { defineBotRegistry } from "../registry";
import { useLocalLobbyChannel } from "./use-local-lobby";

afterEach(() => {
  cleanup();
});

interface CountState {
  value: number;
}

interface IncArgs {
  amount: number;
}

const countMatch = { players: ["0", "1"] as const };

const countGame = defineGame({
  playerIDs: countMatch.players,
  setup: (): CountState => ({ value: 0 }),
  turn: turn.roundRobin(),
  legalActions: () => [],
  moves: ({ move }) => ({
    inc: move<IncArgs>({
      run({ G, args, move }) {
        return move.endTurn({ value: G.value + args.amount });
      },
    }),
  }),
});

const dummyBot = defineBot<typeof countGame>({
  name: "dummy",
  decide: ({ legalActions }) => legalActions[0]!,
});

const registry = defineBotRegistry<typeof countGame>([
  { botID: "dummy", label: "Dummy", bot: dummyBot },
]);

describe("useLocalLobbyChannel", () => {
  test("auto-seats the host and starts in 'connected' state", () => {
    const { result } = renderHook(() =>
      useLocalLobbyChannel({
        game: countGame,
        match: countMatch,
        hostUserID: "host",
        hostUserName: "Host",
        registry,
        minPlayers: 1,
      }),
    );

    expect(result.current.status).toBe("connected");
    expect(result.current.state).not.toBeNull();
    const seats = result.current.state!.seats;
    expect(seats[0]!.kind).toBe("human");
    expect(seats[1]!.kind).toBe("open");
    expect(result.current.state!.availableBots).toEqual([
      { botID: "dummy", label: "Dummy" },
    ]);
  });

  test("assignBot puts a bot in the open seat and start() fires onTransitionToGame", () => {
    const onTransition = vi.fn();
    const { result } = renderHook(() =>
      useLocalLobbyChannel({
        game: countGame,
        match: countMatch,
        hostUserID: "host",
        hostUserName: "Host",
        registry,
        onTransitionToGame: onTransition,
      }),
    );

    act(() => {
      result.current.assignBot(1, "dummy");
    });

    expect(result.current.state!.seats[1]).toEqual({
      kind: "bot",
      seatIndex: 1,
      botID: "dummy",
      label: "Dummy",
    });

    act(() => {
      result.current.start();
    });

    expect(onTransition).toHaveBeenCalledTimes(1);
    expect(result.current.transition).not.toBeNull();
    expect(result.current.transition!.playerAssignments).toEqual([
      { seatIndex: 0, playerID: "0", kind: "human" },
      { seatIndex: 1, playerID: "1", kind: "bot", botID: "dummy" },
    ]);
    expect(result.current.status).toBe("transitioning");
  });

  test("rejects unknown botID via lastRejection", () => {
    const { result } = renderHook(() =>
      useLocalLobbyChannel({
        game: countGame,
        match: countMatch,
        hostUserID: "host",
        registry,
      }),
    );

    act(() => {
      result.current.assignBot(1, "nope");
    });

    expect(result.current.lastRejection).toEqual({
      type: "lobby:rejected",
      reason: "unknown_bot",
      echoType: "lobby:assign_bot",
    });
  });

  test("clearSeat removes the bot from a seat", () => {
    const { result } = renderHook(() =>
      useLocalLobbyChannel({
        game: countGame,
        match: countMatch,
        hostUserID: "host",
        registry,
      }),
    );

    act(() => {
      result.current.assignBot(1, "dummy");
    });
    expect(result.current.state!.seats[1]!.kind).toBe("bot");

    act(() => {
      result.current.clearSeat(1);
    });
    expect(result.current.state!.seats[1]!.kind).toBe("open");
  });
});
