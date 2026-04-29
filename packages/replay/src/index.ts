import {
  createLocalSession,
  type AnyGame,
  type GameActionRecord,
  type GameActionRecordFor,
  type GameControlState,
  type GameNodes,
  type GamePlayers,
  type GamePlayerView,
  type GameReplayData,
  type GameResultState,
  type GameSnapshot,
  type GameStep,
  type LocalGameSession,
  type MatchInput,
  type PlayerID,
  type PlayerList,
  type ReplayValue,
} from "@openturn/core";
import {
  assertJsonValue,
  cloneJsonValue,
  parseJsonText,
  stringifyJson,
  type JsonValue,
} from "@openturn/json";

export interface ReplayFrame<TGame extends AnyGame> {
  action: GameActionRecordFor<TGame["events"], GamePlayers<TGame>[number]> | null;
  playerView: GamePlayerView<TGame> | null;
  revision: number;
  snapshot: GameSnapshot<
    ReturnType<TGame["setup"]>,
    GameResultState<TGame>,
    GameNodes<TGame>,
    MatchInput<GamePlayers<TGame>>,
    GameControlState<TGame>
  >;
  step: GameStep<TGame> | null;
}

export interface ReplayBranch {
  branchID: string;
  createdAtActionID: string | null;
  createdAtRevision: number;
  headActionID: string | null;
  parentBranchID: string | null;
}

export interface ReplayTimeline<TGame extends AnyGame> {
  actions: readonly GameActionRecord[];
  branches: readonly ReplayBranch[];
  frames: readonly ReplayFrame<TGame>[];
  initialNow: number;
  seed: string;
}

export type SavedReplayVersion = 1;
export type SavedReplayMetadata = Readonly<Record<string, ReplayValue>>;

export interface SavedReplayEnvelope<
  TPlayers extends PlayerList = PlayerList,
  TMatchData = ReplayValue,
> {
  actions: readonly GameActionRecord[];
  gameID: string;
  initialNow: number;
  match: MatchInput<TPlayers, TMatchData>;
  metadata?: SavedReplayMetadata;
  playerID?: TPlayers[number];
  seed: string;
  version: SavedReplayVersion;
}

export interface CreateSavedReplayEnvelopeOptions<
  TPlayers extends PlayerList = PlayerList,
  TMatchData = ReplayValue,
> {
  actions: readonly GameActionRecord[];
  gameID: string;
  initialNow?: number;
  match: MatchInput<TPlayers, TMatchData>;
  metadata?: SavedReplayMetadata;
  playerID?: TPlayers[number];
  seed?: string;
}

export interface CreateSavedReplayFromSessionOptions<
  TGame extends AnyGame,
  TMatch extends MatchInput<GamePlayers<TGame>> = MatchInput<GamePlayers<TGame>>,
> {
  gameID: string;
  metadata?: SavedReplayMetadata;
  playerID?: TMatch["players"][number];
  session: {
    getReplayData(): GameReplayData<TGame, TMatch>;
  };
}

export interface ReplayMaterializeOptions<TGame extends AnyGame> {
  actions: readonly GameActionRecord[];
  initialNow?: number;
  match: MatchInput<GamePlayers<TGame>>;
  playerID?: GamePlayers<TGame>[number];
  seed?: string;
}

export interface ReplayCursorState<TGame extends AnyGame> {
  branch: ReplayBranch;
  currentFrame: ReplayFrame<TGame>;
  isPlaying: boolean;
  speed: number;
}

export interface ReplayCursor<TGame extends AnyGame> {
  getState(): ReplayCursorState<TGame>;
  pause(): ReplayCursorState<TGame>;
  play(): ReplayCursorState<TGame>;
  redo(): ReplayCursorState<TGame>;
  seekAction(actionID: string | null): ReplayCursorState<TGame>;
  seekRevision(revision: number): ReplayCursorState<TGame>;
  seekTurn(turn: number): ReplayCursorState<TGame>;
  setBranch(branchID: string): ReplayCursorState<TGame>;
  setSpeed(speed: number): ReplayCursorState<TGame>;
  undo(): ReplayCursorState<TGame>;
}

const SAVED_REPLAY_VERSION = 1 satisfies SavedReplayVersion;

export function materializeReplay<TGame extends AnyGame>(
  game: TGame,
  options: ReplayMaterializeOptions<TGame>,
): ReplayTimeline<TGame> {
  const seed = options.seed ?? "default";
  const initialNow = options.initialNow ?? 0;
  const session = createLocalSession(game, {
    match: options.match,
    now: initialNow,
    seed,
  });
  const frames: ReplayFrame<TGame>[] = [
    {
      action: null,
      playerView: getPlayerViewOrNull(session, options.playerID),
      revision: 0,
      snapshot: session.getState(),
      step: null,
    },
  ];
  let revision = 0;

  for (const action of options.actions) {
    const payload = action.payload === null ? undefined : cloneJsonValue(action.payload);
    const applyEvent = session.applyEvent as (
      playerID: typeof action.playerID,
      event: typeof action.event,
      payload?: unknown,
    ) => ReturnType<typeof session.applyEvent>;
    const replayResult = payload === undefined
      ? applyEvent(action.playerID, action.event)
      : applyEvent(action.playerID, action.event, payload);

    if (!replayResult.ok) {
      throw new Error(`Failed to replay action ${action.event}: ${replayResult.error}`);
    }

    for (const step of replayResult.batch.steps) {
      revision += 1;
      frames.push({
        action: step.kind === "action"
          ? action as GameActionRecordFor<TGame["events"], GamePlayers<TGame>[number]>
          : null,
        playerView: getPlayerViewOrNull(session, options.playerID),
        revision,
        snapshot: step.snapshot,
        step,
      });
    }
  }

  return {
    actions: options.actions,
    branches: [
      {
        branchID: "main",
        createdAtActionID: null,
        createdAtRevision: 0,
        headActionID: options.actions.at(-1)?.actionID ?? null,
        parentBranchID: null,
      },
    ],
    frames,
    initialNow,
    seed,
  };
}

export function createSavedReplayEnvelope<
  TPlayers extends PlayerList,
  TMatchData = ReplayValue,
>(
  options: CreateSavedReplayEnvelopeOptions<TPlayers, TMatchData>,
): SavedReplayEnvelope<TPlayers, TMatchData> {
  assertNonEmptyString(options.gameID, "gameID");
  assertMatchInput(options.match, "match");
  assertActionRecords(options.actions, "actions");

  const initialNow = options.initialNow ?? 0;
  const seed = options.seed ?? "default";

  if (!Number.isFinite(initialNow)) {
    throw new Error("initialNow must be a finite number.");
  }

  if (options.playerID !== undefined && !options.match.players.includes(options.playerID)) {
    throw new Error(`playerID "${options.playerID}" is not part of the saved replay match.`);
  }

  if (options.metadata !== undefined) {
    assertJsonValue(options.metadata, "metadata");
  }

  return {
    actions: cloneJsonValue(options.actions),
    gameID: options.gameID,
    initialNow,
    match: cloneJsonValue(options.match),
    seed,
    version: SAVED_REPLAY_VERSION,
    ...(options.metadata === undefined ? {} : { metadata: cloneJsonValue(options.metadata) }),
    ...(options.playerID === undefined ? {} : { playerID: options.playerID }),
  };
}

export function createSavedReplayFromSession<
  TGame extends AnyGame,
  TMatch extends MatchInput<GamePlayers<TGame>>,
>(
  options: CreateSavedReplayFromSessionOptions<TGame, TMatch>,
): SavedReplayEnvelope<TMatch["players"], TMatch["data"]> {
  const replayData = options.session.getReplayData();

  return createSavedReplayEnvelope({
    actions: replayData.actions,
    gameID: options.gameID,
    initialNow: replayData.initialNow,
    match: replayData.match,
    seed: replayData.seed,
    ...(options.metadata === undefined ? {} : { metadata: options.metadata }),
    ...(options.playerID === undefined ? {} : { playerID: options.playerID }),
  });
}

export function materializeSavedReplay<TGame extends AnyGame>(
  game: TGame,
  envelope: SavedReplayEnvelope<GamePlayers<TGame>>,
): ReplayTimeline<TGame> {
  return materializeReplay(game, {
    actions: envelope.actions,
    initialNow: envelope.initialNow,
    match: envelope.match,
    playerID: envelope.playerID,
    seed: envelope.seed,
  });
}

export function serializeSavedReplay<
  TPlayers extends PlayerList,
  TMatchData = ReplayValue,
>(
  envelope: SavedReplayEnvelope<TPlayers, TMatchData>,
): string {
  return stringifyJson(createSavedReplayEnvelope(envelope));
}

export function parseSavedReplay(
  text: string,
): SavedReplayEnvelope {
  const value = parseJsonText(text, "saved replay");
  return parseSavedReplayValue(value);
}

export function parseSavedReplayValue(
  value: JsonValue,
): SavedReplayEnvelope {
  const object = asObject(value, "saved replay");
  const version = object.version;

  if (version !== SAVED_REPLAY_VERSION) {
    throw new Error(`Unsupported saved replay version: ${String(version)}`);
  }

  const gameID = asNonEmptyString(object.gameID, "saved replay.gameID");
  const initialNow = asFiniteNumber(object.initialNow, "saved replay.initialNow");
  const seed = asNonEmptyString(object.seed, "saved replay.seed");
  const match = parseMatchInput(object.match, "saved replay.match");
  const actions = parseActionRecords(object.actions, "saved replay.actions");
  const playerID = object.playerID === undefined
    ? undefined
    : asNonEmptyString(object.playerID, "saved replay.playerID");
  const metadata = object.metadata === undefined
    ? undefined
    : asReplayValueRecord(object.metadata, "saved replay.metadata");

  if (playerID !== undefined && !match.players.includes(playerID)) {
    throw new Error(`saved replay.playerID "${playerID}" is not part of saved replay.match.players`);
  }

  return {
    actions,
    gameID,
    initialNow,
    match,
    seed,
    version: SAVED_REPLAY_VERSION,
    ...(metadata === undefined ? {} : { metadata }),
    ...(playerID === undefined ? {} : { playerID }),
  };
}

export function addReplayBranch<TGame extends AnyGame>(
  timeline: ReplayTimeline<TGame>,
  actionID: string | null,
  branchID: string,
  parentBranchID = "main",
): ReplayTimeline<TGame> {
  if (timeline.branches.some((branch) => branch.branchID === branchID)) {
    throw new Error(`Replay branch "${branchID}" already exists.`);
  }

  const frame = findFrameByActionID(timeline.frames, actionID);

  return {
    ...timeline,
    branches: [
      ...timeline.branches,
      {
        branchID,
        createdAtActionID: actionID,
        createdAtRevision: frame.revision,
        headActionID: actionID,
        parentBranchID,
      },
    ],
  };
}

export function createReplayCursor<TGame extends AnyGame>(
  timeline: ReplayTimeline<TGame>,
): ReplayCursor<TGame> {
  let branch = timeline.branches[0]!;
  let index = 0;
  let isPlaying = false;
  let speed = 1;

  return {
    getState() {
      return {
        branch,
        currentFrame: timeline.frames[index]!,
        isPlaying,
        speed,
      };
    },
    pause() {
      isPlaying = false;
      return this.getState();
    },
    play() {
      isPlaying = true;
      return this.getState();
    },
    redo() {
      index = Math.min(getBranchMaxIndex(timeline, branch), index + 1);
      return this.getState();
    },
    seekAction(actionID) {
      const nextIndex = timeline.frames.findIndex((frame) => frame.action?.actionID === actionID);
      index = nextIndex < 0 ? 0 : Math.min(nextIndex, getBranchMaxIndex(timeline, branch));
      return this.getState();
    },
    seekRevision(revision) {
      const nextIndex = timeline.frames.findIndex((frame) => frame.revision === revision);
      index = nextIndex < 0 ? index : Math.min(nextIndex, getBranchMaxIndex(timeline, branch));
      return this.getState();
    },
    seekTurn(turn) {
      const nextIndex = timeline.frames.findIndex((frame) => frame.snapshot.position.turn === turn);
      index = nextIndex < 0 ? index : Math.min(nextIndex, getBranchMaxIndex(timeline, branch));
      return this.getState();
    },
    setBranch(branchID) {
      const nextBranch = timeline.branches.find((candidate) => candidate.branchID === branchID);

      if (nextBranch === undefined) {
        throw new Error(`Unknown replay branch "${branchID}".`);
      }

      branch = nextBranch;
      index = Math.min(index, getBranchMaxIndex(timeline, branch));
      return this.getState();
    },
    setSpeed(nextSpeed) {
      if (!Number.isFinite(nextSpeed) || nextSpeed <= 0) {
        throw new Error("Replay speed must be a positive finite number.");
      }

      speed = nextSpeed;
      return this.getState();
    },
    undo() {
      index = Math.max(0, index - 1);
      return this.getState();
    },
  };
}

function findFrameByActionID<TGame extends AnyGame>(
  frames: readonly ReplayFrame<TGame>[],
  actionID: string | null,
): ReplayFrame<TGame> {
  if (actionID === null) {
    return frames[0]!;
  }

  const frame = frames.find((candidate) => candidate.action?.actionID === actionID);

  if (frame === undefined) {
    throw new Error(`Unknown replay action "${actionID}".`);
  }

  return frame;
}

function getBranchMaxIndex<TGame extends AnyGame>(
  timeline: ReplayTimeline<TGame>,
  branch: ReplayBranch,
): number {
  if (branch.headActionID === null) {
    return 0;
  }

  for (let index = timeline.frames.length - 1; index >= 0; index -= 1) {
    const frame = timeline.frames[index]!;

    if (frame.action?.actionID === branch.headActionID || frame.step?.event.actionID === branch.headActionID) {
      return index;
    }
  }

  return 0;
}

function getPlayerViewOrNull<TGame extends AnyGame>(
  session: LocalGameSession<TGame, MatchInput<GamePlayers<TGame>>>,
  playerID: GamePlayers<TGame>[number] | undefined,
): GamePlayerView<TGame> | null {
  if (playerID === undefined) {
    return null;
  }

  return session.getPlayerView(playerID);
}

function parseMatchInput(
  value: JsonValue | undefined,
  label: string,
): MatchInput<PlayerList> {
  const object = asObject(value, label);
  const players = asStringArray(object.players, `${label}.players`);

  if (players.length === 0) {
    throw new Error(`${label}.players must contain at least one player.`);
  }

  const match: MatchInput<PlayerList> = {
    players: players as PlayerList,
  };

  if (object.data !== undefined) {
    match.data = cloneJsonValue(object.data);
  }

  return match;
}

function parseActionRecords(
  value: JsonValue | undefined,
  label: string,
): readonly GameActionRecord[] {
  const list = asArray(value, label);
  return list.map((entry, index) => parseActionRecord(entry, `${label}[${index}]`));
}

function parseActionRecord(
  value: JsonValue,
  label: string,
): GameActionRecord {
  const object = asObject(value, label);
  const type = asNonEmptyString(object.type, `${label}.type`);

  if (type !== "event") {
    throw new Error(`${label}.type must be "event".`);
  }

  return {
    actionID: asNonEmptyString(object.actionID, `${label}.actionID`),
    at: asFiniteNumber(object.at, `${label}.at`),
    event: asNonEmptyString(object.event, `${label}.event`),
    payload: object.payload === undefined ? null : cloneJsonValue(object.payload),
    playerID: asNonEmptyString(object.playerID, `${label}.playerID`),
    turn: asFiniteNumber(object.turn, `${label}.turn`),
    type: "event",
  };
}

function assertMatchInput(value: unknown, label: string): asserts value is MatchInput<PlayerList> {
  assertJsonValue(value, label);
  parseMatchInput(value, label);
}

function assertActionRecords(value: unknown, label: string): asserts value is readonly GameActionRecord[] {
  assertJsonValue(value, label);
  parseActionRecords(value, label);
}

function assertNonEmptyString(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
}

function asReplayValueRecord(
  value: JsonValue,
  label: string,
): SavedReplayMetadata {
  const object = asObject(value, label);
  return cloneJsonValue(object) as SavedReplayMetadata;
}

function asObject(
  value: JsonValue | undefined,
  label: string,
): Record<string, JsonValue> {
  if (value === undefined || value === null || Array.isArray(value) || typeof value !== "object") {
    throw new Error(`${label} must be a plain object.`);
  }

  return value as Record<string, JsonValue>;
}

function asArray(
  value: JsonValue | undefined,
  label: string,
): readonly JsonValue[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array.`);
  }

  return value;
}

function asStringArray(
  value: JsonValue | undefined,
  label: string,
): readonly string[] {
  const list = asArray(value, label);
  return list.map((entry, index) => asNonEmptyString(entry, `${label}[${index}]`));
}

function asNonEmptyString(
  value: JsonValue | undefined,
  label: string,
): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }

  return value;
}

function asFiniteNumber(
  value: JsonValue | undefined,
  label: string,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number.`);
  }

  return value;
}
