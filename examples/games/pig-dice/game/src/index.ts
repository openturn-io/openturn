import { roster, type PlayerID, type PlayerRecord } from "@openturn/core";
import { defineGame, turn } from "@openturn/gamekit";

export const PIG_DICE_TARGET_SCORE = 20;

const PIG_DICE_PLAYERS = ["0", "1"] as const;

export interface PigDiceState {
  lastRoll: number | null;
  scores: PlayerRecord<typeof PIG_DICE_PLAYERS, number>;
  turnTotal: number;
}

export interface PigDicePublicView {
  currentPlayer: PlayerID;
  lastRoll: number | null;
  scores: PlayerRecord<typeof PIG_DICE_PLAYERS, number>;
  turnTotal: number;
}

export const pigDice = defineGame({
  playerIDs: PIG_DICE_PLAYERS,
  setup: ({ match }): PigDiceState => ({
    lastRoll: null,
    scores: roster.record(match, 0),
    turnTotal: 0,
  }),
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
    roll: move<{ value: number }>({
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
  turn: turn.roundRobin(),
  views: {
    public: ({ G, turn }): PigDicePublicView => ({
      currentPlayer: turn.currentPlayer,
      lastRoll: G.lastRoll,
      scores: G.scores,
      turnTotal: G.turnTotal,
    }),
  },
});
