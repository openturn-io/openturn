import { describe, expect, test } from "vitest";
import { defineBot } from "@openturn/bot";
import { createLocalSession, type PlayerID } from "@openturn/core";
import { defineGame, turn } from "@openturn/gamekit";

import { defineBotRegistry } from "../registry";
import { createLocalBotSupervisor } from "./local";

interface CounterState {
  value: number;
  log: string[];
}

interface IncArgs {
  amount: number;
}

const counterMatch = { players: ["0", "1"] as const };

const counterGame = defineGame({
  playerIDs: counterMatch.players,
  setup: (): CounterState => ({ value: 0, log: [] }),
  turn: turn.roundRobin(),
  legalActions: ({ G, derived }, playerID) => {
    if (!derived.activePlayers.includes(playerID)) return [];
    return [
      { event: "inc", payload: { amount: 1 } },
      { event: "inc", payload: { amount: 2 } },
      { event: "inc", payload: { amount: 3 } },
    ];
  },
  moves: ({ move }) => ({
    inc: move<IncArgs>({
      run({ G, args, move, player }) {
        const value = G.value + args.amount;
        const log = [...G.log, `${player.id}+${args.amount}`];
        if (value >= 10) return move.finish({ winner: player.id }, { value, log });
        return move.endTurn({ value, log });
      },
    }),
  }),
});

const alwaysOneBot = defineBot<typeof counterGame>({
  name: "always-one",
  decide: ({ legalActions }) =>
    legalActions.find((a) => (a.payload as IncArgs).amount === 1) ?? legalActions[0]!,
});

const alwaysThreeBot = defineBot<typeof counterGame>({
  name: "always-three",
  decide: ({ legalActions }) =>
    legalActions.find((a) => (a.payload as IncArgs).amount === 3) ?? legalActions[0]!,
});

const registry = defineBotRegistry<typeof counterGame>([
  { botID: "one", label: "Always 1", bot: alwaysOneBot },
  { botID: "three", label: "Always 3", bot: alwaysThreeBot },
]);

async function settle(ms = 30): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

describe("createLocalBotSupervisor()", () => {
  test("attaches a bot at start() and the bot dispatches on its turn", async () => {
    const session = createLocalSession(counterGame, { match: counterMatch, seed: "sup-1" });
    const supervisor = createLocalBotSupervisor({
      session,
      game: counterGame,
      registry,
    });

    await supervisor.start([
      { seatIndex: 1, playerID: "1", botID: "three" },
    ]);

    // Human plays seat 0 — must go through the facade so the bot is notified.
    const facade = supervisor.getSession();
    facade.applyEvent("0" as PlayerID, "inc", { amount: 1 });
    await settle();

    // Bot should have responded with +3.
    const snapshot = facade.getState();
    expect(snapshot.G.log).toContain("1+3");

    supervisor.stop();
  });

  test("two bots play each other to completion", async () => {
    const session = createLocalSession(counterGame, { match: counterMatch, seed: "sup-2" });
    const supervisor = createLocalBotSupervisor({
      session,
      game: counterGame,
      registry,
    });

    await supervisor.start([
      { seatIndex: 0, playerID: "0", botID: "three" },
      { seatIndex: 1, playerID: "1", botID: "three" },
    ]);

    const facade = supervisor.getSession();
    // Wait long enough for the bot loop to play to termination.
    for (let i = 0; i < 20; i += 1) {
      await settle();
      if (facade.getState().meta.result !== null) break;
    }

    const final = facade.getState();
    expect(final.meta.result).not.toBeNull();
    expect(final.G.log.length).toBeGreaterThanOrEqual(2);

    supervisor.stop();
  });

  test("rejects unknown botID at start()", async () => {
    const session = createLocalSession(counterGame, { match: counterMatch, seed: "sup-3" });
    const supervisor = createLocalBotSupervisor({
      session,
      game: counterGame,
      registry,
    });

    await expect(
      supervisor.start([{ seatIndex: 1, playerID: "1", botID: "nope" }]),
    ).rejects.toThrow(/unknown botID/);
  });

  test("calling start twice throws", async () => {
    const session = createLocalSession(counterGame, { match: counterMatch, seed: "sup-4" });
    const supervisor = createLocalBotSupervisor({
      session,
      game: counterGame,
      registry,
    });

    await supervisor.start([{ seatIndex: 1, playerID: "1", botID: "one" }]);
    await expect(
      supervisor.start([{ seatIndex: 1, playerID: "1", botID: "one" }]),
    ).rejects.toThrow(/already called/);

    supervisor.stop();
  });

  test("stop() removes runners; subsequent dispatch does not trigger the bot", async () => {
    const session = createLocalSession(counterGame, { match: counterMatch, seed: "sup-5" });
    const supervisor = createLocalBotSupervisor({
      session,
      game: counterGame,
      registry,
    });

    await supervisor.start([{ seatIndex: 1, playerID: "1", botID: "three" }]);
    const facade = supervisor.getSession();
    supervisor.stop();

    facade.applyEvent("0" as PlayerID, "inc", { amount: 1 });
    await settle();

    const snapshot = facade.getState();
    expect(snapshot.G.log).toEqual(["0+1"]);
  });
});
