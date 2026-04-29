import { describe, expect, test } from "bun:test";

import {
  compileGameGraph,
  createLocalSession,
  createRng,
  defineGame,
  getGameValidationReport,
  getGameControlSummary,
  InvalidGameDefinitionError,
  rejectTransition,
  resolveRoundRobinTurn,
  roundRobin,
} from "./index";

const match = {
  players: ["0", "1"] as const,
};

describe("@openturn/core", () => {
  test("rejects undeclared transition targets", () => {
    expect(() => {
      createLocalSession(defineGame({
        playerIDs: match.players,
        events: { start: undefined },
        initial: "idle",
        setup: () => ({ count: 0 }),
        states: {
          idle: {
            activePlayers: ({ match: nextMatch }) => [nextMatch.players[0]],
          },
        },
        transitions: [
          {
            event: "start",
            from: "idle",
            to: "missing" as "idle",
          },
        ],
      }), { match });
    }).toThrow(InvalidGameDefinitionError);
  });

  test("resolves replay-pure transitions and queued internal events deterministically", () => {
    const session = createLocalSession(defineGame({
      playerIDs: match.players,
      events: {
        advance: undefined,
        commit: undefined,
      },
      initial: "idle",
      setup: () => ({ count: 0 }),
      states: {
        done: { activePlayers: () => [] },
        idle: {
          activePlayers: ({ match: nextMatch, position }) => roundRobin.activePlayers(nextMatch.players, position.turn),
          control: ({ G }) => ({ countLabel: `count:${G.count}` }),
          deadline: ({ now }) => now + 30,
          label: ({ position }) => `Turn ${position.turn}`,
          metadata: ({ G }) => [{ key: "count", value: G.count }],
        },
      },
      transitions: [
        {
          event: "advance",
          from: "idle",
          label: "advance_if_zero",
          resolve: ({ G }) => G.count === 0 ? {
            G: { count: 1 },
            enqueue: [{ kind: "commit" }],
            turn: "increment",
          } : null,
          to: "idle",
        },
        {
          event: "commit",
          from: "idle",
          label: "commit_always",
          resolve: ({ G }) => ({
            G: { count: G.count + 1 },
            result: { winner: "0" },
          }),
          to: "done",
        },
      ],
    }), { match, seed: "alpha" });

    const result = session.applyEvent("0", "advance", undefined);

    expect(result.ok).toBe(true);
    expect(session.getState().G).toEqual({ count: 2 });
    expect(session.getResult()).toEqual({ winner: "0" });
    expect(result.ok && result.batch.steps.map((step) => step.kind)).toEqual(["action", "internal"]);
    expect(result.ok && result.batch.steps[0]?.transition.resolver).toBe("advance_if_zero");
    expect(result.ok && result.batch.steps[0]?.transition.turn).toBe("increment");
    expect(result.ok && result.batch.steps[0]?.transition.enqueued).toEqual([{ kind: "commit", payload: null }]);
  });

  test("exposes deterministic rng consumption in observed transitions", () => {
    const session = createLocalSession(defineGame({
      playerIDs: match.players,
      events: { roll: undefined },
      initial: "idle",
      setup: () => ({ value: 0 }),
      states: {
        idle: {
          activePlayers: ({ match: nextMatch }) => [nextMatch.players[0]],
        },
      },
      transitions: [
        {
          event: "roll",
          from: "idle",
          resolve: ({ rng }) => ({
            G: { value: rng.int(6) + 1 },
          }),
          to: "idle",
        },
      ],
    }), { match, seed: "seeded" });

    const first = session.applyEvent("0", "roll", undefined);
    const secondSession = createLocalSession(defineGame({
      playerIDs: match.players,
      events: { roll: undefined },
      initial: "idle",
      setup: () => ({ value: 0 }),
      states: {
        idle: {
          activePlayers: ({ match: nextMatch }) => [nextMatch.players[0]],
        },
      },
      transitions: [
        {
          event: "roll",
          from: "idle",
          resolve: ({ rng }) => ({
            G: { value: rng.int(6) + 1 },
          }),
          to: "idle",
        },
      ],
    }), { match, seed: "seeded" });
    const second = secondSession.applyEvent("0", "roll", undefined);

    expect(first.ok && second.ok && first.batch.snapshot.G).toEqual(second.batch.snapshot.G);
    expect(first.ok && first.batch.steps[0]?.transition.rng?.draws).toBe(1);
  });

  test("compiles graph metadata with resolver labels", () => {
    function canPlay() {
      return {
        G: { count: 1 },
      };
    }

    const graph = compileGameGraph(defineGame({
      playerIDs: match.players,
      events: { play: undefined },
      initial: "idle",
      setup: () => ({ count: 0 }),
      states: {
        done: { activePlayers: () => [] },
        idle: { activePlayers: ({ match: nextMatch }) => [nextMatch.players[0]] },
      },
      transitions: [
        { event: "play", from: "idle", resolve: canPlay, to: "done", turn: "increment" },
      ],
    }));

    expect(graph).toEqual({
      edges: [
        {
          event: "play",
          from: "idle",
          resolver: "resolver:canPlay",
          to: "done",
          turn: "increment",
        },
      ],
      initial: "idle",
      nodes: [
        { id: "done", kind: "leaf", parent: null, path: ["done"] },
        { id: "idle", kind: "leaf", parent: null, path: ["idle"] },
      ],
    });
  });

  test("matches unconditional transitions without a resolver", () => {
    const session = createLocalSession(defineGame({
      playerIDs: match.players,
      events: { accept: undefined },
      initial: "idle",
      setup: () => ({ accepted: false }),
      states: {
        done: { activePlayers: () => [] },
        idle: { activePlayers: ({ match: nextMatch }) => [nextMatch.players[0]] },
      },
      transitions: [
        { event: "accept", from: "idle", to: "done" },
      ],
    }), { match });

    const result = session.applyEvent("0", "accept", undefined);

    expect(result.ok).toBe(true);
    expect(session.getState().position.name).toBe("done");
    expect(result.ok && result.batch.steps[0]?.transition.resolver).toBe(null);
  });

  test("walks parent fallback transitions from leaf to root", () => {
    const session = createLocalSession(defineGame({
      playerIDs: match.players,
      events: { exit: undefined },
      initial: "choose",
      setup: () => ({ seen: [] as string[] }),
      states: {
        choose: { activePlayers: ({ match: nextMatch }) => [nextMatch.players[0]], parent: "turn" },
        done: { activePlayers: () => [] },
        turn: { parent: "root" },
        root: {},
      },
      transitions: [
        {
          event: "exit",
          from: "turn",
          resolve: ({ G }) => ({ G: { seen: [...G.seen, "turn"] } }),
          to: "done",
        },
      ],
    }), { match });

    expect(session.applyEvent("0", "exit", undefined).ok).toBe(true);
    expect(session.getState().G).toEqual({ seen: ["turn"] });
  });

  test("exposes typed dispatch helpers, replay data, and authored rejection details", () => {
    const session = createLocalSession(defineGame({
      playerIDs: match.players,
      events: {
        claim: {
          index: 0,
        },
      },
      initial: "play",
      setup: () => ({
        cells: [null, null] as Array<"A" | null>,
      }),
      states: {
        play: {
          activePlayers: ({ match: nextMatch, position }) => roundRobin.activePlayers(nextMatch.players, position.turn),
        },
      },
      transitions: [
        {
          event: "claim",
          from: "play",
          resolve: ({ G, event, playerID }) => {
            if (G.cells[event.payload.index] !== null) {
              return rejectTransition("occupied", {
                index: event.payload.index,
              });
            }

            return {
              G: {
                cells: G.cells.map((cell, index) => index === event.payload.index ? (playerID === "0" ? "A" : null) : cell),
              },
              turn: "increment",
            };
          },
          to: "play",
        },
      ],
    }), { match, now: 12, seed: "beta" });

    expect(session.dispatch.claim("0", { index: 0 }).ok).toBe(true);
    expect(session.dispatch.claim("1", { index: 0 })).toEqual({
      details: {
        index: 0,
      },
      error: "invalid_event",
      ok: false,
      reason: "occupied",
    });
    expect(session.getReplayData()).toEqual({
      actions: session.getState().meta.log,
      initialNow: 12,
      match,
      seed: "beta",
    });
    expect(resolveRoundRobinTurn(match.players, 2).currentPlayer).toBe("1");
  });

  test("builds canonical control summaries with pending target details", () => {
    const game = defineGame({
      playerIDs: match.players,
      events: { accept: undefined, review: undefined },
      initial: "choose",
      setup: () => ({ count: 0 }),
      states: {
        choose: {
          activePlayers: ({ match: nextMatch }) => [nextMatch.players[0]],
          parent: "turn",
        },
        review: {
          activePlayers: ({ match: nextMatch }) => [nextMatch.players[1]],
          parent: "turn",
        },
        done: { activePlayers: () => [] },
        turn: {
          deadline: 25,
          label: "Decision",
          metadata: [{ key: "kind", value: "turn" }],
          parent: "root",
        },
        root: {},
      },
      transitions: [
        { event: "accept", from: "turn", to: "done" },
        { event: "review", from: "turn", to: "review" },
      ],
    });
    const session = createLocalSession(game, { match });
    const summary = getGameControlSummary(game, session.getState());

    expect(summary.current.meta).toEqual({
      deadline: null,
      label: null,
      metadata: [],
      pendingTargets: ["done", "review"],
    });
    expect(summary.pendingTargetDetails).toEqual([
      {
        deadline: null,
        label: null,
        metadata: [],
        node: "done",
        path: ["done"],
      },
      {
        deadline: null,
        label: null,
        metadata: [],
        node: "review",
        path: ["root", "turn", "review"],
      },
    ]);
  });

  test("evaluates pending target metadata against each target node context", () => {
    const game = defineGame({
      playerIDs: match.players,
      events: { accept: undefined, review: undefined },
      initial: "choose",
      setup: () => ({ count: 0 }),
      states: {
        choose: {
          activePlayers: ({ match: nextMatch }) => [nextMatch.players[0]],
          parent: "turn",
        },
        review: {
          activePlayers: ({ match: nextMatch }) => [nextMatch.players[1]],
          label: ({ position }) => `Node ${position.name}`,
          metadata: ({ position }) => [{ key: "path", value: position.path.join(" > ") }],
          parent: "turn",
        },
        done: {
          activePlayers: () => [],
          label: ({ position }) => `Node ${position.name}`,
        },
        turn: {
          parent: "root",
        },
        root: {},
      },
      transitions: [
        { event: "accept", from: "turn", to: "done" },
        { event: "review", from: "turn", to: "review" },
      ],
    });
    const session = createLocalSession(game, { match });
    const summary = getGameControlSummary(game, session.getState());

    expect(summary.pendingTargetDetails).toEqual([
      {
        deadline: null,
        label: "Node done",
        metadata: [],
        node: "done",
        path: ["done"],
      },
      {
        deadline: null,
        label: "Node review",
        metadata: [{ key: "path", value: "root > turn > review" }],
        node: "review",
        path: ["root", "turn", "review"],
      },
    ]);
  });

  test("rejects non-replay-safe transition outputs instead of crashing", () => {
    const session = createLocalSession(defineGame({
      playerIDs: match.players,
      events: { break_it: undefined },
      initial: "idle",
      setup: () => ({ count: 0 }),
      states: {
        idle: {
          activePlayers: ({ match: nextMatch }) => [nextMatch.players[0]],
        },
      },
      transitions: [
        {
          event: "break_it",
          from: "idle",
          resolve: () => ({
            G: { count: 1, bad: () => "nope" } as unknown as { count: number },
          }),
          to: "idle",
        },
      ],
    }), { match });

    expect(session.applyEvent("0", "break_it", undefined)).toEqual({
      error: "invalid_transition_result",
      ok: false,
    });
    expect(session.getState().G).toEqual({ count: 0 });
  });

  test("returns structured validation reports without throwing", () => {
    const report = getGameValidationReport(defineGame({
      playerIDs: match.players,
      events: { play: undefined },
      initial: "idle",
      setup: () => ({ count: 0 }),
      states: {
        idle: {
          activePlayers: ({ match: nextMatch }) => [nextMatch.players[0], "missing"],
          label: () => 123 as unknown as string,
        },
      },
      transitions: [],
    }), { match });

    expect(report.ok).toBe(false);
    expect(report.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining(["active_players_unknown", "invalid_label"]),
    );
  });

  test("reports non-json player and public views during validation", () => {
    const report = getGameValidationReport(defineGame({
      playerIDs: match.players,
      events: { play: undefined },
      initial: "idle",
      setup: () => ({ count: 0 }),
      states: {
        idle: {
          activePlayers: ({ match: nextMatch }) => [nextMatch.players[0]],
        },
      },
      transitions: [],
      views: {
        player: () => ({ renderedAt: new Set() }) as unknown as { renderedAt: string },
        public: () => ({ renderedAt: new Set() }) as unknown as { renderedAt: string },
      },
    }), { match, now: 12, seed: "beta" });

    expect(report.ok).toBe(false);
    expect(report.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining(["invalid_player_view", "invalid_public_view"]),
    );
  });

  test("rejects non-json match data during session creation", () => {
    expect(() => createLocalSession(defineGame({
      playerIDs: match.players,
      events: { play: undefined },
      initial: "idle",
      setup: () => ({ count: 0 }),
      states: {
        idle: {
          activePlayers: ({ match: nextMatch }) => [nextMatch.players[0]],
        },
      },
      transitions: [],
    }), {
      match: {
        data: { startedAt: new Map() } as unknown as { startedAt: string },
        players: ["0", "1"],
      },
    })).toThrow();
  });

  test("rejects non-json setup state during session creation", () => {
    expect(() => createLocalSession(defineGame({
      playerIDs: match.players,
      events: { play: undefined },
      initial: "idle",
      setup: () => ({ startedAt: new Map() }) as unknown as { startedAt: string },
      states: {
        idle: {
          activePlayers: ({ match: nextMatch }) => [nextMatch.players[0]],
        },
      },
      transitions: [],
    }), { match })).toThrow();
  });

  test("rejects non-json public and player views during session creation", () => {
    expect(() => createLocalSession(defineGame({
      playerIDs: match.players,
      events: { play: undefined },
      initial: "idle",
      setup: () => ({ count: 0 }),
      states: {
        idle: {
          activePlayers: ({ match: nextMatch }) => [nextMatch.players[0]],
        },
      },
      transitions: [],
      views: {
        player: () => ({ renderedAt: new Set() }) as unknown as { renderedAt: string },
        public: () => ({ renderedAt: new Set() }) as unknown as { renderedAt: string },
      },
    }), { match })).toThrow();
  });
});

describe("DeterministicRng dice helpers", () => {
  const shorthand = [
    { sides: 4, name: "d4", call: (rng: ReturnType<typeof createRng>) => rng.d4() },
    { sides: 6, name: "d6", call: (rng: ReturnType<typeof createRng>) => rng.d6() },
    { sides: 8, name: "d8", call: (rng: ReturnType<typeof createRng>) => rng.d8() },
    { sides: 10, name: "d10", call: (rng: ReturnType<typeof createRng>) => rng.d10() },
    { sides: 12, name: "d12", call: (rng: ReturnType<typeof createRng>) => rng.d12() },
    { sides: 20, name: "d20", call: (rng: ReturnType<typeof createRng>) => rng.d20() },
    { sides: 100, name: "d100", call: (rng: ReturnType<typeof createRng>) => rng.d100() },
  ] as const;

  for (const { call, name, sides } of shorthand) {
    test(`${name} returns an integer in [1, ${sides}]`, () => {
      const rng = createRng(`shorthand-${name}`);
      for (let i = 0; i < 200; i += 1) {
        const value = call(rng);
        expect(Number.isInteger(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(1);
        expect(value).toBeLessThanOrEqual(sides);
      }
    });

    test(`${name} consumes one draw`, () => {
      const rng = createRng(`draws-${name}`);
      const before = rng.getSnapshot().draws;
      call(rng);
      expect(rng.getSnapshot().draws).toBe(before + 1);
    });
  }

  test("dice(count, sides) sums count rolls within bounds", () => {
    const rng = createRng("dice-sum");
    for (let i = 0; i < 100; i += 1) {
      const value = rng.dice(2, 6);
      expect(value).toBeGreaterThanOrEqual(2);
      expect(value).toBeLessThanOrEqual(12);
    }
    for (let i = 0; i < 100; i += 1) {
      const value = rng.dice(3, 6);
      expect(value).toBeGreaterThanOrEqual(3);
      expect(value).toBeLessThanOrEqual(18);
    }
  });

  test("dice consumes count draws", () => {
    const rng = createRng("dice-draws");
    const before = rng.getSnapshot().draws;
    rng.dice(5, 8);
    expect(rng.getSnapshot().draws).toBe(before + 5);
  });

  test("dice rejects non-positive count or sides", () => {
    const rng = createRng("dice-invalid");
    expect(() => rng.dice(0, 6)).toThrow();
    expect(() => rng.dice(-1, 6)).toThrow();
    expect(() => rng.dice(1.5, 6)).toThrow();
    expect(() => rng.dice(2, 0)).toThrow();
    expect(() => rng.dice(2, -3)).toThrow();
    expect(() => rng.dice(2, 6.5)).toThrow();
  });

  test("advantage returns the higher of two d20 rolls and consumes two draws", () => {
    const adv = createRng("adv-seed");
    const reference = createRng("adv-seed");
    const before = adv.getSnapshot().draws;
    const result = adv.advantage();
    const a = reference.d20();
    const b = reference.d20();
    expect(result).toBe(Math.max(a, b));
    expect(adv.getSnapshot().draws).toBe(before + 2);
  });

  test("disadvantage returns the lower of two d20 rolls and consumes two draws", () => {
    const dis = createRng("dis-seed");
    const reference = createRng("dis-seed");
    const before = dis.getSnapshot().draws;
    const result = dis.disadvantage();
    const a = reference.d20();
    const b = reference.d20();
    expect(result).toBe(Math.min(a, b));
    expect(dis.getSnapshot().draws).toBe(before + 2);
  });

  test("dice helpers are deterministic across fresh RNGs with the same seed", () => {
    const a = createRng("determinism");
    const b = createRng("determinism");
    expect(a.d20()).toBe(b.d20());
    expect(a.dice(3, 8)).toBe(b.dice(3, 8));
    expect(a.advantage()).toBe(b.advantage());
    expect(a.disadvantage()).toBe(b.disadvantage());
  });
});
