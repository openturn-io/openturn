import { useState } from "react";

import {
  ticTacToe,
  ticTacToeGameID,
} from "@openturn/example-tic-tac-toe-game";

const ticTacToeMatch = { players: ticTacToe.playerIDs };
import { createOpenturnBindings } from "@openturn/react";
import {
  parseSavedReplay,
  type SavedReplayEnvelope,
} from "@openturn/replay";
import {
  BoardGrid,
  CardShell,
  PLAYER_LABEL,
  describeResult,
  type TicTacToeBoard,
} from "@openturn/example-tic-tac-toe-ui";

type TicTacToeSavedReplay = SavedReplayEnvelope<typeof ticTacToeMatch.players>;
type DispatchResult = { ok: true } | { ok: false; error: string };

const ticTacToeBindings = createOpenturnBindings(ticTacToe, {
  runtime: "local",
  match: ticTacToeMatch,
});
const { useMatch } = ticTacToeBindings;

function useLocalMatch() {
  const match = useMatch();
  if (match.mode !== "local") {
    throw new Error("TicTacToeReplayViewer requires a local match.");
  }
  return match.state;
}

const EMPTY_BOARD: TicTacToeBoard = [
  [null, null, null],
  [null, null, null],
  [null, null, null],
];

export function TicTacToeReplayViewer() {
  const matchState = useLocalMatch();
  const [loadedReplay, setLoadedReplay] = useState<TicTacToeSavedReplay | null>(null);

  const onReadFile = async (file: File | null) => {
    if (file === null) return;

    try {
      const envelope = parseSavedReplay(await file.text());

      if (envelope.gameID !== ticTacToeGameID) {
        throw new Error(`Unknown replay game "${envelope.gameID}".`);
      }

      matchState.reset();
      applyReplayActions(matchState.dispatch, envelope as TicTacToeSavedReplay);
      setLoadedReplay(envelope as TicTacToeSavedReplay);
    } catch (error) {
      setLoadedReplay(null);
      matchState.reset();
      window.alert(error instanceof Error ? error.message : "Failed to load replay.");
    }
  };

  if (loadedReplay !== null) {
    return (
      <main className="h-full min-h-0 w-full overflow-hidden">
        <section className="h-full min-h-0 w-full flex items-center justify-center p-6">
          <LoadedReplayCard />
        </section>
      </main>
    );
  }

  return (
    <main className="h-full min-h-0 w-full overflow-hidden">
      <section className="h-full min-h-0 w-full flex items-center justify-center p-6">
        <CardShell
          eyebrow="Saved replay"
          title="Load a tic-tac-toe replay"
          message="Pick a replay JSON exported from the local example to inspect every frozen board state."
          footer={
            <label className="inline-flex w-fit cursor-pointer items-center rounded-full border border-slate-300 bg-slate-950 px-5 py-2 text-sm font-medium text-white transition hover:bg-slate-800 focus-within:outline-none focus-within:ring-2 focus-within:ring-slate-300">
              Choose replay JSON
              <input
                aria-label="Choose replay JSON"
                accept="application/json"
                className="sr-only"
                onChange={(event) => void onReadFile(event.target.files?.[0] ?? null)}
                type="file"
              />
            </label>
          }
        >
          <BoardGrid board={EMPTY_BOARD} disabled ariaLabel="Empty tic-tac-toe board preview" />
        </CardShell>
      </section>
    </main>
  );
}

function LoadedReplayCard() {
  const { snapshot } = useLocalMatch();
  const result = snapshot.meta.result;
  const activePlayer = snapshot.derived.activePlayers[0] ?? ticTacToeMatch.players[0];

  return (
    <CardShell
      eyebrow="Saved replay"
      title={result === null ? PLAYER_LABEL[activePlayer] : describeResult(result)}
      message="Loaded replay into the dev shell history."
      footer={
        <span className="rounded-full border border-slate-200 bg-slate-100 px-4 py-1.5 text-xs font-medium uppercase tracking-[0.18em] text-slate-500">
          Shell history
        </span>
      }
    >
      <BoardGrid board={snapshot.G.board as TicTacToeBoard} disabled />
    </CardShell>
  );
}

function applyReplayActions(
  dispatch: ReturnType<typeof useLocalMatch>["dispatch"],
  replay: TicTacToeSavedReplay,
) {
  for (const action of replay.actions) {
    const dispatchEvent = dispatch[action.event as keyof typeof dispatch] as
      | ((playerID: string, payload?: unknown) => DispatchResult)
      | undefined;

    if (dispatchEvent === undefined) {
      throw new Error(`Unknown replay event "${action.event}".`);
    }

    const result = action.payload === null
      ? dispatchEvent(action.playerID)
      : dispatchEvent(action.playerID, action.payload);

    if (!result.ok) {
      throw new Error(`Failed to load replay action "${action.event}": ${result.error}.`);
    }
  }
}
