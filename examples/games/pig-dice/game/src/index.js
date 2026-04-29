import { defineMatch, roster } from "@openturn/core";
import { defineGame, turn } from "@openturn/gamekit";
export const PIG_DICE_TARGET_SCORE = 20;
export const pigDiceMatch = defineMatch({
    players: ["0", "1"],
});
export const pigDice = defineGame(pigDiceMatch, {
    moves: ({ move }) => ({
        hold: move({
            run({ G, move, player }) {
                if (G.turnTotal === 0) {
                    return move.invalid("empty_turn", {
                        turnTotal: G.turnTotal,
                    });
                }
                const nextScores = {
                    ...G.scores,
                    [player.id]: (G.scores[player.id] ?? 0) + G.turnTotal,
                };
                if ((nextScores[player.id] ?? 0) >= PIG_DICE_TARGET_SCORE) {
                    return move.finish({ winner: player.id }, {
                        lastRoll: null,
                        scores: nextScores,
                        turnTotal: 0,
                    });
                }
                return move.endTurn({
                    lastRoll: null,
                    scores: nextScores,
                    turnTotal: 0,
                });
            },
        }),
        roll: move({
            run({ G, args, move }) {
                if (!Number.isInteger(args.value) || args.value < 1 || args.value > 6) {
                    return move.invalid("invalid_roll", {
                        value: args.value,
                    });
                }
                if (args.value === 1) {
                    return move.endTurn({
                        lastRoll: 1,
                        turnTotal: 0,
                    });
                }
                return move.stay({
                    lastRoll: args.value,
                    turnTotal: G.turnTotal + args.value,
                });
            },
        }),
    }),
    setup: () => ({
        lastRoll: null,
        scores: roster.record(pigDiceMatch, 0),
        turnTotal: 0,
    }),
    turn: turn.roundRobin(),
    views: {
        public: ({ G, turn }) => ({
            currentPlayer: turn.currentPlayer,
            lastRoll: G.lastRoll,
            scores: G.scores,
            turnTotal: G.turnTotal,
        }),
    },
});
