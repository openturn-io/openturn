import { useState, type ReactNode } from "react";

import { ticTacToeWithChat } from "@openturn/example-tic-tac-toe-with-chat-game";
import { ChatBubble } from "@openturn/plugin-chat/react";
import {
  HostedRoom,
  createOpenturnBindings,
  formatDispatchError,
  Lobby,
} from "@openturn/react";
import {
  BoardGrid,
  CardShell,
  PLAYER_LABEL,
  describeResult,
  type TicTacToeBoard,
  type TicTacToePlayerID,
} from "@openturn/example-tic-tac-toe-ui";

const { OpenturnProvider, useRoom } = createOpenturnBindings(ticTacToeWithChat, {
  runtime: "multiplayer",
});

const EMPTY_BOARD: TicTacToeBoard = [
  [null, null, null],
  [null, null, null],
  [null, null, null],
];

export function TicTacToeWithChatExperience() {
  return (
    <OpenturnProvider>
      <TicTacToeWithChatRoom />
    </OpenturnProvider>
  );
}

function TicTacToeWithChatRoom() {
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
              <Lobby lobby={lobby} title="Tic Tac Toe with Chat" />
            </section>
          )}
          game={(match) => <TicTacToeHostedGame match={match} />}
        />
      </section>
      {/* The chat bubble lives outside the HostedRoom switch so it persists
          across the lobby/game transition without being torn down. The
          underlying chat slice only exists in `runtime.game.snapshot.G.plugins.chat`,
          so the bubble auto-hides until the match is live (room.game !== null). */}
      <ChatBubble room={room} />
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

type RoomState = ReturnType<typeof useRoom>;

function TicTacToeHostedGame({
  match: hostedMatch,
}: {
  match: NonNullable<RoomState["game"]>;
}) {
  const [message, setMessage] = useState("Waiting for the hosted room.");
  const snapshot = hostedMatch.snapshot;
  const playerID = hostedMatch.playerID;
  const playerLabel =
    playerID === "0" || playerID === "1" ? PLAYER_LABEL[playerID] : "Unassigned";
  const result = hostedMatch.result;
  // With the chat plugin merged in, `activePlayers` is the full seated roster
  // (so off-turn players can dispatch chat). The "current turn" view is a
  // derived concept on the snapshot's `currentPlayer` field rather than on
  // `activePlayers[0]` like the plugin-free example does.
  const currentPlayer = snapshot?.G.currentPlayer ?? null;
  const canPlay = playerID !== null && currentPlayer === playerID && hostedMatch.status === "connected" && !hostedMatch.isFinished;

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
    ? currentPlayer === null
      ? "Tic Tac Toe with Chat"
      : PLAYER_LABEL[currentPlayer as TicTacToePlayerID] ?? "In progress"
    : describeResult(result);

  return (
    <section className="grid h-full min-h-0 w-full place-items-center p-6">
      <CardShell
        eyebrow="Openturn Cloud · chat plugin"
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
