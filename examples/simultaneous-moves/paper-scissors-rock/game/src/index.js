import { defineMatch, roster } from "@openturn/core";
import { defineGame, view } from "@openturn/gamekit";
const PLAYERS = ["0", "1", "2"];
export const paperScissorsRockMatch = defineMatch({
    players: PLAYERS,
});
export const paperScissorsRock = defineGame(paperScissorsRockMatch, {
    computed: {
        submittedCount: ({ G }) => PLAYERS.filter((playerID) => G.submissions[playerID] !== null).length,
    },
    initialPhase: "plan",
    moves: ({ move }) => ({
        submitChoice: move({
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
                for (const winner of outcome.winners) {
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
    setup: () => ({
        lastOutcome: {
            kind: "pending",
            round: 0,
            submittedPlayers: [],
            winners: [],
            winningChoice: null,
        },
        lastRevealed: createHiddenChoices(),
        round: 1,
        scores: roster.record(paperScissorsRockMatch, 0),
        submissions: createHiddenChoices(),
    }),
    views: {
        player: ({ G }, player) => ({
            lastOutcome: G.lastOutcome,
            lastRevealed: G.lastRevealed,
            mySubmission: G.submissions[player.id] ?? null,
            round: G.round,
            scores: G.scores,
        }),
        public: (context) => view.merge({
            lastOutcome: context.G.lastOutcome,
            lastRevealed: context.G.lastRevealed,
            round: context.G.round,
            scores: context.G.scores,
        }, context, "submittedCount"),
    },
});
function resolveRoundOutcome(submissions) {
    const submittedPlayers = PLAYERS.filter((playerID) => submissions[playerID] !== null);
    const choices = submittedPlayers.map((playerID) => submissions[playerID]);
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
    const winningChoice = getWinningChoice(uniqueChoices[0], uniqueChoices[1]);
    const winners = submittedPlayers.filter((playerID) => submissions[playerID] === winningChoice);
    return {
        kind: winners.length === 0 ? "draw" : "win",
        round: 0,
        submittedPlayers,
        winners,
        winningChoice: winners.length === 0 ? null : winningChoice,
    };
}
function getWinningChoice(left, right) {
    if (left === right) {
        return null;
    }
    if ((left === "rock" && right === "scissors")
        || (left === "scissors" && right === "paper")
        || (left === "paper" && right === "rock")) {
        return left;
    }
    if ((right === "rock" && left === "scissors")
        || (right === "scissors" && left === "paper")
        || (right === "paper" && left === "rock")) {
        return right;
    }
    return null;
}
function createHiddenChoices() {
    return roster.record(paperScissorsRockMatch, null);
}
