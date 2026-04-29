import { roster, type PlayerID, type PlayerRecord, type ReplayValue } from "@openturn/core";
import { defineGame, view } from "@openturn/gamekit";

export type PaperScissorsRockChoice = "paper" | "scissors" | "rock";

export interface PaperScissorsRockRoundOutcome {
  kind: "draw" | "pending" | "win";
  round: number;
  submittedPlayers: readonly PlayerID[];
  winners: readonly PlayerID[];
  winningChoice: PaperScissorsRockChoice | null;
}

export interface PaperScissorsRockState {
  lastOutcome: PaperScissorsRockRoundOutcome;
  lastRevealed: PlayerRecord<typeof PLAYERS, PaperScissorsRockChoice | null>;
  round: number;
  scores: PlayerRecord<typeof PLAYERS, number>;
  submissions: PlayerRecord<typeof PLAYERS, PaperScissorsRockChoice | null>;
}

export interface PaperScissorsRockPlayerView {
  lastOutcome: PaperScissorsRockRoundOutcome;
  lastRevealed: PlayerRecord<typeof PLAYERS, PaperScissorsRockChoice | null>;
  mySubmission: PaperScissorsRockChoice | null;
  round: number;
  scores: PlayerRecord<typeof PLAYERS, number>;
}

export interface PaperScissorsRockPublicView {
  lastOutcome: PaperScissorsRockRoundOutcome;
  lastRevealed: PlayerRecord<typeof PLAYERS, PaperScissorsRockChoice | null>;
  round: number;
  scores: PlayerRecord<typeof PLAYERS, number>;
  submittedCount: number;
}

interface PaperScissorsRockComputed {
  [key: string]: ReplayValue;
  submittedCount: number;
}

const PLAYERS = ["0", "1", "2"] as const;

export const paperScissorsRock = defineGame({
  playerIDs: PLAYERS,
  setup: ({ match }): PaperScissorsRockState => ({
    lastOutcome: {
      kind: "pending",
      round: 0,
      submittedPlayers: [],
      winners: [],
      winningChoice: null,
    },
    lastRevealed: createHiddenChoices(),
    round: 1,
    scores: roster.record(match, 0),
    submissions: createHiddenChoices(),
  }),
  computed: {
    submittedCount: ({ G }) => PLAYERS.filter((playerID) => G.submissions[playerID] !== null).length,
  },
  initialPhase: "plan",
  moves: ({ move }) => ({
    submitChoice: move<PaperScissorsRockChoice>({
      run({ G, args, move, player }) {
        const submissions = {
          ...G.submissions,
          [player.id]: args,
        };
        const submittedPlayers = PLAYERS.filter((playerID) => submissions[playerID] !== null);

        if (submittedPlayers.length < PLAYERS.length) {
          return move.stay({ submissions });
        }

        const outcome = {
          ...resolveRoundOutcome(submissions),
          round: G.round,
        };
        const scores = {
          ...G.scores,
        };

        for (const winner of outcome.winners as readonly (typeof PLAYERS)[number][]) {
          scores[winner] = (scores[winner] ?? 0) + 1;
        }

        return move.endTurn({
          lastOutcome: outcome,
          lastRevealed: submissions,
          round: G.round + 1,
          scores,
          submissions: createHiddenChoices(),
        });
      },
    }),
  }),
  phases: {
    plan: {
      activePlayers: ({ G }) => PLAYERS.filter((playerID) => G.submissions[playerID] === null),
      label: ({ G }) => `Round ${G.round}`,
    },
  },
  views: {
    player: ({ G }, player): PaperScissorsRockPlayerView => ({
      lastOutcome: G.lastOutcome,
      lastRevealed: G.lastRevealed,
      mySubmission: G.submissions[player.id] ?? null,
      round: G.round,
      scores: G.scores,
    }),
    public: (context): PaperScissorsRockPublicView => view.merge({
      lastOutcome: context.G.lastOutcome,
      lastRevealed: context.G.lastRevealed,
      round: context.G.round,
      scores: context.G.scores,
    }, context, "submittedCount"),
  },
});

function resolveRoundOutcome(
  submissions: PlayerRecord<typeof PLAYERS, PaperScissorsRockChoice | null>,
): PaperScissorsRockRoundOutcome {
  const submittedPlayers = PLAYERS.filter((playerID) => submissions[playerID] !== null);
  const choices = submittedPlayers.map((playerID) => submissions[playerID]!);
  const uniqueChoices = [...new Set(choices)];

  if (uniqueChoices.length !== 2) {
    return {
      kind: "draw",
      round: 0,
      submittedPlayers,
      winners: [],
      winningChoice: null,
    };
  }

  const winningChoice = getWinningChoice(uniqueChoices[0]!, uniqueChoices[1]!);
  const winners = submittedPlayers.filter((playerID) => submissions[playerID] === winningChoice);

  return {
    kind: winners.length === 0 ? "draw" : "win",
    round: 0,
    submittedPlayers,
    winners,
    winningChoice: winners.length === 0 ? null : winningChoice,
  };
}

function getWinningChoice(
  left: PaperScissorsRockChoice,
  right: PaperScissorsRockChoice,
): PaperScissorsRockChoice | null {
  if (left === right) {
    return null;
  }

  if (
    (left === "rock" && right === "scissors")
    || (left === "scissors" && right === "paper")
    || (left === "paper" && right === "rock")
  ) {
    return left;
  }

  if (
    (right === "rock" && left === "scissors")
    || (right === "scissors" && left === "paper")
    || (right === "paper" && left === "rock")
  ) {
    return right;
  }

  return null;
}

function createHiddenChoices(): PlayerRecord<typeof PLAYERS, PaperScissorsRockChoice | null> {
  return roster.record({ players: PLAYERS }, null);
}
