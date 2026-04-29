import {
  createLocalSession,
  defineGame,
  defineEvent,
  defineTransitions,
  type GameEventPayloads,
  type GamePlayerID,
  type Serializable,
} from "./index";

const match = { players: ["0", "1"] as const };

const game = defineGame({
  playerIDs: ["0", "1"] as const,
  events: {
    ping: undefined,
    maybe: undefined as { step: number } | undefined,
    pong: { step: 1 as number },
  },
  initial: "idle",
  setup: () => ({ count: 0 }),
  states: {
    idle: {
      activePlayers: ({ match: nextMatch }) => [nextMatch.players[0]!],
    },
  },
  transitions: [
    { event: "ping", from: "idle", to: "idle" },
    { event: "maybe", from: "idle", to: "idle" },
    { event: "pong", from: "idle", to: "idle" },
  ],
});

const session = createLocalSession(game, { match });

void session.applyEvent("0", "ping");
void session.applyEvent("0", "ping", undefined);
void session.applyEvent("0", "maybe", { step: 1 });
void session.applyEvent("0", "pong", { step: 1 });

// @ts-expect-error maybe still requires the object half of the union
void session.applyEvent("0", "maybe");

// @ts-expect-error maybe cannot omit its payload just because undefined is allowed in the union
void session.applyEvent("0", "maybe", undefined);

// @ts-expect-error pong requires a payload
void session.applyEvent("0", "pong", undefined);

interface ErgonomicState {
  count: number;
}

const ergonomicGame = defineGame({
  playerIDs: ["0", "1"] as const,
  events: {
    place: defineEvent<{ row: number }>(),
  },
  initial: "idle",
  setup: (): ErgonomicState => ({ count: 0 }),
  states: {
    done: {
      activePlayers: () => [],
      control: () => ({ status: "done" as const }),
    },
    idle: {
      activePlayers: ({ G, match: nextMatch }) => {
        const count: number = G.count;
        const playerID: "0" | "1" = nextMatch.players[0]!;

        void count;
        return [playerID];
      },
      control: () => ({ status: "idle" as const }),
    },
  },
  transitions: ({ transition }) => [
    transition("place", {
      from: "idle",
      resolve: ({ G, event, playerID }) => {
        const row: number = event.payload.row;

        // @ts-expect-error transition helper narrows payload to the selected event
        event.payload.col;

        if (playerID === null) {
          return null;
        }

        return {
          G: { count: G.count + row },
          result: { winner: playerID },
          turn: "increment",
        };
      },
      to: "done",
    }),
  ],
  views: {
    player: ({ G }, playerID) => ({ count: G.count, playerID }),
    public: ({ G }) => ({ count: G.count }),
  },
});

const ergonomicSession = createLocalSession(ergonomicGame, { match });
const ergonomicPublicView: { count: number } = ergonomicSession.getPublicView();
const ergonomicPlayerView: { count: number; playerID: "0" | "1" } = ergonomicSession.getPlayerView("0");
const ergonomicResult: { winner: "0" | "1" } | null = ergonomicSession.getResult();
// @ts-expect-error result type is preserved from transition returns
const invalidErgonomicResult: number = ergonomicSession.getResult();
const ergonomicPlayerID: GamePlayerID<typeof ergonomicGame> = "1";
const ergonomicPayloads: GameEventPayloads<typeof ergonomicGame> = {
  place: { row: 1 },
};
const standaloneTransitions = defineTransitions<
  ErgonomicState,
  { place: { row: number } },
  { winner: "0" | "1" },
  "done" | "idle",
  typeof match.players
>(({ transition }) => [
  transition("place", {
    from: "idle",
    to: "done",
  }),
]);

void ergonomicPublicView;
void ergonomicPlayerView;
void ergonomicResult;
void invalidErgonomicResult;
void ergonomicPlayerID;
void ergonomicPayloads;
void standaloneTransitions;

// @ts-expect-error authored values must be JSON-compatible
const invalidSerializable: Serializable<{ token: symbol }> = { token: Symbol("bad") };

void invalidSerializable;

export {};
