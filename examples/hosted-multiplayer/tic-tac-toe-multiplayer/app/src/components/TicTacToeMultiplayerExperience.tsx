import { useState, type ReactNode } from "react";

import {
  ticTacToe,
} from "@openturn/example-tic-tac-toe-game";
import {
  HostedRoom,
  createOpenturnBindings,
  formatDispatchError,
  Lobby,
  type HostedRoomState,
} from "@openturn/react";
import {
  BoardGrid,
  CardShell,
  PLAYER_LABEL,
  describeResult,
  type TicTacToeBoard,
  type TicTacToePlayerID,
} from "@openturn/example-tic-tac-toe-ui";

const { OpenturnProvider, useRoom } = createOpenturnBindings(ticTacToe, {
  runtime: "multiplayer",
});

const EMPTY_BOARD: TicTacToeBoard = [
  [null, null, null],
  [null, null, null],
  [null, null, null],
];

export function TicTacToeMultiplayerExperience() {
  return (
    <OpenturnProvider>
      <TicTacToeMultiplayerRoom />
    </OpenturnProvider>
  );
}

function TicTacToeMultiplayerRoom() {
  const room = useRoom();

  return (
    <main className="h-full min-h-0 w-full overflow-hidden">
      <section className="h-full min-h-0 w-full">
        <HostedRoom
          room={room}
          missingBackend={<CenteredMessage>
            Hosted backend config is missing. Open this deployment through
            openturn-cloud <code>/play/&lt;deployment&gt;</code>.
          </CenteredMessage>}
          connecting={<CenteredMessage>Connecting to the room…</CenteredMessage>}
          closed={<CenteredMessage>This room is closed.</CenteredMessage>}
          error={(msg) => <CenteredMessage>{`Error: ${msg}`}</CenteredMessage>}
          fallback={<CenteredMessage>Loading…</CenteredMessage>}
          lobby={(lobby) => (
            <section className="grid h-full min-h-0 w-full place-items-center px-6 py-6">
              <Lobby lobby={lobby} title="Tic Tac Toe Multiplayer" />
            </section>
          )}
          game={(match) => <TicTacToeHostedGame match={match} />}
        />
      </section>
    </main>
  );
}

function CenteredMessage({ children }: { children: ReactNode }) {
  return (
    <section className="grid h-full min-h-0 w-full place-items-center px-6 py-6">
      <p className="max-w-[40ch] text-center text-sm text-slate-500">
        {children}
      </p>
    </section>
  );
}

function TicTacToeHostedGame({
  match: hostedMatch,
}: {
  match: NonNullable<HostedRoomState<typeof ticTacToe>["game"]>;
}) {
  const [message, setMessage] = useState("Waiting for the hosted room.");
  const snapshot = hostedMatch.snapshot;
  const playerID = hostedMatch.playerID;
  const playerLabel =
    playerID === "0" || playerID === "1" ? PLAYER_LABEL[playerID] : "Unassigned";
  const result = hostedMatch.result;
  const activePlayer = hostedMatch.activePlayers[0] ?? null;
  const canPlay = hostedMatch.canDispatch.placeMark;

  async function play(row: number, col: number) {
    if (!canPlay) return;

    setMessage("Move sent to the Durable Object room.");

    const outcome = await hostedMatch.dispatch.placeMark({ row, col });

    if (!outcome.ok) {
      setMessage(formatDispatchError(outcome, {
        byReason: { occupied: "That square is already occupied." },
        byError: { invalid_event: "That square is already occupied." },
      }));
    }
  }

  const board = (snapshot?.G.board ?? EMPTY_BOARD) as TicTacToeBoard;

  const bodyMessage =
    hostedMatch.error === "missing_hosted_backend"
      ? "Hosted backend config is missing. Open this deployment through openturn-cloud /play."
      : hostedMatch.error ?? messageForState(hostedMatch.status, canPlay, message);

  const title = result === null
    ? activePlayer === null
      ? "Tic Tac Toe Multiplayer"
      : PLAYER_LABEL[activePlayer as TicTacToePlayerID] ?? "In progress"
    : describeResult(result);

  return (
    <section className="grid h-full min-h-0 w-full place-items-center p-6">
      <CardShell
        eyebrow="Openturn Cloud multiplayer"
        title={title}
        message={
          <>
            <span className="block">{bodyMessage}</span>
            <span className="mt-2 block text-[0.7rem] uppercase tracking-[0.14em] text-slate-400">
              Room {hostedMatch.roomID ?? "pending"} · {playerLabel} · {hostedMatch.status}
            </span>
          </>
        }
      >
        <BoardGrid
          board={board}
          disabled={(cell) => !canPlay || cell !== null}
          onCellPress={(row, col) => { void play(row, col); }}
          ariaLabel="Hosted tic-tac-toe board"
        />
      </CardShell>
    </section>
  );
}

function messageForState(status: string, canPlay: boolean, fallback: string): string {
  if (status === "connected" && canPlay) return "Your turn. Pick an open square.";
  if (status === "connected")
    return fallback === "Waiting for the hosted room."
      ? "Waiting for the other player."
      : fallback;
  if (status === "connecting") return "Connecting to the room websocket.";
  if (status === "disconnected") return "Disconnected from the room.";
  if (status === "error") return "The hosted client reported an error.";
  return "Waiting for the hosted room.";
}
