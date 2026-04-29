import { createLocalSession } from "@openturn/core";

import { defineGame } from "./index";

const PLAYERS = ["0", "1"] as const;
const match = { players: PLAYERS };

type Phase = "play" | "review";
type State = { count: number };
type Players = typeof PLAYERS;

const game = defineGame({
  playerIDs: PLAYERS,
  initialPhase: "play" as const,
  moves: ({ move }) => {
    const builtMoves = {
      advance: move<{ step: number }>({
        run({ args, move }) {
          return args.step > 0 ? move.goto("review") : move.endTurn();
        },
      }),
      review: move({
        run({ move }) {
          return move.endTurn();
        },
      }),
      invalidQueue: move({
        run({ move }) {
          return move.endTurn();
        },
      }),
    };

    const _players: Players = PLAYERS;
    const _state: State = { count: 0 };
    void _players;
    void _state;

    return builtMoves;
  },
  phases: {
    play: {},
    review: {},
  },
  setup: () => ({ count: 0 }),
});

const session = createLocalSession(game, { match });
const positionName: "play" | "review" | "__gamekit_finished" = session.getState().position.name;

void positionName;

export {};
