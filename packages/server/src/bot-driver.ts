import {
  enumerateLegalActions,
  forkRng,
  simulate,
  type Bot,
  type DecideContext,
} from "@openturn/bot";
import type {
  AnyGame,
  GamePlayerView,
  GamePlayers,
  GameSnapshotOf,
  LegalAction,
  LocalGameSession,
  MatchInput,
  PlayerID,
} from "@openturn/core";
import type { ProtocolClientMessage } from "@openturn/protocol";

/**
 * Looks up bot instances for the bot seats minted by `LobbyRuntime.start()`.
 * `findBot` would normally come from `@openturn/lobby/registry`, but
 * `@openturn/server` cannot depend on `@openturn/lobby` (lobby depends on
 * server). Instead we accept the structural shape — the registry-shape on
 * `game.bots` matches.
 */
export interface BotEntryShape<TGame extends AnyGame> {
  readonly botID: string;
  readonly bot: Bot<TGame>;
}

export interface BotRegistryShape<TGame extends AnyGame> {
  readonly entries: ReadonlyArray<BotEntryShape<TGame>>;
}

type ActionDelaySleeper = (ms: number, signal: AbortSignal) => Promise<void>;

export function resolveBotMap<TGame extends AnyGame>(
  registry: BotRegistryShape<TGame> | undefined,
  assignments: ReadonlyArray<{ kind: "human" | "bot"; playerID: string; botID: string | null }>,
): Map<string, Bot<TGame>> | null {
  if (registry === undefined) return null;
  const out = new Map<string, Bot<TGame>>();
  for (const assignment of assignments) {
    if (assignment.kind !== "bot" || assignment.botID === null) continue;
    const entry = registry.entries.find((e) => e.botID === assignment.botID);
    if (entry === undefined) continue;
    out.set(assignment.playerID, entry.bot);
  }
  return out.size > 0 ? out : null;
}

/**
 * In-DO bot driver. Polls the underlying session after every dispatch and
 * triggers `bot.decide(...)` when a bot's seat is active. The bot's chosen
 * action is dispatched back through `RoomRuntime.handleClientMessage` so
 * persistence + broadcast follow the same path as a human's move.
 *
 * Why a custom driver instead of `@openturn/bot`'s `attachLocalBots`:
 * `RoomRuntime` doesn't expose the local-session bus that
 * `attachLocalBots` listens on. Wiring that bus would couple the runtime
 * to the bot package and complicate persistence. The driver here is a
 * narrow subset of the same logic — same `bot.decide` interface, same
 * RNG forking, same legal-action resolution — without the bus.
 */
export class BotDriver<TGame extends AnyGame> {
  readonly #game: TGame;
  readonly #bots: ReadonlyMap<string, Bot<TGame>>;
  readonly #sleep: ActionDelaySleeper;
  readonly #inFlight = new Set<string>();
  readonly #aborts = new Map<string, AbortController>();

  constructor(input: { game: TGame; bots: ReadonlyMap<string, Bot<TGame>>; sleep?: ActionDelaySleeper }) {
    this.#game = input.game;
    this.#bots = input.bots;
    this.#sleep = input.sleep ?? waitForActionDelay;
  }

  /** True if the given seat is bot-controlled. */
  isBot(playerID: string): boolean {
    return this.#bots.has(playerID);
  }

  /**
   * Triggers any bot whose seat is currently active. Awaits all triggered
   * decisions in parallel and dispatches their actions through `dispatch`,
   * which is typically `runtime.handleClientMessage` from the DO.
   *
   * The driver re-evaluates after each dispatch (a chain of bot moves like
   * bot-vs-bot plays in one call), bounded by `maxChainDepth` to avoid
   * runaway loops if a bot returns invalid actions repeatedly.
   */
  async tick(input: {
    session: LocalGameSession<TGame, MatchInput<GamePlayers<TGame>>>;
    matchID: string;
    dispatch: (message: ProtocolClientMessage) => Promise<unknown>;
    maxChainDepth?: number;
  }): Promise<void> {
    const maxChain = input.maxChainDepth ?? 64;
    let depth = 0;
    while (depth < maxChain) {
      const snapshot = input.session.getState() as GameSnapshotOf<TGame>;
      const result = snapshot.meta.result;
      if (result !== null && result !== undefined) return;

      const active = snapshot.derived.activePlayers;
      const triggered: Promise<void>[] = [];
      for (const playerID of active) {
        if (!this.#bots.has(playerID)) continue;
        if (this.#inFlight.has(playerID)) continue;
        triggered.push(this.#runOne({ ...input, playerID, snapshot }));
      }
      if (triggered.length === 0) return;
      await Promise.all(triggered);
      depth += 1;
    }
  }

  /** Aborts any in-flight bot decisions and clears state. */
  stop(): void {
    for (const ac of this.#aborts.values()) ac.abort();
    this.#aborts.clear();
    this.#inFlight.clear();
  }

  async #runOne(input: {
    session: LocalGameSession<TGame, MatchInput<GamePlayers<TGame>>>;
    matchID: string;
    dispatch: (message: ProtocolClientMessage) => Promise<unknown>;
    playerID: string;
    snapshot: GameSnapshotOf<TGame>;
  }): Promise<void> {
    const { session, matchID, dispatch, playerID, snapshot } = input;
    const bot = this.#bots.get(playerID)!;
    this.#inFlight.add(playerID);
    const abort = new AbortController();
    this.#aborts.set(playerID, abort);

    try {
      const view = session.getPlayerView(playerID as never) as GamePlayerView<TGame>;
      const legalActions: ReadonlyArray<LegalAction> = enumerateLegalActions(
        this.#game,
        snapshot,
        view,
        playerID as never,
        bot,
      );
      const rng = forkRng(snapshot.meta.rng, bot.name, playerID, snapshot.position.turn);
      const deadline = {
        remainingMs: () => bot.thinkingBudgetMs ?? 5_000,
        expired: () => false,
      };
      const context: DecideContext<TGame> = {
        playerID: playerID as never,
        view,
        snapshot,
        legalActions,
        rng,
        deadline,
        signal: abort.signal,
        simulate: (action) => simulate(this.#game, snapshot, playerID as never, action),
      };

      const decision = await bot.decide(context);
      if (abort.signal.aborted) return;

      await this.#sleep(normalizeActionDelayMs(bot.actionDelayMs ?? 0), abort.signal);
      if (abort.signal.aborted) return;

      // Re-check turn — if the snapshot moved on (e.g. another bot raced
      // ahead), drop this stale decision.
      const current = session.getState() as GameSnapshotOf<TGame>;
      if (current.position.turn !== snapshot.position.turn) return;

      await dispatch({
        type: "action",
        matchID,
        clientActionID: `bot:${playerID}:${snapshot.position.turn}:${Math.floor(Math.random() * 1_000_000)}`,
        playerID,
        event: decision.event,
        payload: decision.payload as never,
      } as ProtocolClientMessage);
    } catch {
      // Bot threw or simulate failed — surface as a no-op; the next tick
      // will retry on the next snapshot change.
    } finally {
      this.#inFlight.delete(playerID);
      this.#aborts.delete(playerID);
    }
  }
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
