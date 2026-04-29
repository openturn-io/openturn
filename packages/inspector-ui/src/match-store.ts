import type {
  AnyGame,
  GameReplayData,
  GamePlayers,
  GamePlayerView,
  GameRuleContextOf,
  GameSuccessResult,
  MatchInput,
} from "@openturn/core";
import type { OpenturnMatchStore } from "@openturn/react";

type SessionSnapshot<TGame extends AnyGame> = ReturnType<OpenturnMatchStore<TGame>["getSnapshot"]>;
type SessionBatch<TGame extends AnyGame> = GameSuccessResult<TGame>["batch"];

export function createFrozenMatchStore<TGame extends AnyGame>(
  game: TGame,
  frozenSnapshot: SessionSnapshot<TGame>,
  frozenBatch: SessionBatch<TGame> | null,
  subscribeToUpdates?: (listener: () => void) => () => void,
): OpenturnMatchStore<TGame> {
  const playerViews = new Map<string, GamePlayerView<TGame>>();

  return {
    dispatch: createNoopDispatch(game),
    getLastBatch() {
      return frozenBatch;
    },
    getReplayData() {
      return {
        actions: frozenSnapshot.meta.log as GameReplayData<TGame, MatchInput<GamePlayers<TGame>>>["actions"],
        initialNow: frozenSnapshot.meta.now,
        match: frozenSnapshot.meta.match,
        seed: frozenSnapshot.meta.seed,
      };
    },
    getSnapshot() {
      return frozenSnapshot;
    },
    getPlayerView(playerID) {
      const cached = playerViews.get(playerID);

      if (cached !== undefined) {
        return cached;
      }

      const nextPlayerView = derivePlayerView(game, frozenSnapshot, playerID);
      playerViews.set(playerID, nextPlayerView);
      return nextPlayerView;
    },
    getStatus() {
      return "ready";
    },
    subscribe(listener) {
      return subscribeToUpdates?.(listener) ?? (() => {});
    },
  };
}

export function getReplayBatchByRevision<TGame extends AnyGame>(
  replayFrames: readonly {
    revision: number;
    step: SessionBatch<TGame>["steps"][number] | null;
  }[],
  revision: number,
): SessionBatch<TGame> | null {
  const index = replayFrames.findIndex((candidate) => candidate.revision === revision);
  if (index <= 0) {
    return null;
  }

  let startIndex = index;
  while (
    startIndex > 0
    && replayFrames[startIndex]!.step?.kind !== "action"
  ) {
    startIndex -= 1;
  }

  const startFrame = replayFrames[startIndex]!;
  if (startFrame.step?.kind !== "action") {
    return null;
  }

  let endIndex = startIndex;
  while (endIndex + 1 < replayFrames.length) {
    const nextFrame = replayFrames[endIndex + 1]!;
    if (nextFrame.step?.kind === "action") {
      break;
    }
    endIndex += 1;
  }

  const steps = replayFrames
    .slice(startIndex, endIndex + 1)
    .map((frame) => frame.step)
    .filter((step): step is NonNullable<typeof step> => step !== null);

  return {
    snapshot: steps[steps.length - 1]!.snapshot,
    steps,
  };
}

export function getReplayFrameByRevision<TFrame extends { revision: number }>(
  replayFrames: readonly TFrame[],
  revision: number,
): TFrame {
  return replayFrames.find((candidate) => candidate.revision === revision)
    ?? replayFrames[replayFrames.length - 1]!;
}

function derivePlayerView<TGame extends AnyGame>(
  game: TGame,
  snapshot: SessionSnapshot<TGame>,
  playerID: MatchInput["players"][number],
): GamePlayerView<TGame> {
  if (game.views?.player === undefined) {
    return structuredClone(snapshot.G) as GamePlayerView<TGame>;
  }

  const context = {
    G: structuredClone(snapshot.G),
    position: structuredClone(snapshot.position),
    derived: structuredClone(snapshot.derived),
    match: structuredClone(snapshot.meta.match),
    now: snapshot.meta.now,
  } as GameRuleContextOf<TGame>;

  return (game.views.player as (context: GameRuleContextOf<TGame>, playerID: string) => GamePlayerView<TGame>)(
    context,
    playerID,
  );
}

function createNoopDispatch<TGame extends AnyGame>(game: TGame): OpenturnMatchStore<TGame>["dispatch"] {
  return Object.fromEntries(
    Object.keys(game.events).map((eventName) => [
      eventName,
      () => ({
        ok: false,
        error: "replay_mode" as const,
      }),
    ]),
  ) as unknown as OpenturnMatchStore<TGame>["dispatch"];
}
