import type { ReactNode } from "react";

import {
  connectFour,
  type Board,
  type Mark,
} from "@openturn/example-connect-four-game";
import type { HostedRoomState } from "@openturn/react";
import { LobbyWithBots } from "@openturn/lobby/react";

import { OpenturnProvider, useRoom } from "../lib/bindings";
import { Match } from "./Match";

interface ResultLike { winner?: string; draw?: boolean }

type HostedMatch = NonNullable<HostedRoomState<typeof connectFour>["game"]>;

export function ConnectFourExperience(): React.ReactElement {
  return (
    <OpenturnProvider>
      <ConnectFourRoom />
    </OpenturnProvider>
  );
}

function ConnectFourRoom(): ReactNode {
  const room = useRoom();

  if (room.phase === "missing_backend") {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-50 px-6 text-slate-950">
        <p className="max-w-prose rounded-2xl border border-slate-200 bg-white p-6 text-sm">
          Hosted backend config is missing. Open this deployment through the play
          shell at <code className="rounded bg-slate-100 px-1">/play/&lt;deployment&gt;</code>.
        </p>
      </main>
    );
  }

  if (room.lobby !== null) {
    return (
      <main className="min-h-screen bg-slate-50 text-slate-950">
        <div className="mx-auto max-w-5xl px-6 py-8">
          <LobbyWithBots lobby={room.lobby} title="Connect Four" />
        </div>
      </main>
    );
  }

  if (room.game !== null) {
    return <ConnectFourHostedGame match={room.game} />;
  }

  return (
    <main className="grid min-h-screen place-items-center bg-slate-50 text-slate-950">
      <p className="text-sm text-slate-500">
        {room.phase === "connecting" ? "Connecting to the room…" : "Loading…"}
      </p>
    </main>
  );
}

function ConnectFourHostedGame({ match }: { match: HostedMatch }): ReactNode {
  const snapshot = match.snapshot;
  if (snapshot === null) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-50 text-slate-950">
        <p className="text-sm text-slate-500">Syncing match…</p>
      </main>
    );
  }

  const view = snapshot.G as unknown as
    | { board: Board; lastMove: { col: number; row: number; player: Mark } | null }
    | null;
  if (view === null) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-50 text-slate-950">
        <p className="text-sm text-slate-500">Syncing match…</p>
      </main>
    );
  }

  const board = view.board;
  const lastMove = view.lastMove;
  const result = match.result as ResultLike | null;
  const isOver = match.isFinished;
  const active = (snapshot.derived.activePlayers[0] ?? "0") as Mark;
  const moves = snapshot.position.turn ?? 0;
  const turn = Math.floor(moves / 2) + 1;

  const me = match.playerID as Mark | null;
  const isMyTurn = !isOver && me !== null && match.isActivePlayer;
  const activeMark = isMyTurn ? me : null;

  const seatLabel = (mark: Mark): string => (me === mark ? "You" : mark === "0" ? "Red" : "Yellow");
  const seatRole = (mark: Mark): string => {
    if (isOver) {
      if (result?.draw === true) return "Draw";
      return result?.winner === mark ? "Won" : "Lost";
    }
    if (active !== mark) return "Waiting";
    return me === mark ? "Your turn" : "Thinking…";
  };

  const seats: readonly [
    { mark: Mark; name: string; role: string; active: boolean },
    { mark: Mark; name: string; role: string; active: boolean },
  ] = [
    { mark: "0", name: seatLabel("0"), role: seatRole("0"), active: !isOver && active === "0" },
    { mark: "1", name: seatLabel("1"), role: seatRole("1"), active: !isOver && active === "1" },
  ];

  const status = isOver
    ? result?.draw === true
      ? "Draw"
      : result?.winner === "0"
        ? "Red wins"
        : "Yellow wins"
    : isMyTurn
      ? "Your turn — drop into a column"
      : `${active === "0" ? "Red" : "Yellow"} is thinking…`;

  return (
    <main className="min-h-screen bg-slate-50 text-slate-950">
      <Match
        board={board}
        lastMove={lastMove}
        activeMark={activeMark}
        canPlay={isMyTurn}
        onDrop={(col) => { void match.dispatch.dropDisc({ col }); }}
        status={status}
        seats={seats}
        turn={turn}
        moves={moves}
        isOver={isOver}
      />
    </main>
  );
}
