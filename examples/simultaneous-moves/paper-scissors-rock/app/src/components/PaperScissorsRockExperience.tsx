import { useState } from "react";

import {
  paperScissorsRock,
  type PaperScissorsRockChoice,
  type PaperScissorsRockRoundOutcome,
} from "@openturn/example-paper-scissors-rock-game";

const paperScissorsRockMatch = { players: paperScissorsRock.playerIDs };
import {
  createOpenturnBindings,
} from "@openturn/react";

const PLAYER_IDS = ["0", "1", "2"] as const;
const PLAYER_LABELS = {
  "0": "Player Ember",
  "1": "Player Tide",
  "2": "Player Flint",
} as const;
const PLAYER_PANEL_CLASS_NAMES = {
  "0": "border-player-a/30 bg-white",
  "1": "border-player-b/30 bg-white",
  "2": "border-player-c/30 bg-white",
} as const;
const CHOICE_LABELS: Record<PaperScissorsRockChoice, string> = {
  paper: "Paper",
  scissors: "Scissors",
  rock: "Rock",
};
const PANEL_CLASS_NAME =
  "rounded-2xl border border-slate-200 bg-white px-4 py-4 shadow-sm";
const paperScissorsRockBindings = createOpenturnBindings(paperScissorsRock, {
  runtime: "local",
  match: paperScissorsRockMatch,
});
const { useMatch } = paperScissorsRockBindings;

function useLocalMatch() {
  const match = useMatch();
  if (match.mode !== "local") {
    throw new Error("PaperScissorsRockExperience requires a local match.");
  }
  return match.state;
}

export function PaperScissorsRockExperience() {
  return <PaperScissorsRockArena />;
}

function PaperScissorsRockArena() {
  const { dispatch, reset, snapshot } = useLocalMatch();
  const [message, setMessage] = useState("Gamekit move authoring keeps the hidden round open until everyone locks in.");

  const onChoose = (playerID: (typeof PLAYER_IDS)[number], choice: PaperScissorsRockChoice) => {
    const result = dispatch.submitChoice(playerID, choice);

    if (!result.ok) {
      setMessage(formatError(result.error));
      return;
    }

    const nextPlayerLabel = snapshot.derived.activePlayers.includes(playerID)
      ? PLAYER_LABELS[playerID]
      : "Round resolving";
    setMessage(`${nextPlayerLabel} locked ${CHOICE_LABELS[choice]}.`);
  };

  const onRestart = () => {
    reset();
    setMessage("Fresh gamekit match. The round stays open until all three hidden choices are locked.");
  };

  const submittedCount = snapshot.derived.selectors.submittedCount as number | undefined;

  return (
    <main className="grid h-full min-h-0 w-full place-items-center overflow-auto px-4 py-8 sm:px-8">
      <section className="grid w-full max-w-6xl gap-8 rounded-4xl border border-slate-200 bg-white/90 px-6 py-6 shadow-[0_24px_80px_rgba(15,23,42,0.08)] backdrop-blur animate-[stage-rise_420ms_cubic-bezier(0.2,0.8,0.2,1)] lg:grid-cols-[minmax(0,1fr)_minmax(380px,480px)] lg:px-10 lg:py-10">
        <div className="flex max-w-[560px] flex-col justify-center gap-5">
          <p className="m-0 text-[0.78rem] font-medium uppercase tracking-[0.22em] text-slate-500">Openturn Gamekit</p>
          <h1 className="m-0 max-w-[12ch] font-display text-[clamp(2.8rem,5vw,4.8rem)] leading-[0.96] tracking-[-0.05em] text-slate-950">
            Hidden turns. Shared round. Gamekit authoring.
          </h1>
          <p className="m-0 max-w-[34ch] text-[1.02rem] leading-[1.7] text-slate-600">
            Paper-scissors-rock now uses gamekit move authoring, while a small core state override preserves the same simultaneous hidden round model.
          </p>

          <div className="grid gap-[18px] sm:grid-cols-3">
            <div className={PANEL_CLASS_NAME}>
              <span className="mb-2 block text-[0.72rem] uppercase tracking-[0.14em] text-slate-500">Round</span>
              <strong className="text-slate-950" data-testid="round-value">{snapshot.G.round}</strong>
            </div>
            <div className={PANEL_CLASS_NAME}>
              <span className="mb-2 block text-[0.72rem] uppercase tracking-[0.14em] text-slate-500">Submitted</span>
              <strong className="text-slate-950" data-testid="clock-value">{submittedCount ?? 0} / 3</strong>
            </div>
            <div className={PANEL_CLASS_NAME}>
              <span className="mb-2 block text-[0.72rem] uppercase tracking-[0.14em] text-slate-500">Mode</span>
              <strong className="text-slate-950">Gamekit + core state</strong>
            </div>
          </div>

          <div className="grid gap-4 rounded-[1.75rem] border border-slate-200 bg-slate-100 p-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="m-0 text-[0.72rem] uppercase tracking-[0.14em] text-slate-500">Last reveal</p>
                <strong className="text-slate-950" data-testid="outcome-summary">{describeOutcomeHeadline(snapshot.G.lastOutcome)}</strong>
              </div>
              <button
                className="w-fit rounded-full border border-slate-300 bg-slate-950 px-5 py-3 text-sm font-medium text-white transition duration-150 ease-out hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
                onClick={onRestart}
                type="button"
              >
                Restart match
              </button>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              {PLAYER_IDS.map((playerID) => (
                <div key={playerID} className="rounded-2xl border border-slate-200 bg-white px-4 py-4">
                  <span className="mb-1 block text-[0.72rem] uppercase tracking-[0.14em] text-slate-500">
                    {PLAYER_LABELS[playerID]}
                  </span>
                  <strong className="text-slate-950" data-testid={`score-${playerID}`}>
                    {snapshot.G.scores[playerID]} points
                  </strong>
                  <p className="mt-2 mb-0 text-sm text-slate-600" data-testid={`revealed-${playerID}`}>
                    {formatRevealedChoice(playerID, snapshot.G.lastRevealed)}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <p aria-live="polite" className="m-0 min-h-6 text-sm text-slate-600" data-testid="status-message">
            {message}
          </p>
        </div>

        <div className="grid gap-4">
          {PLAYER_IDS.map((playerID) => (
            <PlayerChoicePanel key={playerID} onChoose={onChoose} playerID={playerID} />
          ))}
        </div>
      </section>
    </main>
  );
}

function PlayerChoicePanel({
  playerID,
  onChoose,
}: {
  playerID: (typeof PLAYER_IDS)[number];
  onChoose: (playerID: (typeof PLAYER_IDS)[number], choice: PaperScissorsRockChoice) => void;
}) {
  const { snapshot, getPlayerView } = useLocalMatch();
  const playerView = getPlayerView(playerID);
  const isActive = snapshot.derived.activePlayers.includes(playerID);

  return (
    <section
      className={`rounded-[1.75rem] border p-5 shadow-sm ${PLAYER_PANEL_CLASS_NAMES[playerID]}`}
      data-testid={`panel-${playerID}`}
    >
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="m-0 text-[0.72rem] uppercase tracking-[0.14em] text-slate-500">{PLAYER_LABELS[playerID]}</p>
          <strong className="text-slate-950">{isActive ? "Choice open" : "Choice locked"}</strong>
        </div>
        <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs uppercase tracking-[0.14em] text-slate-500">
          {playerView.mySubmission === null ? "Hidden" : CHOICE_LABELS[playerView.mySubmission as PaperScissorsRockChoice]}
        </span>
      </div>

      <div className="mt-5 grid gap-3">
        {(Object.keys(CHOICE_LABELS) as PaperScissorsRockChoice[]).map((choice) => (
          <button
            className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left text-sm font-medium text-slate-950 transition duration-150 ease-out hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            data-testid={`${playerID}-${choice}`}
            disabled={!isActive}
            key={choice}
            onClick={() => onChoose(playerID, choice)}
            type="button"
          >
            {CHOICE_LABELS[choice]}
          </button>
        ))}
      </div>
    </section>
  );
}

function describeOutcomeHeadline(outcome: PaperScissorsRockRoundOutcome): string {
  if (outcome.round === 0) {
    return "No rounds resolved yet";
  }

  if (outcome.kind === "draw") {
    return `Round ${outcome.round}: draw`;
  }

  return `Round ${outcome.round}: ${outcome.winners.map((winner) => PLAYER_LABELS[winner as keyof typeof PLAYER_LABELS]).join(", ")}`;
}

function formatError(error: string): string {
  switch (error) {
    case "game_over":
      return "The match is over.";
    case "inactive_player":
      return "That player has already locked their choice for this round.";
    case "invalid_event":
      return "That choice was rejected by the authored game.";
    default:
      return "That choice could not be applied.";
  }
}

function formatRevealedChoice(
  playerID: (typeof PLAYER_IDS)[number],
  lastRevealed: Record<string, PaperScissorsRockChoice | null>,
): string {
  const choice = lastRevealed[playerID];

  if (choice === null || choice === undefined) {
    return "No reveal yet";
  }

  return `Last reveal: ${CHOICE_LABELS[choice]}`;
}
