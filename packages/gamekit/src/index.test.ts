import { describe, expect, test } from "bun:test";

import { compileGameGraph, createLocalSession, deadline, type ConfigSchema } from "@openturn/core";

import { defineGame, modifiers, turn, view } from "./index";

const reviewGame = defineGame({
  maxPlayers: 2,
  computed: {
    doubled: ({ G }) => G.count * 2,
  },
  initialPhase: "play",
  moves: ({ move }) => ({
    advance: move<{ step: number }>({
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

  test("inline move.invalid surfaces a custom reason when a move self-rejects off-turn", () => {
    const inlineGuardGame = defineGame({
      maxPlayers: 3,
      initialPhase: "play",
      moves: ({ move }) => ({
        act: move({
          run({ move: m, player, turn: t }) {
            if (player.id !== t.currentPlayer) return m.invalid("not_your_turn");
            return m.endTurn();
          },
        }),
      }),
      phases: {
        play: {
          activePlayers: () => ["0", "1", "2"],
        },
      },
      setup: () => ({}),
    });

    const session = createLocalSession(inlineGuardGame, {
      match: { players: ["0", "1", "2"] as const },
    });

    expect(session.applyEvent("1", "act", undefined)).toEqual({
      error: "invalid_event",
      ok: false,
      reason: "not_your_turn",
    });
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

describe("phase.onTimeout", () => {
  test("returning a moves dispatch executes that move's logic", () => {
    const game = defineGame({
      maxPlayers: 2,
      moves: ({ move }) => ({
        place: move<{ value: number }>({
          run({ args, move }) {
            return move.stay({ last: args.value });
          },
        }),
      }),
      phases: {
        play: {
          deadline: () => 1_000,
          onTimeout: (_ctx, moves) => moves.place({ value: 42 }),
        },
      },
      setup: () => ({ last: 0 }),
    });
    const session = createLocalSession(game, {
      match: { players: ["0", "1"] as const },
      now: 0,
    });
    session.fireTimeout(2_000);
    expect(session.getState().G.last).toBe(42);
  });

  test("returning { kind: 'finish' } ends the game", () => {
    const game = defineGame({
      maxPlayers: 2,
      moves: () => ({}),
      phases: {
        play: {
          deadline: () => 1_000,
          onTimeout: () => ({ kind: "finish" as const, result: { winner: "0" } }),
        },
      },
      setup: () => ({}),
    });
    const session = createLocalSession(game, {
      match: { players: ["0", "1"] as const },
      now: 0,
    });
    session.fireTimeout(2_000);
    expect(session.getState().position.name).toBe("__gamekit_finished");
  });

  test("returning null no-ops", () => {
    const game = defineGame({
      maxPlayers: 2,
      moves: () => ({}),
      phases: {
        play: {
          deadline: () => 1_000,
          onTimeout: () => null,
        },
      },
      setup: () => ({ count: 0 }),
    });
    const session = createLocalSession(game, {
      match: { players: ["0", "1"] as const },
      now: 0,
    });
    session.fireTimeout(2_000);
    expect(session.getState().G.count).toBe(0);
    expect(session.getState().position.name).toBe("play");
  });

  test("phase with deadline but no onTimeout: game stalls", () => {
    // A move is required to keep `__gamekit_finished` reachable (gamekit's
    // existing graph-validity rule). It's never invoked here — only its
    // synthesized finish transition matters for reachability.
    const game = defineGame({
      maxPlayers: 2,
      moves: ({ move }) => ({
        noop: move({
          run({ move: m, player }) {
            return m.finish({ winner: player.id });
          },
        }),
      }),
      phases: {
        play: {
          deadline: () => 1_000,
        },
      },
      setup: () => ({}),
    });
    const session = createLocalSession(game, {
      match: { players: ["0", "1"] as const },
      now: 0,
    });
    session.fireTimeout(2_000);
    expect(session.getState().position.name).toBe("play");
  });

  test("phase with onTimeout but no deadline emits validation warning", () => {
    expect(() => {
      defineGame({
        maxPlayers: 2,
        moves: () => ({}),
        phases: {
          play: {
            onTimeout: () => null,
          },
        },
        setup: () => ({}),
      });
    }).toThrow(/onTimeout.*deadline/i);
  });

  test("multi-phase: each phase's onTimeout is independent", () => {
    // Two phases each with their own deadline + onTimeout. Firing the timer
    // while in phase A invokes A's handler and transitions to phase B; firing
    // while in phase B invokes B's handler and finishes.
    const game = defineGame({
      maxPlayers: 2,
      moves: ({ move }) => ({
        toB: move({
          phases: ["a"],
          run({ move }) {
            return move.goto("b");
          },
        }),
        finishB: move({
          phases: ["b"],
          run({ move, player }) {
            return move.finish({ winner: player.id });
          },
        }),
      }),
      initialPhase: "a",
      phases: {
        a: {
          deadline: () => 1_000,
          onTimeout: (_ctx, moves) => moves.toB(),
        },
        b: {
          deadline: () => 1_000,
          onTimeout: () => ({ kind: "finish" as const, result: { winner: "1" } }),
        },
      },
      setup: () => ({}),
    });

    const session = createLocalSession(game, {
      match: { players: ["0", "1"] as const },
      now: 0,
    });

    expect(session.getState().position.name).toBe("a");
    session.fireTimeout(2_000);
    // Phase A's handler dispatched `toB`, which goto's to phase "b".
    expect(session.getState().position.name).toBe("b");

    session.fireTimeout(4_000);
    // Phase B's handler returned `{ kind: "finish" }`, which finalizes.
    expect(session.getState().position.name).toBe("__gamekit_finished");
  });
});

describe("config + ctx.match.config integration", () => {
  test("phase.deadline can read ctx.match.config and ctx.now via deadline.after", () => {
    // The author declares a `config` schema with a `turnTimeoutMs` field; the
    // phase's deadline expresses "now + turnTimeoutMs" via core's `deadline.after`
    // helper. Verifies that gamekit threads `match` and `now` into the
    // ViewContext consumed by `phase.deadline`, and that the locked config
    // value flows from the schema's `default` through `normalizeMatchInput`.
    const game = defineGame({
      maxPlayers: 2,
      config: {
        turnTimeoutMs: { type: "number", default: 30_000, label: "Turn time" },
      } as const satisfies ConfigSchema,
      // A no-op finish move keeps `__gamekit_finished` reachable so the
      // graph-validity check passes; only the deadline value is asserted here.
      moves: ({ move }) => ({
        end: move({
          run: ({ move: m, player }) => m.finish({ winner: player.id }),
        }),
      }),
      phases: {
        play: {
          deadline: (ctx) => deadline.after(ctx, ctx.match.config.turnTimeoutMs),
        },
      },
      setup: () => ({}),
    });
    const session = createLocalSession(game, {
      match: { players: ["0", "1"] as const },
      now: 1_000,
    });
    expect(session.getNextDeadline()).toBe(31_000);
  });

  test("phase.onTimeout can read ctx.match.config", () => {
    // The timeout handler dispatches one of two moves based on a config flag.
    // Verifies that the typed match.config flows into the timeout context
    // and that the synthesized timeout transition's resolver picks up the
    // right move based on it.
    const game = defineGame({
      maxPlayers: 2,
      config: {
        useFinish: { type: "boolean", default: true, label: "Use finish" },
      } as const satisfies ConfigSchema,
      moves: ({ move }) => ({
        stayMove: move({
          run: ({ G, move: m }) => m.stay({ count: (G.count as number) + 1 }),
        }),
        finishMove: move({
          run: ({ move: m, player }) => m.finish({ winner: player.id }),
        }),
      }),
      phases: {
        play: {
          deadline: () => 1_000,
          onTimeout: (ctx, moves) =>
            ctx.match.config.useFinish
              ? moves.finishMove()
              : moves.stayMove(),
        },
      },
      setup: () => ({ count: 0 }),
    });

    // useFinish defaults to true → onTimeout dispatches `finishMove`, which
    // ends the match.
    const finishSession = createLocalSession(game, {
      match: { players: ["0", "1"] as const },
      now: 0,
    });
    finishSession.fireTimeout(2_000);
    expect(finishSession.getState().position.name).toBe("__gamekit_finished");

    // useFinish overridden to false → onTimeout dispatches `stayMove`, which
    // mutates G.count and stays in `play`.
    const staySession = createLocalSession(game, {
      match: { players: ["0", "1"] as const, config: { useFinish: false } },
      now: 0,
    });
    staySession.fireTimeout(2_000);
    expect(staySession.getState().position.name).toBe("play");
    expect(staySession.getState().G.count).toBe(1);
  });

  test("move handlers can read ctx.match.config", () => {
    // A move's `run` reads ctx.match.config to compute its patch. Verifies
    // that the typed match.config flows into MovePermissionContext and is
    // visible to regular move handlers, not just timeout handlers.
    const game = defineGame({
      maxPlayers: 2,
      config: {
        increment: { type: "number", default: 5, label: "Increment" },
      } as const satisfies ConfigSchema,
      moves: ({ move }) => ({
        bump: move({
          run: ({ G, match, move: m }) =>
            m.endTurn({ count: (G.count as number) + match.config.increment }),
        }),
      }),
      setup: () => ({ count: 0 }),
    });
    const session = createLocalSession(game, {
      match: { players: ["0", "1"] as const, config: { increment: 7 } },
      now: 0,
    });
    session.dispatch.bump("0");
    expect(session.getState().G.count).toBe(7);
  });
});
