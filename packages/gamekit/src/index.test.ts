import { describe, expect, test } from "bun:test";

import { compileGameGraph, createLocalSession } from "@openturn/core";

import { defineGame, modifiers, permissions, turn, view } from "./index";

const reviewGame = defineGame({
  maxPlayers: 2,
  computed: {
    doubled: ({ G }) => G.count * 2,
  },
  initialPhase: "play",
  moves: ({ move }) => ({
    advance: move<{ step: number }>({
      canPlayer: permissions.currentPlayer,
      phases: ["play"],
      run({ G, args, move }) {
        if (!Number.isInteger(args.step) || args.step <= 0) {
          return move.invalid("positive_only", {
            step: args.step,
          });
        }

        const count = G.count + args.step;
        const history = [...G.history, `advance:${args.step}`];

        if (count >= 2) {
          return move.goto("review", {
            count,
            history,
          }, {
            endTurn: true,
          });
        }

        return move.endTurn({
          count,
          history,
        });
      },
    }),
    finish: move({
      canPlayer: permissions.currentPlayer,
      phases: ["review"],
      run({ G, move, player }) {
        return move.finish({ winner: player.id }, {
          history: [...G.history, "finish"],
        });
      },
    }),
  }),
  phases: {
    play: {
      label: "Play",
    },
    review: {
      label: "Review",
    },
  },
  setup: () => ({
    count: 0,
    history: [] as string[],
  }),
  turn: turn.roundRobin(),
  views: {
    player: ({ G, turn }, player) => ({
      count: G.count,
      currentPlayer: turn.currentPlayer,
      seat: player.id,
    }),
    public: (context) => view.merge({
      count: context.G.count,
      currentPlayer: context.turn.currentPlayer,
      phase: context.phase,
    }, context, "doubled"),
  },
});

const sharedPhaseGame = defineGame({
  maxPlayers: 3,
  initialPhase: "plan",
  moves: ({ move }) => ({
    submit: move<"paper" | "rock" | "scissors">({
      run({ G, args, move, player }) {
        const submissions = {
          ...G.submissions,
          [player.id]: args,
        };

        if (Object.keys(submissions).length < 3) {
          return move.stay({ submissions });
        }

        return move.endTurn({ submissions: {} as Record<string, never> });
      },
    }),
  }),
  phases: {
    plan: {
      activePlayers: ({ G }) => ["0", "1", "2"].filter((playerID) => G.submissions[playerID] === undefined),
      label: ({ G }) => `Round ${G.round}`,
    },
  },
  setup: () => ({
    round: 1,
    submissions: {} as Partial<Record<"0" | "1" | "2", "paper" | "rock" | "scissors">>,
  }),
});

describe("@openturn/gamekit", () => {
  test("compiles move-first turn progression into strict core state transitions", () => {
    const session = createLocalSession(reviewGame, { match: { players: ["0", "1"] as const } });
    const initialPublicView = session.getPublicView();
    const doubled: number = initialPublicView.doubled;
    const initialPhase: "play" | "review" = initialPublicView.phase;

    expect(session.getState().position.name).toBe("play");
    expect(session.getState().derived.activePlayers).toEqual(["0"]);
    expect(doubled).toBe(0);
    expect(initialPhase).toBe("play");
    expect(initialPublicView).toEqual({
      count: 0,
      currentPlayer: "0",
      doubled: 0,
      phase: "play",
    });

    const firstAdvance = session.applyEvent("0", "advance", { step: 1 });
    expect(firstAdvance.ok).toBe(true);
    expect(session.getState().G).toEqual({
      __gamekit: {
        result: null,
      },
      count: 1,
      history: ["advance:1"],
    });
    expect(session.getState().derived.activePlayers).toEqual(["1"]);
    expect(session.getState().derived.selectors.doubled).toBe(2);
    const playerView = session.getPlayerView("1");
    const seat: "0" | "1" = playerView.seat;
    expect(seat).toBe("1");
    expect(playerView).toEqual({
      count: 1,
      currentPlayer: "1",
      seat: "1",
    });

    expect(session.applyEvent("0", "advance", { step: 1 })).toEqual({
      error: "inactive_player",
      ok: false,
    });

    const secondAdvance = session.applyEvent("1", "advance", { step: 1 });
    expect(secondAdvance.ok).toBe(true);
    expect(session.getState().position.name).toBe("review");
    expect(session.getState().derived.activePlayers).toEqual(["0"]);
    expect(session.getPublicView()).toEqual({
      count: 2,
      currentPlayer: "0",
      doubled: 4,
      phase: "review",
    });

    const finish = session.applyEvent("0", "finish", undefined);
    expect(finish.ok).toBe(true);
    expect(session.getResult()).toEqual({
      winner: "0",
    });
    expect(session.getState().position.name).toBe("__gamekit_finished");
    expect(session.getState().derived.activePlayers).toEqual([]);
  });

  test("returns invalid_event when a move helper rejects the payload", () => {
    const session = createLocalSession(reviewGame, { match: { players: ["0", "1"] as const } });

    expect(session.applyEvent("0", "advance", { step: 0 })).toEqual({
      details: {
        step: 0,
      },
      error: "invalid_event",
      ok: false,
      reason: "positive_only",
    });
    expect(session.getState().G.count).toBe(0);
    expect(session.getState().derived.activePlayers).toEqual(["0"]);
  });

  test("phase config can override active players and derive labels without core escape hatches", () => {
    const session = createLocalSession(sharedPhaseGame, {
      match: {
        players: ["0", "1", "2"],
      },
    });

    expect(session.getState().derived.activePlayers).toEqual(["0", "1", "2"]);
    expect(session.getState().derived.controlMeta.label).toBe("Round 1");

    expect(session.applyEvent("0", "submit", "rock").ok).toBe(true);
    expect(session.getState().derived.activePlayers).toEqual(["1", "2"]);
  });

  test("emits static turn metadata for generated move transitions", () => {
    const graph = compileGameGraph(reviewGame);

    expect(graph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        event: "advance",
        from: "play",
        resolver: "advance:play:end_turn",
        to: "play",
        turn: "increment",
      }),
      expect.objectContaining({
        event: "advance",
        from: "play",
        resolver: "advance:play:goto:review:end_turn",
        to: "review",
        turn: "increment",
      }),
      expect.objectContaining({
        event: "finish",
        from: "review",
        resolver: "finish:review:finish",
        to: "__gamekit_finished",
        turn: "increment",
      }),
    ]));
  });

  test("re-exports modifier evaluation helpers for gamekit auth flows", () => {
    const evaluation = modifiers.evaluateNumber({
      base: 4,
      context: null,
      modifiers: [
        {
          apply(value) {
            return value * 2;
          },
          id: "double",
          stage: "scale",
        },
        {
          apply(value) {
            return value + 3;
          },
          id: "bonus",
          stage: "bonus",
        },
      ],
      stageOrder: ["scale", "bonus"],
    });

    expect(evaluation.value).toBe(11);
    expect(evaluation.applied.map((modifier) => modifier.id)).toEqual(["double", "bonus"]);
  });
});
