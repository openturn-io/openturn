import {
  computeProfileCommit,
  createLocalSession,
  profile,
  type AnyGame,
  type GameErrorCode,
  type GameErrorResult,
  type GamePlayerView,
  type GamePlayers,
  type GameProfileConfig,
  type GamePublicView,
  type GameResultState,
  type GameRuleContextOf,
  type GameSnapshotOf,
  type GameStateOf,
  type GameStep,
  type LocalGameSession,
  type MatchInput,
  type PlayerID,
  type ProfileCommitDeltaMap,
  type ReplayValue,
} from "@openturn/core";
import {
  MatchSnapshotSchema,
  ProtocolActionRecordSchema,
  ProtocolHistoryBranchSchema,
  protocolizeGameSnapshot,
  protocolizeGameStep,
  protocolizeValue,
  type ActionRejected,
  type BatchApplied,
  type ClientAction,
  type MatchID,
  type MatchSnapshot,
  type PlayerViewSnapshot,
  type ProtocolActionRecord,
  type ProtocolClientMessage,
  type ProtocolErrorCode,
  type ProtocolErrorDetail,
  type ProtocolHistoryBranch,
  type ProtocolValue,
  type ResyncRequest,
  type Revision,
  type SaveError,
  type SaveReady,
  type SaveRequest,
  type SyncRequest,
} from "@openturn/protocol";
import { JsonValueSchema } from "@openturn/json";
import { z } from "zod";

export type RoomTokenScope = "lobby" | "game";

export interface RoomTokenClaims {
  deploymentVersion: string;
  exp: number;
  iat: number;
  playerID: PlayerID | null;
  roomID: MatchID;
  scope: RoomTokenScope;
  userID: string;
}

export interface SignedRoomToken {
  claims: RoomTokenClaims;
  token: string;
}

export interface GameDeployment<
  TGame extends AnyGame = AnyGame,
> {
  deploymentVersion: string;
  game: TGame;
  gameKey: string;
  /**
   * Per-deployment default match input. Optional; when omitted,
   * `createRoomRuntime` derives `{ players: game.playerIDs }` from the game's
   * declared player pool. Provide this only when the deployment must override
   * the seated subset (e.g. a saved-game restore that reduces capacity).
   */
  match?: MatchInput<GamePlayers<TGame>>;
  metadata?: ProtocolValue;
  schemaVersion: string;
}

// `ProtocolCompatibleGame<TGame>` is a transparent passthrough on the type
// level — it must keep extending `AnyGame` so downstream consumers
// (`GameDeployment<ProtocolCompatibleGame<TGame>>`, `RoomRuntime<…>`, etc.)
// continue typechecking. The actual incompatibility is reported by intersecting
// `ProtocolCompatibilityError<TGame>` with the user-facing function parameters
// (see `defineGameDeployment` and `createRoomRuntime`), so a non-serializable
// game produces a readable "openturnError: …" diagnostic at the call site.
type ProtocolCompatibleGame<TGame extends AnyGame> = TGame;

// Note on scope: `state`/`public view`/`player view` are checked because they
// flow over the wire on every snapshot; `result` is omitted because gamekit's
// canonical `GamekitResultState` has `Record<string, JsonValue | undefined>`,
// which is structurally narrower than `ProtocolValue` but runtime-equivalent
// (JSON.stringify drops undefined property values during transit). Mirroring
// gamekit's own 3-slot `JsonCompatibilityChecks` keeps the brand from
// false-positiving on every gamekit-built game.
type ProtocolCompatibilityError<TGame extends AnyGame> =
  GameStateOf<TGame> extends ProtocolValue
    ? GamePublicView<TGame> extends ProtocolValue
      ? GamePlayerView<TGame> extends ProtocolValue
        ? {}
        : { openturnError: "'player view' is not protocol-compatible — `views.player(...)` returns a value containing a function, class, symbol, or undefined property" }
      : { openturnError: "'public view' is not protocol-compatible — `views.public(...)` returns a value containing a function, class, symbol, or undefined property" }
    : { openturnError: "'state' is not protocol-compatible — `setup(...)` returns a value containing a function, class, symbol, or undefined property" };

type CanonicalSnapshot<TGame extends AnyGame> = MatchSnapshot<GamePublicView<TGame>, GameResultState<TGame>>;
type PlayerSnapshot<TGame extends AnyGame> = PlayerViewSnapshot<GamePlayerView<TGame>, GameResultState<TGame>>;
type PlayerBatchMessage<TGame extends AnyGame> = BatchApplied<GamePlayerView<TGame>, GameResultState<TGame>>;
type RoomServerMessage<TGame extends AnyGame> =
  | ActionRejected
  | PlayerBatchMessage<TGame>
  | PlayerSnapshot<TGame>
  | SaveReady
  | SaveError;

export interface RoomPersistenceRecord<
  TGame extends AnyGame = AnyGame,
> {
  branch: ProtocolHistoryBranch;
  checkpoint: CanonicalSnapshot<TGame>;
  deploymentVersion: string;
  initialNow: number;
  log: readonly ProtocolActionRecord[];
  match: MatchInput<GamePlayers<TGame>>;
  roomID: MatchID;
  seed: string;
}

export interface RoomPersistence {
  load(roomID: MatchID): Promise<RoomPersistenceRecord | null>;
  save(record: RoomPersistenceRecord): Promise<void>;
}

export interface RoomRuntimeEnvelope<
  TGame extends AnyGame = AnyGame,
> {
  message: RoomServerMessage<TGame>;
  playerID: PlayerID;
}

export interface RoomRuntimeState<
  TGame extends AnyGame = AnyGame,
> {
  branch: ProtocolHistoryBranch;
  connectedPlayers: readonly PlayerID[];
  revision: Revision;
  roomID: MatchID;
  snapshot: CanonicalSnapshot<TGame>;
}

export interface RoomRuntime<
  TGame extends AnyGame = AnyGame,
> {
  connect(playerID: PlayerID): Promise<readonly RoomRuntimeEnvelope<TGame>[]>;
  disconnect(playerID: PlayerID): void;
  getState(): RoomRuntimeState<TGame>;
  /**
   * Underlying authoritative `LocalGameSession`. Internal API for in-DO
   * subsystems (e.g. the bot driver) that need full server-side snapshot +
   * player views, which the wire-shaped `getState()` doesn't expose.
   * Bots dispatch their decisions via `handleClientMessage`, NOT this
   * session directly — the runtime owns persistence + broadcast semantics.
   */
  getSession(): import("@openturn/core").LocalGameSession<
    TGame,
    import("@openturn/core").MatchInput<import("@openturn/core").GamePlayers<TGame>>
  >;
  handleClientMessage(
    message: ProtocolClientMessage,
  ): Promise<readonly RoomRuntimeEnvelope<TGame>[]>;
}

export {
  decodeSave,
  deriveSaveKey,
  encodeSave,
  SAVE_FORMAT_VERSION,
  SaveDecodeError,
  type EncodeSaveOptions,
  type SaveDecodeErrorCode,
  type SavedGameCheckpoint,
  type SavedGameMeta,
  type SavedGamePayload,
} from "./save";

export interface InitialSavedSnapshot<TGame extends AnyGame> {
  branch?: ProtocolHistoryBranch;
  initialNow: number;
  match: MatchInput<GamePlayers<TGame>>;
  revision: number;
  seed: string;
  snapshot: GameSnapshotOf<TGame>;
}

export interface RoomSaveHandlerInput<TGame extends AnyGame> {
  branch: ProtocolHistoryBranch;
  clientRequestID: string;
  initialNow: number;
  match: MatchInput<GamePlayers<TGame>>;
  matchID: MatchID;
  playerID: PlayerID;
  revision: Revision;
  seed: string;
  snapshot: GameSnapshotOf<TGame>;
}

export interface RoomSaveHandlerOutput {
  downloadURL?: string;
  saveID: string;
}

export type RoomSaveHandler<TGame extends AnyGame> = (
  input: RoomSaveHandlerInput<TGame>,
) => Promise<RoomSaveHandlerOutput>;

export interface RoomSettleHandlerInput<TGame extends AnyGame> {
  /** Per-player delta map produced by `game.profile.commit`. Already filtered to seated players. */
  delta: ProfileCommitDeltaMap<GamePlayers<TGame>>;
  deploymentVersion: string;
  gameKey: string;
  match: MatchInput<GamePlayers<TGame>>;
  /** Profiles as they were hydrated into the match at setup (pre-commit). */
  profilesAtSetup: Readonly<Record<PlayerID, ReplayValue>>;
  result: GameResultState<TGame>;
  revision: Revision;
  roomID: MatchID;
}

export type RoomSettleHandler<TGame extends AnyGame> = (
  input: RoomSettleHandlerInput<TGame>,
) => Promise<void>;

export interface RoomActionProfileCommitInput<TGame extends AnyGame> {
  /** Opaque action ID (maps 1:1 to the move that produced the delta). Use with `roomID` as the dedupe key. */
  actionID: string;
  /** Per-player delta map emitted by a single transition. Already filtered to seated players. */
  delta: ProfileCommitDeltaMap<GamePlayers<TGame>>;
  deploymentVersion: string;
  gameKey: string;
  match: MatchInput<GamePlayers<TGame>>;
  revision: Revision;
  roomID: MatchID;
}

/**
 * Invoked once per in-match transition that emitted a `profile` delta (e.g.
 * Balatro-style unlocks). Host is responsible for persisting the delta
 * idempotently using `(roomID, actionID)` as the dedupe key. Failures do not
 * block gameplay; the client's view has already been updated from the
 * authoritative local session.
 */
export type RoomActionProfileCommitHandler<TGame extends AnyGame> = (
  input: RoomActionProfileCommitInput<TGame>,
) => Promise<void>;

export interface RoomRuntimeOptions<
  TGame extends AnyGame,
> {
  connectedPlayers?: readonly PlayerID[];
  deployment: GameDeployment<TGame>;
  initialNow?: number;
  initialSavedSnapshot?: InitialSavedSnapshot<TGame>;
  /** Invoked per action whose transition emitted a `profile` delta (mid-match writes). */
  onActionProfileCommit?: RoomActionProfileCommitHandler<TGame>;
  onSaveRequest?: RoomSaveHandler<TGame>;
  /**
   * Invoked once when the match transitions to a terminal `result`.
   * Receives the pure `profile.commit` delta map. Host is responsible for
   * persisting the delta (e.g. POST to openturn-cloud `/api/profiles/commit`).
   */
  onSettle?: RoomSettleHandler<TGame>;
  persistence?: RoomPersistence;
  restorePersistedState?: boolean;
  roomID: MatchID;
  seed?: string;
}

export function defineGameDeployment<TGame extends AnyGame>(
  deployment: GameDeployment<ProtocolCompatibleGame<TGame>> & ProtocolCompatibilityError<TGame>,
): GameDeployment<ProtocolCompatibleGame<TGame>> {
  return deployment;
}

export function loadGameDeployment(moduleValue: unknown): GameDeployment {
  if (isGameDeployment(moduleValue)) {
    return moduleValue;
  }

  if (typeof moduleValue === "object" && moduleValue !== null) {
    if ("default" in moduleValue && isGameDeployment((moduleValue as { default: unknown }).default)) {
      return (moduleValue as { default: GameDeployment }).default;
    }

    if ("deployment" in moduleValue && isGameDeployment((moduleValue as { deployment: unknown }).deployment)) {
      return (moduleValue as { deployment: GameDeployment }).deployment;
    }
  }

  throw new Error("Expected a Openturn deployment manifest export.");
}

export async function signRoomToken(
  claims: RoomTokenClaims,
  secret: string,
): Promise<SignedRoomToken> {
  const payload = encodeBase64Url(JSON.stringify(claims));
  const signature = await signValue(payload, secret);

  return {
    claims,
    token: `${payload}.${signature}`,
  };
}

export async function verifyRoomToken(token: string, secret: string): Promise<RoomTokenClaims | null> {
  const [payload, signature] = token.split(".");

  if (payload === undefined || signature === undefined) {
    return null;
  }

  const expectedSignature = await signValue(payload, secret);

  if (signature !== expectedSignature) {
    return null;
  }

  let claims: RoomTokenClaims;
  try {
    claims = parseRoomTokenClaims(JSON.parse(decodeBase64Url(payload)));
  } catch {
    return null;
  }

  if (claims.exp <= Math.floor(Date.now() / 1_000)) {
    return null;
  }

  return claims;
}

export async function createRoomRuntime<
  TGame extends AnyGame,
>(
  options: RoomRuntimeOptions<ProtocolCompatibleGame<TGame>> & ProtocolCompatibilityError<TGame>,
): Promise<
  RoomRuntime<ProtocolCompatibleGame<TGame>>
> {
  const seed = options.seed ?? `${options.roomID}:seed`;
  const initialNow = options.initialNow ?? 0;
  const connectedPlayers = new Set<PlayerID>(options.connectedPlayers ?? []);
  const saved = options.initialSavedSnapshot;
  const persistedRecord = saved === undefined && options.restorePersistedState !== false
    ? await options.persistence?.load(options.roomID)
    : null;
  const deploymentMatch = options.deployment.match ?? {
    players: options.deployment.game.playerIDs as GamePlayers<ProtocolCompatibleGame<TGame>>,
  };
  const match = (saved?.match ?? persistedRecord?.match ?? deploymentMatch) as MatchInput<
    GamePlayers<ProtocolCompatibleGame<TGame>>
  >;
  const sessionInitialNow = saved?.initialNow ?? persistedRecord?.initialNow ?? initialNow;
  const sessionSeed = saved?.seed ?? persistedRecord?.seed ?? seed;

  const session: LocalGameSession<ProtocolCompatibleGame<TGame>, typeof match> = createLocalSession(
    options.deployment.game,
    {
      match,
      now: sessionInitialNow,
      seed: sessionSeed,
    },
  );

  if (saved !== undefined) {
    const savedLog = (saved.snapshot as { log?: readonly ProtocolActionRecord[] }).log
      ?? (saved.snapshot as { meta?: { log?: readonly ProtocolActionRecord[] } }).meta?.log
      ?? [];
    replayIntoSession(session, savedLog);
  }

  let revision = 0;
  let branch: ProtocolHistoryBranch = saved?.branch ?? persistedRecord?.branch ?? {
    branchID: "main",
    createdAtActionID: null,
    createdAtRevision: 0,
    headActionID: null,
    parentBranchID: null,
  };

  if (saved !== undefined) {
    revision = saved.revision;
  } else if (persistedRecord !== null && persistedRecord !== undefined) {
    replayIntoSession(session, persistedRecord.log);
    revision = persistedRecord.checkpoint.revision;
  }

  /**
   * Profiles as they were observed by `setup`. Captured once from the session
   * (which hydrates defaults + runs parse) so a later save-restore or
   * crash-recovery produces the same delta — `profile.commit` is pure in these inputs.
   */
  const hydratedMatch = session.getState().meta.match as MatchInput<GamePlayers<ProtocolCompatibleGame<TGame>>>;
  const profilesAtSetup: Readonly<Record<PlayerID, ReplayValue>> = Object.freeze({
    ...((hydratedMatch.profiles ?? {}) as Record<PlayerID, ReplayValue>),
  });
  /** Guard so onSettle fires exactly once per room lifetime. */
  let settled = session.getResult() !== null;

  async function emitActionProfileCommits(
    steps: readonly GameStep<ProtocolCompatibleGame<TGame>>[],
  ): Promise<void> {
    if (options.onActionProfileCommit === undefined) return;
    for (const step of steps) {
      const profile = (step.transition as { profile?: ProfileCommitDeltaMap<GamePlayers<ProtocolCompatibleGame<TGame>>> }).profile;
      if (profile === undefined) continue;
      try {
        await options.onActionProfileCommit({
          actionID: step.event.actionID,
          delta: profile,
          deploymentVersion: options.deployment.deploymentVersion,
          gameKey: options.deployment.gameKey,
          match: hydratedMatch,
          revision,
          roomID: options.roomID,
        });
      } catch {
        // Per-action commits are best-effort from the room's POV; the host is
        // expected to be idempotent on (roomID, actionID) so a retry elsewhere
        // can reconcile. Failures here don't block gameplay.
      }
    }
  }

  async function maybeSettle(): Promise<void> {
    if (settled) return;
    const result = session.getResult();
    if (result === null) return;
    settled = true;
    if (options.onSettle === undefined) return;
    const profileConfig = (options.deployment.game as { profile?: unknown }).profile as
      | GameProfileConfig<ReplayValue, GamePlayers<ProtocolCompatibleGame<TGame>>, GameResultState<ProtocolCompatibleGame<TGame>>>
      | undefined;
    const delta = computeProfileCommit(profileConfig, {
      match: hydratedMatch,
      profile: profile.bind(
        profilesAtSetup as Readonly<Record<PlayerID, ReplayValue>> as never,
      ),
      profiles: profilesAtSetup as Readonly<Record<PlayerID, ReplayValue>> as never,
      result: result as GameResultState<ProtocolCompatibleGame<TGame>>,
    }) as ProfileCommitDeltaMap<GamePlayers<ProtocolCompatibleGame<TGame>>>;
    try {
      await options.onSettle({
        delta,
        deploymentVersion: options.deployment.deploymentVersion,
        gameKey: options.deployment.gameKey,
        match: hydratedMatch,
        profilesAtSetup,
        result: result as GameResultState<ProtocolCompatibleGame<TGame>>,
        revision,
        roomID: options.roomID,
      });
    } catch {
      // Settle is idempotent at the cloud boundary via (roomId,userId);
      // failures here don't block gameplay. Host-side logging is the host's job.
      settled = false;
    }
  }

  const persist = async () => {
    if (options.persistence === undefined) {
      return;
    }

    const snapshot = createCanonicalSnapshot(options.roomID, revision, session);

    await options.persistence.save({
      branch,
      checkpoint: snapshot,
      deploymentVersion: options.deployment.deploymentVersion,
      initialNow: persistedRecord?.initialNow ?? initialNow,
      log: snapshot.log,
      match: persistedRecord?.match ?? deploymentMatch,
      roomID: options.roomID,
      seed: persistedRecord?.seed ?? seed,
    });
  };

  return {
    async connect(playerID) {
      connectedPlayers.add(playerID);
      return [
        {
          message: createPlayerSnapshot(options.roomID, revision, session, options.deployment.game, playerID),
          playerID,
        },
      ];
    },
    disconnect(playerID) {
      connectedPlayers.delete(playerID);
    },
    getState() {
      return {
        branch,
        connectedPlayers: [...connectedPlayers],
        revision,
        roomID: options.roomID,
        snapshot: createCanonicalSnapshot(options.roomID, revision, session),
      };
    },
    getSession() {
      return session as never;
    },
    async handleClientMessage(message) {
      switch (message.type) {
        case "action":
          return handleAction(message);
        case "resync":
          return handleResync(message);
        case "sync":
          return handleSync(message);
        case "save-request":
          return handleSaveRequest(message);
      }
    },
  };

  async function handleAction(
    message: ClientAction,
  ): Promise<readonly RoomRuntimeEnvelope<ProtocolCompatibleGame<TGame>>[]> {
    if (message.baseRevision !== undefined && message.baseRevision !== revision) {
      return [reject(message, "stale_revision")];
    }

    const result = session.applyEvent(
      message.playerID as GamePlayers<ProtocolCompatibleGame<TGame>>[number],
      message.event as never,
      (message.payload === null ? undefined : structuredClone(message.payload)) as never,
    );

    if (!result.ok) {
      return [reject(message, result)];
    }

    revision += result.batch.steps.length;
    branch = {
      ...branch,
      headActionID: result.batch.steps[0]?.event.actionID ?? branch.headActionID,
    };
    await persist();
    await emitActionProfileCommits(result.batch.steps);
    await maybeSettle();

    const recipients = connectedPlayers.size === 0
      ? [message.playerID]
      : [...connectedPlayers];

    return recipients.map((playerID) => ({
      message: {
        type: "batch_applied",
        matchID: options.roomID,
        revision,
        ...(playerID === message.playerID ? { ackClientActionID: message.clientActionID } : {}),
        branch,
        snapshot: createPlayerSnapshot(options.roomID, revision, session, options.deployment.game, playerID),
        steps: createPlayerBatchSteps(
          options.roomID,
          revision,
          result.batch.steps,
          options.deployment.game,
          playerID,
        ),
      } satisfies PlayerBatchMessage<ProtocolCompatibleGame<TGame>>,
      playerID,
    }));
  }

  async function handleResync(
    message: ResyncRequest,
  ): Promise<readonly RoomRuntimeEnvelope<ProtocolCompatibleGame<TGame>>[]> {
    return [
      {
        message: createPlayerSnapshot(options.roomID, revision, session, options.deployment.game, message.playerID),
        playerID: message.playerID,
      },
    ];
  }

  async function handleSync(
    message: SyncRequest,
  ): Promise<readonly RoomRuntimeEnvelope<ProtocolCompatibleGame<TGame>>[]> {
    return [
      {
        message: createPlayerSnapshot(options.roomID, revision, session, options.deployment.game, message.playerID),
        playerID: message.playerID,
      },
    ];
  }

  async function handleSaveRequest(
    message: SaveRequest,
  ): Promise<readonly RoomRuntimeEnvelope<ProtocolCompatibleGame<TGame>>[]> {
    if (options.onSaveRequest === undefined) {
      return [
        {
          message: {
            type: "save-error",
            matchID: options.roomID,
            clientRequestID: message.clientRequestID,
            reason: "save_not_supported",
          } satisfies SaveError,
          playerID: message.playerID,
        },
      ];
    }

    if (!connectedPlayers.has(message.playerID)) {
      return [
        {
          message: {
            type: "save-error",
            matchID: options.roomID,
            clientRequestID: message.clientRequestID,
            reason: "not_connected",
          } satisfies SaveError,
          playerID: message.playerID,
        },
      ];
    }

    try {
      const result = await options.onSaveRequest({
        branch,
        clientRequestID: message.clientRequestID,
        initialNow: sessionInitialNow,
        match,
        matchID: options.roomID,
        playerID: message.playerID,
        revision,
        seed: sessionSeed,
        snapshot: session.getState() as GameSnapshotOf<ProtocolCompatibleGame<TGame>>,
      });
      const ready: SaveReady = {
        type: "save-ready",
        matchID: options.roomID,
        clientRequestID: message.clientRequestID,
        saveID: result.saveID,
      };
      if (result.downloadURL !== undefined) {
        ready.downloadURL = result.downloadURL;
      }
      return [{ message: ready, playerID: message.playerID }];
    } catch (error) {
      return [
        {
          message: {
            type: "save-error",
            matchID: options.roomID,
            clientRequestID: message.clientRequestID,
            reason: (error as Error).message ?? "save_failed",
          } satisfies SaveError,
          playerID: message.playerID,
        },
      ];
    }
  }

  function reject(
    message: ClientAction,
    error: ProtocolErrorCode | GameErrorResult,
  ): RoomRuntimeEnvelope<ProtocolCompatibleGame<TGame>> {
    const rejection = typeof error === "string"
      ? { error }
      : {
          error: mapGameError(error.error),
          ...(error.details === undefined ? {} : { details: protocolizeValue(error.details) }),
          ...(error.reason === undefined ? {} : { reason: error.reason }),
        };

    return {
      message: {
        type: "action_rejected",
        clientActionID: message.clientActionID,
        ...rejection,
        event: message.event,
        matchID: options.roomID,
        revision,
      } satisfies ActionRejected,
      playerID: message.playerID,
    };
  }
}

function createCanonicalSnapshot<TGame extends AnyGame>(
  roomID: MatchID,
  revision: Revision,
  session: LocalGameSession<TGame>,
): CanonicalSnapshot<TGame> {
  const canonical = protocolizeGameSnapshot(session.getState(), {
    matchID: roomID,
    revision,
  });

  return {
    ...canonical,
    G: protocolizeValue(session.getPublicView()),
  };
}

function createPlayerSnapshot<TGame extends AnyGame>(
  roomID: MatchID,
  revision: Revision,
  session: LocalGameSession<TGame>,
  game: TGame,
  playerID: PlayerID,
): PlayerSnapshot<TGame> {
  const snapshot = session.getState();
  const playerView = derivePlayerView(game, snapshot as GameSnapshotOf<TGame>, playerID);
  const canonical = protocolizeGameSnapshot(snapshot, {
    matchID: roomID,
    revision,
  });

  return {
    ...canonical,
    G: protocolizeValue(playerView),
    playerID,
  };
}

function createPlayerBatchSteps<TGame extends AnyGame>(
  roomID: MatchID,
  revision: Revision,
  steps: readonly GameStep<TGame>[],
  game: TGame,
  playerID: PlayerID,
) {
  const baseRevision = revision - steps.length;

  return steps.map((step, index) => {
    const playerView = derivePlayerView(game, step.snapshot as GameSnapshotOf<TGame>, playerID);
    const snapshotRevision = baseRevision + index + 1;
    const canonical = protocolizeGameSnapshot(step.snapshot, {
      matchID: roomID,
      revision: snapshotRevision,
    });

    return protocolizeGameStep(step, {
      ...canonical,
      G: protocolizeValue(playerView),
      playerID,
    });
  });
}

function derivePlayerView<TGame extends AnyGame>(
  game: TGame,
  snapshot: GameSnapshotOf<TGame>,
  playerID: PlayerID,
): GamePlayerView<TGame> {
  if (game.views?.player === undefined) {
    return structuredClone(snapshot.G);
  }

  const context = {
    G: structuredClone(snapshot.G),
    position: structuredClone(snapshot.position),
    derived: structuredClone(snapshot.derived),
    match: structuredClone(snapshot.meta.match),
    now: snapshot.meta.now,
  } as GameRuleContextOf<TGame>;

  return game.views.player(context, playerID as GamePlayers<TGame>[number]);
}

function mapGameError(error: GameErrorCode): ProtocolErrorCode {
  switch (error) {
    case "ambiguous_transition":
    case "game_over":
    case "inactive_player":
    case "invalid_event":
    case "invalid_transition_result":
    case "non_serializable_args":
    case "unknown_event":
    case "unknown_player":
      return error;
    default:
      return "invalid_event";
  }
}

function isGameDeployment(value: unknown): value is GameDeployment {
  try {
    void parseGameDeploymentShape(value);
    return true;
  } catch {
    return false;
  }
}

function replayIntoSession<TGame extends AnyGame>(
  session: LocalGameSession<TGame>,
  actions: readonly ProtocolActionRecord[],
) {
  for (const action of actions) {
    const moveResult = session.applyEvent(
      action.playerID,
      action.event as never,
      (action.payload === null ? undefined : structuredClone(action.payload)) as never,
    );

    if (!moveResult.ok) {
      throw new Error(`Failed to replay action ${action.event}: ${moveResult.error}`);
    }
  }
}

/**
 * HMAC-SHA256 a value with the given shared secret, returning a base64url digest.
 * Used internally for room tokens; re-exported for server-to-server call signing
 * (e.g. DO → openturn-cloud profile commits share this primitive with ROOM_TOKEN_SECRET).
 */
export async function signValue(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    {
      hash: "SHA-256",
      name: "HMAC",
    },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return encodeBuffer(new Uint8Array(signature));
}

function encodeBase64Url(value: string): string {
  return encodeBuffer(new TextEncoder().encode(value));
}

function decodeBase64Url(value: string): string {
  return new TextDecoder().decode(decodeBuffer(value));
}

function encodeBuffer(buffer: Uint8Array): string {
  let binary = "";

  for (const byte of buffer) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function decodeBuffer(value: string): Uint8Array {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

export type {
  LobbyApplyResult,
  LobbyDropUserResult,
  LobbyEnv,
  LobbyPersistedState,
  LobbyStartAssignment,
  LobbyStartResult,
  SeatRecord,
} from "./lobby-runtime";
export type { BotEntryShape, BotRegistryShape } from "./bot-driver";
export { BotDriver, resolveBotMap } from "./bot-driver";
export { LobbyRuntime } from "./lobby-runtime";

// Wire-shaped `MatchInput` — the seated subset of a game's player pool, plus
// optional opaque match data and per-player profile snapshots. The schema
// validates the JSON structure; player-ID literal types and profile shape come
// from the caller's `TGame` generic and ride through a single boundary cast at
// each parser's exit (`MatchInput`'s `players` is a typed-non-empty readonly
// tuple while zod returns a mutable non-empty array — they're structurally
// equivalent on the wire).
const MatchInputSchema = z.object({
  data: JsonValueSchema.optional(),
  players: z.array(z.string()).nonempty(),
  profiles: z.record(z.string(), JsonValueSchema).optional(),
});

const RoomPersistenceRecordSchema = z.object({
  branch: ProtocolHistoryBranchSchema,
  checkpoint: MatchSnapshotSchema,
  deploymentVersion: z.string(),
  initialNow: z.number().finite(),
  log: ProtocolActionRecordSchema.array(),
  match: MatchInputSchema,
  roomID: z.string(),
  seed: z.string(),
});

// Deployment manifests carry a live `AnyGame` value (functions, computed
// state) on the `game` field, which is not JSON-validatable. Every other
// field is. We keep `game` opaque (`z.unknown()`) and re-narrow it via the
// caller's `TGame` generic.
const GameDeploymentSchema = z.object({
  deploymentVersion: z.string(),
  game: z.unknown(),
  gameKey: z.string(),
  match: MatchInputSchema.optional(),
  metadata: JsonValueSchema.optional(),
  schemaVersion: z.string(),
});

const RoomTokenClaimsSchema = z
  .object({
    deploymentVersion: z.string(),
    exp: z.number().finite(),
    iat: z.number().finite(),
    playerID: z.string().nullable(),
    roomID: z.string(),
    scope: z.enum(["lobby", "game"]),
    userID: z.string(),
  })
  .check((ctx) => {
    if (ctx.value.scope === "game" && ctx.value.playerID === null) {
      ctx.issues.push({
        code: "custom",
        input: ctx.value,
        message: "room_token.playerID is required for scope 'game'.",
        path: ["playerID"],
      });
    }
  });

// Each parser bridges zod's inferred output to its declared interface. The
// schema validates the runtime shape; the cast reconciles two structural
// differences zod can't express directly: (1) `MatchInput.players` is a
// readonly non-empty tuple while zod's `.nonempty()` produces a mutable
// `[T, ...T[]]`, and (2) `MatchInput.data` is `ReplayValue` (readonly arrays)
// vs zod's `JsonValue` (mutable arrays). The wire shapes are equivalent;
// only the variance markers differ.
export function parseRoomPersistenceRecord(value: unknown): RoomPersistenceRecord {
  return RoomPersistenceRecordSchema.parse(value) as unknown as RoomPersistenceRecord;
}

function parseGameDeploymentShape(value: unknown): GameDeployment {
  return GameDeploymentSchema.parse(value) as unknown as GameDeployment;
}

function parseRoomTokenClaims(value: unknown): RoomTokenClaims {
  return RoomTokenClaimsSchema.parse(value);
}
