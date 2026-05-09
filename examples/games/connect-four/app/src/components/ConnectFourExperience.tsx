import { useState, type ReactNode } from "react";
import {
  LobbyWithBots,
  buildLobbyView,
  useBotAttachOnTransition,
  useLocalLobbyChannel,
} from "@openturn/lobby/react";
import { createLocalSession } from "@openturn/core";
import {
  connectFour,
  type Mark,
} from "@openturn/example-connect-four-game";
import {
  connectFourBotRegistry,
  connectFourWithBots,
} from "@openturn/example-connect-four-bots";

import { Match } from "./Match";

const HOST_USER_ID = "local-host";

interface ResultLike { winner?: string; draw?: boolean }

export function ConnectFourExperience(): React.ReactElement {
  const [phase, setPhase] = useState<"lobby" | "game">("lobby");
  const [botMap, setBotMap] = useState<Record<string, string>>({});

  const channel = useLocalLobbyChannel({
    game: connectFourWithBots,
    match: { players: connectFour.playerIDs },
    hostUserID: HOST_USER_ID,
    hostUserName: "You",
    registry: connectFourBotRegistry,
    onTransitionToGame: ({ assignments }) => {
      const next: Record<string, string> = {};
      for (const a of assignments) {
        if (a.kind === "bot" && a.botID !== null) next[a.playerID] = a.botID;
      }
      setBotMap(next);
      setPhase("game");
    },
  });

  if (phase === "lobby") {
    const view = buildLobbyView({
      channel,
      userID: HOST_USER_ID,
      capacityFallback: connectFourWithBots.playerIDs.length,
      minPlayersFallback: connectFourWithBots.minPlayers,
      hostUserIDFallback: HOST_USER_ID,
    });
    return (
      <main className="min-h-screen bg-slate-50 text-slate-950">
        <div className="mx-auto max-w-5xl px-6 py-8">
          <LobbyWithBots lobby={view} title="Connect Four" />
        </div>
      </main>
    );
  }

  return <GameRunner channel={channel} botMap={botMap} onLeave={() => setPhase("lobby")} />;
}

function GameRunner({
  channel,
  botMap,
  onLeave,
}: {
  channel: ReturnType<typeof useLocalLobbyChannel>;
  botMap: Record<string, string>;
  onLeave: () => void;
}): ReactNode {
  const [rawSession] = useState(() =>
    createLocalSession(connectFour, { match: { players: connectFour.playerIDs } }),
  );
  const facade = useBotAttachOnTransition({
    channel,
    game: connectFour,
    registry: connectFourBotRegistry,
    session: rawSession,
  });
  const session = facade ?? rawSession;
  const snapshot = session.getState();

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
        onDrop={(col) => session.applyEvent(active, "dropDisc", { col })}
        status={status}
        seats={seats}
        turn={turn}
        moves={moves}
        isOver={isOver}
        onNewMatch={onLeave}
      />
    </main>
  );
}
