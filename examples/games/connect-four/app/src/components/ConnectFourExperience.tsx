import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import {
  enumerateLegalActions,
  forkRng,
  simulate,
  type Bot,
  type LegalAction,
} from "@openturn/bot";
import {
  connectFourBotRegistry,
  connectFourWithBots,
} from "@openturn/example-connect-four-bots";
import {
  connectFour,
  type Mark,
} from "@openturn/example-connect-four-game";
import {
  LobbyWithBots,
  buildLobbyView,
  useLocalLobbyChannel,
} from "@openturn/lobby/react";
import { findBot } from "@openturn/lobby/registry";

import { OpenturnProvider, connectFourMatch, useMatch } from "../lib/bindings";
import { Match } from "./Match";

const HOST_USER_ID = "local-host";

interface ResultLike { winner?: string; draw?: boolean }

type Phase = "lobby" | "game";

interface BotMap {
  [playerID: string]: string | undefined;
}

export function ConnectFourExperience(): React.ReactElement {
  const [matchKey, setMatchKey] = useState(0);
  return (
    <OpenturnProvider>
      <LocalLobbyMatch
        key={matchKey}
        onRestart={() => setMatchKey((current) => current + 1)}
      />
    </OpenturnProvider>
  );
}

function LocalLobbyMatch({ onRestart }: { onRestart: () => void }): ReactNode {
  const [phase, setPhase] = useState<Phase>("lobby");
  const [botMap, setBotMap] = useState<BotMap>({});
  const match = useMatch();
  if (match.mode !== "local") {
    throw new Error("ConnectFourExperience requires a local match.");
  }
  const matchState = match.state;

  const channel = useLocalLobbyChannel({
    game: connectFourWithBots,
    match: connectFourMatch,
    hostUserID: HOST_USER_ID,
    hostUserName: "You",
    registry: connectFourBotRegistry,
    onTransitionToGame: ({ assignments }) => {
      const nextBotMap: BotMap = {};
      for (const a of assignments) {
        if (a.kind === "bot" && a.botID !== null) nextBotMap[a.playerID] = a.botID;
      }
      // Reset the matchStore so the new game starts from a clean log.
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
        capacityFallback: connectFourWithBots.playerIDs.length,
        minPlayersFallback: connectFourWithBots.minPlayers,
        hostUserIDFallback: HOST_USER_ID,
      }),
    [channel],
  );

  if (phase === "lobby") {
    return (
      <main className="min-h-screen bg-slate-50 text-slate-950">
        <div className="mx-auto max-w-5xl px-6 py-8">
          <LobbyWithBots lobby={view} title="Connect Four" />
        </div>
      </main>
    );
  }

  return <GameRunner botMap={botMap} onRestart={onRestart} />;
}

function GameRunner({
  botMap,
  onRestart,
}: {
  botMap: BotMap;
  onRestart: () => void;
}): ReactNode {
  const match = useMatch();
  if (match.mode !== "local") {
    throw new Error("GameRunner requires a local match.");
  }
  const { dispatch, snapshot, getPlayerView } = match.state;

  useBotDriver({
    botMap,
    snapshot: snapshot as never,
    dispatch: dispatch as never,
    getPlayerView: getPlayerView as never,
  });

  const board = snapshot.G.board;
  const lastMove = snapshot.G.lastMove;
  const result = snapshot.meta.result as ResultLike | null;
  const isOver = result !== null;
  const active = (snapshot.derived.activePlayers[0] ?? "0") as Mark;
  const moves = snapshot.position.turn ?? 0;
  const turn = Math.floor(moves / 2) + 1;

  const localActive = active in botMap ? null : active;
  const seats: readonly [
    { mark: Mark; name: string; role: string; active: boolean },
    { mark: Mark; name: string; role: string; active: boolean },
  ] = [
    {
      mark: "0",
      name: botMap["0"] ? `Bot · ${botMap["0"]}` : "You",
      role: isOver
        ? result!.winner === "0"
          ? "Won"
          : result!.draw
            ? "Draw"
            : "Lost"
        : active === "0"
          ? botMap["0"]
            ? "Thinking…"
            : "Your turn"
          : "Waiting",
      active: !isOver && active === "0",
    },
    {
      mark: "1",
      name: botMap["1"] ? `Bot · ${botMap["1"]}` : "You",
      role: isOver
        ? result!.winner === "1"
          ? "Won"
          : result!.draw
            ? "Draw"
            : "Lost"
        : active === "1"
          ? botMap["1"]
            ? "Thinking…"
            : "Your turn"
          : "Waiting",
      active: !isOver && active === "1",
    },
  ];

  const status = isOver
    ? result!.draw
      ? "Draw"
      : result!.winner === "0"
        ? "Red wins"
        : "Yellow wins"
    : active in botMap
      ? `${active === "0" ? "Red" : "Yellow"} is thinking…`
      : "Your turn — drop into a column";

  return (
    <main className="min-h-screen bg-slate-50 text-slate-950">
      <Match
        board={board}
        lastMove={lastMove}
        activeMark={localActive}
        canPlay={!isOver && localActive !== null}
        onDrop={(col) => dispatch.dropDisc(active, { col })}
        status={status}
        seats={seats}
        turn={turn}
        moves={moves}
        isOver={isOver}
        onNewMatch={onRestart}
      />
    </main>
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
    const descriptor = findBot(connectFourBotRegistry, botID);
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
  bot: Bot<typeof connectFour>;
  playerID: string;
  snapshot: BotDriverSnapshot;
  view: unknown;
  signal: AbortSignal;
}): Promise<LegalAction> {
  const legalActions = enumerateLegalActions(
    connectFour,
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
    simulate: (action) => simulate(connectFour, snapshot as never, playerID as never, action),
  });
}
