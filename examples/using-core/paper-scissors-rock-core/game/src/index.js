import { defineGame, defineMatch, defineEvent, roster, } from "@openturn/core";
const PLAYERS = ["0", "1", "2"];
export const paperScissorsRockMatch = defineMatch({
    players: PLAYERS,
});
export const paperScissorsRock = defineGame(paperScissorsRockMatch, {
    events: {
        submitChoice: defineEvent(),
    },
    initial: "plan",
    selectors: {
        submittedCount: ({ G }) => PLAYERS.filter((playerID) => G.submissions[playerID] !== null).length,
    },
    setup: () => ({
        lastOutcome: {
            kind: "pending",
            round: 0,
            submittedPlayers: [],
            winners: [],
            winningChoice: null,
        },
        lastRevealed: createEmptyChoices(),
        round: 1,
        scores: roster.record(paperScissorsRockMatch, 0),
        submissions: createEmptyChoices(),
    }),
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
        player: ({ G }, playerID) => ({
            lastOutcome: G.lastOutcome,
            lastRevealed: G.lastRevealed,
            mySubmission: G.submissions[playerID] ?? null,
            round: G.round,
            scores: G.scores,
        }),
        public: ({ G }) => ({
            lastOutcome: G.lastOutcome,
            lastRevealed: G.lastRevealed,
            round: G.round,
            scores: G.scores,
            submittedCount: PLAYERS.filter((playerID) => G.submissions[playerID] !== null).length,
        }),
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
function createEmptyChoices() {
    return roster.record(paperScissorsRockMatch, null);
}
