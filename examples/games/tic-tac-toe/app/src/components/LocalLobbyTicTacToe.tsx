import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import {
  enumerateLegalActions,
  forkRng,
  simulate,
  type Bot,
  type LegalAction,
} from "@openturn/bot";
import {
  LobbyWithBots,
  buildLobbyView,
  useLocalLobbyChannel,
} from "@openturn/lobby/react";
import { findBot } from "@openturn/lobby/registry";
import { ticTacToeBotRegistry } from "@openturn/example-tic-tac-toe-bots";
import { createOpenturnBindings } from "@openturn/react";
import {
  ticTacToe,
} from "@openturn/example-tic-tac-toe-game";

const ticTacToeMatch = { players: ticTacToe.playerIDs };
import {
  BoardGrid,
  CardShell,
  PLAYER_LABEL,
  PLAYER_MARK,
  type TicTacToeBoard,
} from "@openturn/example-tic-tac-toe-ui";

const HOST_USER_ID = "local-host";

// Bindings are cached per game definition, so this returns the same instance
// the dev shell created in entry.tsx — i.e. the matchStore the inspector
// already tracks. Routing every dispatch (human + bot) through `useMatch()`
// is what keeps the inspector timeline in sync.
const ticTacToeBindings = createOpenturnBindings(ticTacToe, {
  runtime: "local",
  match: ticTacToeMatch,
});
const { useMatch } = ticTacToeBindings;

type Phase = "lobby" | "game";

interface BotMap {
  [playerID: string]: string | undefined;
}

export function LocalLobbyTicTacToe(): ReactNode {
  const [matchKey, setMatchKey] = useState(0);
  return (
    <LocalLobbyMatch
      key={matchKey}
      onRestart={() => setMatchKey((current) => current + 1)}
    />
  );
}

function LocalLobbyMatch({ onRestart }: { onRestart: () => void }): ReactNode {
  const [phase, setPhase] = useState<Phase>("lobby");
  const [botMap, setBotMap] = useState<BotMap>({});
  const match = useMatch();
  if (match.mode !== "local") {
    throw new Error("LocalLobbyTicTacToe requires a local match (use the dev shell or wrap in OpenturnProvider).");
  }
  const matchState = match.state;

  const channel = useLocalLobbyChannel({
    game: ticTacToe,
    match: ticTacToeMatch,
    hostUserID: HOST_USER_ID,
    hostUserName: "You",
    registry: ticTacToeBotRegistry,
    onTransitionToGame: ({ assignments }) => {
      const nextBotMap: BotMap = {};
      for (const a of assignments) {
        if (a.kind === "bot" && a.botID !== null) nextBotMap[a.playerID] = a.botID;
      }
      // Reset the matchStore so the new game starts from a clean log; this
      // also clears any previous frames from the inspector timeline.
      matchState.reset();
      setBotMap(nextBotMap);
      setPhase("game");
    },
  });

  const view = useMemo(
    () =>
      buildLobbyView({
        channel,
        userID: HOST_USER_ID,
        capacityFallback: ticTacToeMatch.players.length,
        minPlayersFallback: ticTacToeMatch.players.length,
        hostUserIDFallback: HOST_USER_ID,
      }),
    [channel],
  );

  return (
    <main className="h-full min-h-0 w-full overflow-hidden">
      <section className="h-full min-h-0 w-full flex items-center justify-center p-6">
        {phase === "lobby" ? (
          <LobbyWithBots lobby={view} title="Tic-tac-toe · pick your seats" />
        ) : (
          <TicTacToeBoard botMap={botMap} onRestart={onRestart} />
        )}
      </section>
    </main>
  );
}

function TicTacToeBoard({ botMap, onRestart }: { botMap: BotMap; onRestart: () => void }): ReactNode {
  const match = useMatch();
  if (match.mode !== "local") {
    throw new Error("TicTacToeBoard requires a local match.");
  }
  const { dispatch, snapshot, getPlayerView } = match.state;

  useBotDriver({
    botMap,
    snapshot: snapshot as never,
    dispatch: dispatch as never,
    getPlayerView: getPlayerView as never,
  });

  const result = snapshot.meta.result;
  const activePlayer = (snapshot.derived.activePlayers[0] ?? "0") as "0" | "1";
  const activeIsBot = botMap[activePlayer] !== undefined;
  const message = describeBoardMessage(result, activePlayer, activeIsBot, botMap);

  const onCellClick = (row: number, col: number) => {
    if (result !== null) return;
    if (activeIsBot) return;
    dispatch.placeMark(activePlayer, { row, col });
  };

  return (
    <CardShell
      eyebrow="Tic-tac-toe"
      title={result === null ? PLAYER_LABEL[activePlayer] : "Match sealed"}
      message={message}
      footer={
        <button
          type="button"
          onClick={onRestart}
          className="rounded-full border border-slate-300 bg-slate-950 px-5 py-2 text-sm font-medium text-white transition hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
        >
          Back to lobby
        </button>
      }
    >
      <BoardGrid
        board={snapshot.G.board as TicTacToeBoard}
        disabled={result !== null || activeIsBot}
        onCellPress={onCellClick}
      />
    </CardShell>
  );
}

// Bot-driver internals work with whatever the matchStore exposes; the
// public types from `@openturn/react` are tightly bound to the game generic
// and don't simplify the call-site. Use a permissive shape here and cast at
// the call site — the matchStore-bound dispatch is the one source of truth.
interface BotDriverSnapshot {
  meta: { result: { winner?: string; draw?: boolean } | null; rng: { draws: number; seed: string; state: number } };
  derived: { activePlayers: readonly string[] };
  position: { turn: number };
}
interface BotDriverOptions {
  botMap: BotMap;
  snapshot: BotDriverSnapshot;
  dispatch: Record<string, (playerID: string, payload: unknown) => unknown>;
  getPlayerView: (playerID: string) => unknown;
}

/**
 * Drives bot seats by re-running on every snapshot change: when the active
 * seat is bot-controlled, run `bot.decide(...)` and dispatch the chosen
 * action through the matchStore. Re-entering after every dispatch covers
 * bot-vs-bot chains as well as bot-then-human handoffs.
 */
function useBotDriver({ botMap, snapshot, dispatch, getPlayerView }: BotDriverOptions): void {
  const inflightTurnRef = useRef<number | null>(null);

  useEffect(() => {
    if (snapshot.meta.result !== null) {
      inflightTurnRef.current = null;
      return;
    }
    const active = snapshot.derived.activePlayers as readonly string[];
    const botSeat = active.find((p) => botMap[p] !== undefined);
    if (botSeat === undefined) {
      inflightTurnRef.current = null;
      return;
    }
    const botID = botMap[botSeat]!;
    const descriptor = findBot(ticTacToeBotRegistry, botID);
    if (descriptor === null) return;

    const turn = snapshot.position.turn;
    if (inflightTurnRef.current === turn) return;
    inflightTurnRef.current = turn;

    const abort = new AbortController();
    let cancelled = false;

    void (async () => {
      try {
        const action = await runBotDecision({
          bot: descriptor.bot,
          playerID: botSeat,
          snapshot,
          view: getPlayerView(botSeat),
          signal: abort.signal,
        });
        if (cancelled) return;
        const handler = dispatch[action.event];
        if (typeof handler === "function") {
          handler(botSeat, action.payload);
        }
      } catch {
        // Bot threw; the next snapshot change will retry.
      }
    })();

    return () => {
      cancelled = true;
      abort.abort();
    };
  }, [botMap, snapshot, dispatch, getPlayerView]);
}

async function runBotDecision({
  bot,
  playerID,
  snapshot,
  view,
  signal,
}: {
  bot: Bot<typeof ticTacToe>;
  playerID: string;
  snapshot: BotDriverSnapshot;
  view: unknown;
  signal: AbortSignal;
}): Promise<LegalAction> {
  const legalActions = enumerateLegalActions(
    ticTacToe,
    snapshot as never,
    view as never,
    playerID as never,
    bot,
  );
  const rng = forkRng(snapshot.meta.rng, bot.name, playerID, snapshot.position.turn);
  const deadline = {
    remainingMs: () => bot.thinkingBudgetMs ?? 5_000,
    expired: () => false,
  };
  return bot.decide({
    playerID: playerID as never,
    view: view as never,
    snapshot: snapshot as never,
    legalActions,
    rng,
    deadline,
    signal,
    simulate: (action) => simulate(ticTacToe, snapshot as never, playerID as never, action),
  });
}

function describeBoardMessage(
  result: { winner?: string; draw?: boolean } | null,
  activePlayer: "0" | "1",
  activeIsBot: boolean,
  botMap: BotMap,
): string {
  if (typeof result?.winner === "string") {
    const winner = result.winner as "0" | "1";
    const winnerLabel = botMap[winner] !== undefined
      ? `Bot · ${botMap[winner]}`
      : PLAYER_LABEL[winner];
    return `${winnerLabel} (${PLAYER_MARK[winner]}) wins.`;
  }
  if (result?.draw) return "Match drawn.";
  if (activeIsBot) return `🤖 ${botMap[activePlayer]} is thinking…`;
  return `Your move (${PLAYER_MARK[activePlayer]}).`;
}
