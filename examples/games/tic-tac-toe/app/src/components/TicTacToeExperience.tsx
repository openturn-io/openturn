import { useEffect, useState, type ReactNode } from "react";

import {
  ticTacToe,
  ticTacToeGameID,
  type TicTacToeCell,
} from "@openturn/example-tic-tac-toe-game";
import { createOpenturnBindings } from "@openturn/react";
import {
  createSavedReplayFromSession,
  serializeSavedReplay,
} from "@openturn/replay";

const PLAYER_LABELS = {
  "0": "Player X",
  "1": "Player O",
} as const;

const PANEL_CLASS_NAME =
  "rounded-2xl border border-slate-200 bg-white px-4 py-4 shadow-sm";
const BOARD_CELL_CLASS_NAME =
  "group relative aspect-square rounded-2xl border border-slate-200 bg-slate-50 text-slate-900 transition duration-150 ease-out hover:border-slate-300 hover:bg-white hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 data-[filled=true]:bg-white";

const ticTacToeBindings = createOpenturnBindings(ticTacToe, {
  runtime: "local",
  match: { players: ticTacToe.playerIDs },
});
const { useMatch } = ticTacToeBindings;
const PLACEMENT_ANIMATION_MS = 380;

function useLocalMatch() {
  const match = useMatch();
  if (match.mode !== "local") {
    throw new Error("TicTacToeExperience requires a local match.");
  }
  return match.state;
}

interface AnimatedCellState {
  col: number;
  row: number;
}

export function TicTacToeExperience() {
  return (
    <main className="h-full min-h-0 w-full overflow-hidden">
      <section className="h-full min-h-0 w-full">
        <TicTacToeArena />
      </section>
    </main>
  );
}

function TicTacToeArena({
  actionSlot,
  readOnly = false,
}: {
  actionSlot?: ReactNode;
  readOnly?: boolean;
}) {
  const { dispatch, lastBatch, replayData, reset, snapshot } = useLocalMatch();
  const [message, setMessage] = useState<string>(
    readOnly
      ? "Loaded replay. Scrub the timeline to inspect the frozen board state."
      : "Claim the center or cut the diagonal.",
  );
  const [animatedCell, setAnimatedCell] = useState<AnimatedCellState | null>(null);
  const result = snapshot.meta.result;
  const activePlayer = snapshot.derived.activePlayers[0] ?? replayData.match.players[0];
  const currentPlayerLabel = PLAYER_LABELS[activePlayer];
  const latestPlacement = getLatestPlacement(lastBatch);

  useEffect(() => {
    if (readOnly) {
      setMessage("Loaded replay. Scrub the timeline to inspect the frozen board state.");
    }
  }, [readOnly]);

  useEffect(() => {
    if (latestPlacement === null) {
      return;
    }

    setAnimatedCell(latestPlacement);
  }, [latestPlacement?.row, latestPlacement?.col, snapshot.position.turn]);

  useEffect(() => {
    if (animatedCell === null) {
      return;
    }

    const timeoutID = window.setTimeout(() => {
      setAnimatedCell((current) =>
        current?.row === animatedCell.row && current.col === animatedCell.col ? null : current);
    }, PLACEMENT_ANIMATION_MS);

    return () => {
      window.clearTimeout(timeoutID);
    };
  }, [animatedCell]);

  const onCellPress = (row: number, col: number) => {
    if (readOnly || result !== null) {
      return;
    }

    const dispatchResult = dispatch.placeMark(activePlayer, { row, col });

    if (!dispatchResult.ok) {
      setMessage(formatError(dispatchResult.error));
      return;
    }

    setMessage("Position sealed. Read the board and pressure the next line.");
  };

  const onRestart = () => {
    if (readOnly) {
      return;
    }

    reset();
    setMessage("Fresh board. Set the tempo.");
  };

  const onDownloadReplay = () => {
    const envelope = createSavedReplayFromSession({
      gameID: ticTacToeGameID,
      metadata: {
        label: "Tic-tac-toe replay",
      },
      playerID: "0",
      session: {
        getReplayData: () => replayData,
      },
    });

    downloadTextFile("tic-tac-toe-replay.json", serializeSavedReplay(envelope));
  };

  return (
    <section className="grid h-full min-h-0 w-full gap-8 overflow-auto border border-slate-200 bg-white/90 px-6 py-6 shadow-[0_24px_80px_rgba(15,23,42,0.08)] backdrop-blur animate-[stage-rise_420ms_cubic-bezier(0.2,0.8,0.2,1)] lg:grid-cols-[minmax(0,1fr)_minmax(280px,460px)] lg:px-10 lg:py-10">
      <div className="flex max-w-[520px] flex-col justify-center gap-5">
        <p className="m-0 text-[0.78rem] font-medium uppercase tracking-[0.22em] text-slate-500">
          {readOnly ? "Saved replay" : "Openturn React"}
        </p>
        <h2 className="m-0 max-w-[11ch] font-display text-[clamp(2.8rem,5vw,4.8rem)] leading-[0.96] tracking-[-0.05em] text-slate-950">
          One engine. Local now. Hosted next.
        </h2>
        <p className="m-0 max-w-[34ch] text-[1.02rem] leading-[1.7] text-slate-600">
          Tic-tac-toe runs through the same authored game definition you can keep for multiplayer later.
        </p>

        <div className="grid gap-[18px] sm:grid-cols-2">
          <div className={PANEL_CLASS_NAME}>
            <span className="mb-2 block text-[0.72rem] uppercase tracking-[0.14em] text-slate-500">Turn</span>
            <strong className="text-slate-950">{result === null ? currentPlayerLabel : "Match sealed"}</strong>
          </div>
          <div className={PANEL_CLASS_NAME}>
            <span className="mb-2 block text-[0.72rem] uppercase tracking-[0.14em] text-slate-500">Board state</span>
            <strong className="text-slate-950">{describeResult(result)}</strong>
          </div>
        </div>

        <p aria-live="polite" className="m-0 min-h-6 text-sm text-slate-600">
          {message}
        </p>

        {readOnly
          ? actionSlot
          : (
              <div className="flex flex-wrap gap-3">
                <button
                  className="w-fit rounded-full border border-slate-300 bg-slate-950 px-5 py-3 text-sm font-medium text-white transition duration-150 ease-out hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
                  onClick={onRestart}
                  type="button"
                >
                  Restart match
                </button>
                <button
                  className="w-fit rounded-full border border-slate-300 bg-white px-5 py-3 text-sm font-medium text-slate-700 transition duration-150 ease-out hover:border-slate-400 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
                  onClick={onDownloadReplay}
                  type="button"
                >
                  Export replay JSON
                </button>
                {actionSlot}
              </div>
            )}
      </div>

      <div className="flex min-w-0 flex-col items-center justify-center gap-4">
        <div className="w-full max-w-[460px] rounded-[1.75rem] border border-slate-200 bg-slate-100 p-4 shadow-sm sm:p-5">
          <div className="grid grid-cols-3 gap-3" role="grid" aria-label="Tic-tac-toe board">
            {snapshot.G.board.map((row, rowIndex) =>
              row.map((cell, colIndex) => (
                <AnimatedBoardCell
                  cell={cell}
                  col={colIndex}
                  disabled={readOnly || result !== null}
                  isAnimated={animatedCell?.row === rowIndex && animatedCell?.col === colIndex}
                  key={`${rowIndex}-${colIndex}`}
                  onPress={() => onCellPress(rowIndex, colIndex)}
                  row={rowIndex}
                />
              )),
            )}
          </div>
        </div>

        <div className="flex flex-wrap justify-center gap-[18px] text-[0.88rem] text-slate-500">
          <span>X opens with pressure.</span>
          <span>O answers by denying lanes.</span>
        </div>
      </div>
    </section>
  );
}

function AnimatedBoardCell({
  cell,
  col,
  disabled,
  isAnimated,
  onPress,
  row,
}: {
  cell: TicTacToeCell;
  col: number;
  disabled: boolean;
  isAnimated: boolean;
  onPress: () => void;
  row: number;
}) {
  return (
    <button
      aria-label={`Row ${row + 1} Column ${col + 1}`}
      className={`${BOARD_CELL_CLASS_NAME} ${isAnimated ? "z-10 border-slate-400 bg-white shadow-[0_18px_42px_rgba(15,23,42,0.16)] animate-[board-cell-pulse_380ms_cubic-bezier(0.2,0.82,0.2,1)]" : ""}`}
      data-animated={isAnimated}
      data-filled={cell !== null}
      disabled={disabled}
      onClick={onPress}
      type="button"
    >
      <span className={markClassName(cell, isAnimated)}>{cell ?? ""}</span>
    </button>
  );
}

function describeResult(result: { draw?: true; winner?: string } | null): string {
  if (result?.winner === "0") {
    return "Player X wins";
  }

  if (result?.winner === "1") {
    return "Player O wins";
  }

  if (result?.draw) {
    return "Draw";
  }

  return "In progress";
}

function formatError(error: string): string {
  switch (error) {
    case "game_over":
      return "The line is already closed. Restart to play again.";
    case "inactive_player":
      return "Wait for your turn before pressing the board.";
    case "invalid_event":
      return "That square is occupied. Pick a clean lane.";
    case "unknown_player":
      return "That seat is not part of this match.";
    default:
      return "That move was rejected.";
  }
}

function markClassName(cell: TicTacToeCell, isAnimated: boolean): string {
  const baseClassName =
    "inline-flex h-full w-full items-center justify-center font-display text-[clamp(2.8rem,8vw,4.5rem)] leading-none transition duration-150 ease-out group-hover:scale-[1.02]";
  const animationClassName = isAnimated
    ? " animate-[mark-bloom_320ms_cubic-bezier(0.18,0.9,0.22,1)]"
    : "";

  if (cell === "X") {
    return `${baseClassName}${animationClassName} text-x-tone`;
  }

  if (cell === "O") {
    return `${baseClassName}${animationClassName} text-o-tone`;
  }

  return `${baseClassName} text-slate-300`;
}

function getLatestPlacement(
  lastBatch: ReturnType<typeof useLocalMatch>["lastBatch"],
): { col: number; row: number } | null {
  const payload = lastBatch?.steps.find((step) => step.kind === "action")?.event.payload;
  if (payload === null || payload === undefined) {
    return null;
  }

  return {
    col: payload.col,
    row: payload.row,
  };
}

function downloadTextFile(filename: string, text: string) {
  const blob = new Blob([text], { type: "application/json" });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(href);
}
