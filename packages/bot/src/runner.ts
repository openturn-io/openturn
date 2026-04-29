import type {
  AnyGame,
  GamePlayers,
  GameSnapshotOf,
  LegalAction,
  LocalGameSession,
  MatchInput,
} from "@openturn/core";
import type { HostedClient } from "@openturn/client";

import { createDeadline, realClock, type DeadlineClock } from "./budget";
import type { Bot, DecideContext, SimulateResult } from "./define";
import type { BotHost } from "./host";
import { createHostedClientHost } from "./hosts/hosted";
import {
  createLocalSessionBus,
  createLocalSessionHost,
  type LocalSessionBus,
  type LocalSessionHostHandle,
} from "./hosts/local";
import { enumerateLegalActions } from "./legal";
import { forkRng } from "./rng";
import { simulate } from "./simulate";

const DEFAULT_THINKING_BUDGET_MS = 5_000;

export interface BotRunner {
  /** True between deciding and dispatching for the latest snapshot. */
  isThinking(): boolean;
  /**
   * Resolves once the runner is currently idle (no in-flight `decide`).
   * Useful in pull-based loops (CLI) to wait for the bot's move.
   */
  whenIdle(): Promise<void>;
  /** Stop reacting to snapshot changes and free listeners. */
  detach(): void;
}

export interface AttachOptions {
  /** Override the per-decision budget. Defaults to `bot.thinkingBudgetMs ?? 5000`. */
  thinkingBudgetMs?: number;
  /** Override bot presentation pacing. Defaults to `bot.actionDelayMs ?? 0`. */
  actionDelayMs?: number;
  /** Custom clock — primarily for tests. */
  clock?: DeadlineClock;
  /** Called when a dispatch fails (engine returned `ok: false`). */
  onError?: (error: { error: string; reason?: string; action: LegalAction }) => void;
}

interface AttachInternalOptions<TGame extends AnyGame> extends AttachOptions {
  host: BotHost<TGame>;
  game: TGame;
  bot: Bot<TGame>;
  /**
   * Whether `simulate` is available on this host. Local hosts: yes. Hosted
   * (network) hosts: no — we don't have the full snapshot or game on the
   * client side.
   */
  simulateAvailable: boolean;
}

function attach<TGame extends AnyGame>(options: AttachInternalOptions<TGame>): BotRunner {
  const { host, game, bot, simulateAvailable } = options;
  const clock = options.clock ?? realClock;
  const budgetMs = options.thinkingBudgetMs ?? bot.thinkingBudgetMs ?? DEFAULT_THINKING_BUDGET_MS;
  const actionDelayMs = normalizeActionDelayMs(options.actionDelayMs ?? bot.actionDelayMs ?? 0);

  let activeAbort: AbortController | null = null;
  let activePromise: Promise<void> | null = null;
  let detached = false;
  let pending = false;
  const idleListeners = new Set<() => void>();

  const settleIdle = () => {
    activePromise = null;
    activeAbort = null;
    for (const listener of idleListeners) listener();
    idleListeners.clear();
    if (pending) {
      pending = false;
      schedule();
    }
  };

  const schedule = () => {
    if (detached) return;
    if (activePromise !== null) {
      pending = true;
      return;
    }
    if (!host.isMyTurn()) return;
    const snapshot = host.getSnapshot();
    const view = host.getView();
    if (view === null) return;

    const abort = new AbortController();
    activeAbort = abort;

    const decide = async () => {
      try {
        if (snapshot === null && !simulateAvailable) {
          // Hosted (no snapshot): use view-only legal action enumeration.
        }
        const legalActions = snapshot === null
          ? (bot.enumerate?.({ view, snapshot: null, playerID: host.playerID }) ?? [])
          : enumerateLegalActions(game, snapshot, view, host.playerID, bot);

        const turnNumber = snapshot?.position.turn ?? 0;
        const rngSnapshot = snapshot?.meta.rng ?? { draws: 0, seed: "hosted", state: 0 };
        const rng = forkRng(rngSnapshot, bot.name, host.playerID, turnNumber);
        const deadline = createDeadline(budgetMs, clock);
        const simulateFn = (action: LegalAction): SimulateResult<TGame> => {
          if (!simulateAvailable || snapshot === null) {
            return { ok: false, reason: "simulate_unavailable_for_host" };
          }
          return simulate(game, snapshot, host.playerID, action);
        };

        const context: DecideContext<TGame> = {
          playerID: host.playerID,
          view,
          snapshot,
          legalActions,
          rng,
          deadline,
          signal: abort.signal,
          simulate: simulateFn,
        };

        const action = await bot.decide(context);

        if (abort.signal.aborted) return;
        await waitForActionDelay(actionDelayMs, abort.signal);
        if (abort.signal.aborted) return;
        if (snapshot !== null) {
          const current = host.getSnapshot();
          if (current !== null && current.position.turn !== snapshot.position.turn) {
            // Turn moved on while we were thinking — drop this stale decision.
            return;
          }
        }
        if (!host.isMyTurn()) return;

        const dispatchResult = await host.dispatch(action);
        if (!dispatchResult.ok && options.onError !== undefined) {
          options.onError({
            error: dispatchResult.error,
            ...(dispatchResult.reason === undefined ? {} : { reason: dispatchResult.reason }),
            action,
          });
        }
      } catch (error) {
        if (options.onError !== undefined) {
          const message = error instanceof Error ? error.message : String(error);
          options.onError({ error: "decide_threw", reason: message, action: { event: "<unknown>", payload: null } });
        }
      } finally {
        settleIdle();
      }
    };

    activePromise = decide();
  };

  const unsubscribe = host.onChange(() => {
    if (activePromise !== null) {
      // A new snapshot arrived while we were thinking. Cancel the in-flight
      // decision (the `signal` lets LLM/MCTS bots exit early) and schedule a
      // fresh decide once the current one settles.
      activeAbort?.abort();
      pending = true;
      return;
    }
    schedule();
  });

  // Kick once immediately in case it's already our turn.
  schedule();

  return {
    isThinking: () => activePromise !== null,
    whenIdle: () =>
      new Promise<void>((resolve) => {
        if (activePromise === null) {
          resolve();
          return;
        }
        idleListeners.add(resolve);
      }),
    detach() {
      detached = true;
      activeAbort?.abort();
      unsubscribe();
      host.close();
    },
  };
}

export interface AttachLocalBotOptions<TGame extends AnyGame> extends AttachOptions {
  /** Either a raw session (a fresh bus is created) or a shared bus from a prior attach. */
  session: LocalGameSession<TGame, MatchInput<GamePlayers<TGame>>> | LocalSessionBus<TGame>;
  game: TGame;
  playerID: GamePlayers<TGame>[number];
  bot: Bot<TGame>;
}

export interface AttachLocalBotResult<TGame extends AnyGame> {
  runner: BotRunner;
  /**
   * A session-shaped facade whose `applyEvent` notifies the runner. Use this
   * in your game loop instead of the raw session, so human-driven moves
   * trigger the bot.
   */
  session: LocalGameSession<TGame, MatchInput<GamePlayers<TGame>>>;
  /** The shared bus — pass it to subsequent `attachLocalBot` calls when binding multiple bots. */
  bus: LocalSessionBus<TGame>;
}

/**
 * Bind a bot to a single seat of a local session. To bind multiple
 * bots, prefer `attachLocalBots`; otherwise pass the returned `bus`
 * to subsequent `attachLocalBot` calls so every host hears every dispatch.
 */
export function attachLocalBot<TGame extends AnyGame>(
  options: AttachLocalBotOptions<TGame>,
): AttachLocalBotResult<TGame> {
  const handle: LocalSessionHostHandle<TGame> = createLocalSessionHost(options.session, options.playerID);
  const runner = attach<TGame>({
    host: handle.host,
    game: options.game,
    bot: options.bot,
    simulateAvailable: true,
    ...(options.thinkingBudgetMs === undefined ? {} : { thinkingBudgetMs: options.thinkingBudgetMs }),
    ...(options.actionDelayMs === undefined ? {} : { actionDelayMs: options.actionDelayMs }),
    ...(options.clock === undefined ? {} : { clock: options.clock }),
    ...(options.onError === undefined ? {} : { onError: options.onError }),
  });
  return { runner, session: handle.session, bus: handle.bus };
}

export interface AttachLocalBotsOptions<TGame extends AnyGame> extends AttachOptions {
  session: LocalGameSession<TGame, MatchInput<GamePlayers<TGame>>>;
  game: TGame;
  bots: Partial<Record<GamePlayers<TGame>[number], Bot<TGame>>>;
}

export interface AttachLocalBotsResult<TGame extends AnyGame> {
  runners: ReadonlyMap<string, BotRunner>;
  session: LocalGameSession<TGame, MatchInput<GamePlayers<TGame>>>;
  /**
   * Detach all runners. Convenience wrapper around `runner.detach()` for
   * each seat.
   */
  detachAll(): void;
  /** Returns true if the given seat is bot-controlled. */
  isBot(playerID: string): boolean;
  /** Wait for the bot at `playerID` to finish thinking, if any. */
  whenIdle(playerID: string): Promise<void>;
}

/**
 * Convenience: attach multiple bots to one session via a single shared
 * bus. The returned `session` is a facade — every dispatch through it
 * (whether by a bot or a human) notifies all attached runners.
 */
export function attachLocalBots<TGame extends AnyGame>(
  options: AttachLocalBotsOptions<TGame>,
): AttachLocalBotsResult<TGame> {
  const bus = createLocalSessionBus<TGame>(options.session);
  const runners = new Map<string, BotRunner>();
  const seats = Object.entries(options.bots) as Array<[string, Bot<TGame> | undefined]>;
  for (const [seat, bot] of seats) {
    if (bot === undefined) continue;
    const result = attachLocalBot<TGame>({
      session: bus,
      game: options.game,
      playerID: seat as GamePlayers<TGame>[number],
      bot,
      ...(options.thinkingBudgetMs === undefined ? {} : { thinkingBudgetMs: options.thinkingBudgetMs }),
      ...(options.actionDelayMs === undefined ? {} : { actionDelayMs: options.actionDelayMs }),
      ...(options.clock === undefined ? {} : { clock: options.clock }),
      ...(options.onError === undefined ? {} : { onError: options.onError }),
    });
    runners.set(seat, result.runner);
  }
  return {
    runners,
    session: bus.facade,
    detachAll() {
      for (const runner of runners.values()) runner.detach();
    },
    isBot(playerID) {
      return runners.has(playerID);
    },
    async whenIdle(playerID) {
      const runner = runners.get(playerID);
      if (runner === undefined) return;
      await runner.whenIdle();
    },
  };
}

export interface AttachHostedBotOptions<TGame extends AnyGame> extends AttachOptions {
  client: HostedClient;
  playerID: GamePlayers<TGame>[number];
  bot: Bot<TGame>;
  /**
   * Game definition. Optional for hosted clients (since `simulate` is
   * unavailable anyway). When omitted, `game.legalActions` cannot be used —
   * the bot must supply `enumerate`.
   */
  game?: TGame;
}

export function attachHostedBot<TGame extends AnyGame>(
  options: AttachHostedBotOptions<TGame>,
): BotRunner {
  const host = createHostedClientHost<TGame>(options.client, options.playerID);
  return attach<TGame>({
    host,
    game: (options.game ?? ({} as TGame)),
    bot: options.bot,
    simulateAvailable: false,
    ...(options.thinkingBudgetMs === undefined ? {} : { thinkingBudgetMs: options.thinkingBudgetMs }),
    ...(options.actionDelayMs === undefined ? {} : { actionDelayMs: options.actionDelayMs }),
    ...(options.clock === undefined ? {} : { clock: options.clock }),
    ...(options.onError === undefined ? {} : { onError: options.onError }),
  });
}

function normalizeActionDelayMs(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value);
}

function waitForActionDelay(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0 || signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}
