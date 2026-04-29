import {
  defineGame,
  defineEvent,
  roster,
  type PlayerRecord,
  type ReplayValue,
} from "@openturn/core";

export type PaperScissorsRockChoice = "paper" | "scissors" | "rock";

export interface PaperScissorsRockRoundOutcome extends Record<string, ReplayValue> {
  kind: "draw" | "pending" | "win";
  round: number;
  submittedPlayers: readonly PaperScissorsRockPlayers[number][];
  winners: readonly PaperScissorsRockPlayers[number][];
  winningChoice: PaperScissorsRockChoice | null;
}

export interface PaperScissorsRockState extends Record<string, ReplayValue> {
  lastOutcome: PaperScissorsRockRoundOutcome;
  lastRevealed: PlayerRecord<typeof PLAYERS, PaperScissorsRockChoice | null>;
  round: number;
  scores: PlayerRecord<typeof PLAYERS, number>;
  submissions: PlayerRecord<typeof PLAYERS, PaperScissorsRockChoice | null>;
}

export interface PaperScissorsRockPlayerView extends Record<string, ReplayValue> {
  lastOutcome: PaperScissorsRockRoundOutcome;
  lastRevealed: PlayerRecord<typeof PLAYERS, PaperScissorsRockChoice | null>;
  mySubmission: PaperScissorsRockChoice | null;
  round: number;
  scores: PlayerRecord<typeof PLAYERS, number>;
}

export interface PaperScissorsRockPublicView extends Record<string, ReplayValue> {
  lastOutcome: PaperScissorsRockRoundOutcome;
  lastRevealed: PlayerRecord<typeof PLAYERS, PaperScissorsRockChoice | null>;
  round: number;
  scores: PlayerRecord<typeof PLAYERS, number>;
  submittedCount: number;
}

const PLAYERS = ["0", "1", "2"] as const;
type PaperScissorsRockPlayers = typeof PLAYERS;

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
    lastRevealed: createEmptyChoices(),
    round: 1,
    scores: roster.record(match, 0),
    submissions: createEmptyChoices(),
  }),
  events: {
    submitChoice: defineEvent<PaperScissorsRockChoice>(),
  },
  initial: "plan",
  selectors: {
    submittedCount: ({ G }) => PLAYERS.filter((playerID) => G.submissions[playerID] !== null).length,
  },
  states: {
    plan: {
      activePlayers: ({ G }) => PLAYERS.filter((playerID) => G.submissions[playerID] === null),
      label: ({ G }) => `Round ${G.round}`,
    },
  },
  transitions: [
    {
      event: "submitChoice",
      from: "plan",
      label: "submit_pending",
      resolve: ({ G, event, playerID }) => {
        if (playerID === null) {
          return null;
        }

        const submissions = {
          ...G.submissions,
          [playerID]: event.payload,
        };
        const submittedPlayers = PLAYERS.filter((candidate) => submissions[candidate] !== null);

        if (submittedPlayers.length === PLAYERS.length) {
          return null;
        }

        return {
          G: {
            ...G,
            submissions,
          },
        };
      },
      to: "plan",
    },
    {
      event: "submitChoice",
      from: "plan",
      label: "submit_resolved",
      resolve: ({ G, event, playerID }) => {
        if (playerID === null) {
          return null;
        }

        const submissions = {
          ...G.submissions,
          [playerID]: event.payload,
        };
        const submittedPlayers = PLAYERS.filter((candidate) => submissions[candidate] !== null);

        if (submittedPlayers.length !== PLAYERS.length) {
          return null;
        }

        const outcome = {
          ...resolveRoundOutcome(submissions),
          round: G.round,
        };
        const scores = { ...G.scores };

        for (const winner of outcome.winners) {
          scores[winner] = (scores[winner] ?? 0) + 1;
        }

        return {
          G: {
            lastOutcome: outcome,
            lastRevealed: submissions,
            round: G.round + 1,
            scores,
            submissions: createEmptyChoices(),
          },
          turn: "increment",
        };
      },
      to: "plan",
    },
  ],
  views: {
    player: ({ G }: { G: PaperScissorsRockState }, playerID: PaperScissorsRockPlayers[number]): PaperScissorsRockPlayerView => ({
      lastOutcome: G.lastOutcome,
      lastRevealed: G.lastRevealed,
      mySubmission: G.submissions[playerID] ?? null,
      round: G.round,
      scores: G.scores,
    }),
    public: ({ G }: { G: PaperScissorsRockState }): PaperScissorsRockPublicView => ({
      lastOutcome: G.lastOutcome,
      lastRevealed: G.lastRevealed,
      round: G.round,
      scores: G.scores,
      submittedCount: PLAYERS.filter((playerID) => G.submissions[playerID] !== null).length,
    }),
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

function createEmptyChoices(): PlayerRecord<typeof PLAYERS, PaperScissorsRockChoice | null> {
  return roster.record({ players: PLAYERS }, null);
}
