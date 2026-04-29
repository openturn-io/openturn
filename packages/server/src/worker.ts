import { DurableObject } from "cloudflare:workers";

import { BotDriver, resolveBotMap, type BotRegistryShape } from "./bot-driver";
import type { AnyGame, PlayerID } from "@openturn/core";
import {
  isLobbyClientMessageText,
  parseLobbyClientMessageText,
  parseProtocolClientMessageText,
  stringifyLobbyServerMessage,
  stringifyProtocolServerMessage,
  type LobbyClientMessage,
  type LobbyServerMessage,
  type ProtocolClientMessage,
} from "@openturn/protocol";

import {
  createRoomRuntime,
  LobbyRuntime,
  parseRoomPersistenceRecord,
  signRoomToken,
  signValue,
  verifyRoomToken,
  type GameDeployment,
  type LobbyPersistedState,
  type RoomPersistence,
  type RoomPersistenceRecord,
  type RoomRuntime,
  type RoomTokenClaims,
} from "./index";
import type { MatchID } from "@openturn/protocol";

export interface GameWorkerEnv {
  GAME_ROOM: DurableObjectNamespace;
  ROOM_TOKEN_SECRET: string;
}

export interface GameWorkerOptions {
  idleReapMs?: number;
  lobbyTokenTtlSeconds?: number;
  gameTokenTtlSeconds?: number;
}

export interface GameWorkerInfoResponse {
  deploymentVersion: string;
  gameKey: string;
  players: readonly string[];
  schemaVersion: string;
  minPlayers: number;
  maxPlayers: number;
}

export interface GameWorkerExports {
  default: ExportedHandler<GameWorkerEnv>;
  GameRoom: DurableObjectConstructor<GameWorkerEnv>;
}

interface DurableObjectConstructor<TEnv> {
  new (ctx: DurableObjectState, env: TEnv): DurableObject<TEnv>;
}

type SocketAttachment =
  | {
      scope: "lobby";
      roomID: MatchID;
      userID: string;
      userName: string | null;
    }
  | {
      scope: "game";
      roomID: MatchID;
      userID: string;
      playerID: PlayerID;
    };

interface InitMeta {
  initialNow: number;
  roomID: MatchID;
  hostUserID: string;
  minPlayers: number;
  maxPlayers: number;
  /**
   * Initial seat ceiling at room creation. The lobby owns the mutable
   * `targetCapacity` (in `LobbyPersistedState`); this field is just the
   * default the lobby starts from. Defaults to `maxPlayers`.
   */
  initialTargetCapacity: number;
  /** Maximal player roster (length === maxPlayers). */
  playerIDs: readonly string[];
  /**
   * Active player IDs after `lobby:start` — sparse seat-ordered subset of
   * `playerIDs`. Becomes the `match.players` for the running game session.
   * Null while the room is still in lobby phase.
   */
  activePlayerIDs: readonly string[] | null;
  websocketURLBase: string | null;
  /**
   * Origin of the openturn-cloud control plane (e.g. "https://openturn.app").
   * Threaded in via the `x-openturn-cloud-base` header on the cloud's dispatch
   * proxy and stashed at bootstrap. Null for local/dev hosts that don't call back
   * to a cloud — settlement and profile hydration become no-ops in that case.
   */
  cloudAPIBase: string | null;
}

const PERSISTENCE_KEY = "persistence:v1";
const META_KEY = "meta:v1";
const LOBBY_KEY = "lobby:v1";
const DEFAULT_IDLE_REAP_MS = 30 * 60 * 1_000;
const DEFAULT_GAME_TTL_SECONDS = 60 * 10;

/**
 * Extract the bot catalog from `game.bots` (set via `attachBots(game, registry)`
 * in the consumer's bots package). Returns `null` when the game has no
 * `bots` field. The catalog is type-erased here because `@openturn/server`
 * cannot depend on `@openturn/lobby` (which depends on this package). The
 * shape matches `LobbyEnv.knownBots` and `BotRegistry.entries` structurally.
 */
function extractKnownBotsFromGame(
  game: unknown,
): ReadonlyMap<string, { label: string; description?: string; difficulty?: "easy" | "medium" | "hard" | "expert" }> | null {
  if (typeof game !== "object" || game === null) return null;
  const bots = (game as { bots?: unknown }).bots;
  if (typeof bots !== "object" || bots === null) return null;
  const entries = (bots as { entries?: unknown }).entries;
  if (!Array.isArray(entries)) return null;
  const out = new Map<string, { label: string; description?: string; difficulty?: "easy" | "medium" | "hard" | "expert" }>();
  for (const entry of entries) {
    if (typeof entry !== "object" || entry === null) continue;
    const e = entry as {
      botID?: unknown;
      label?: unknown;
      description?: unknown;
      difficulty?: unknown;
    };
    if (typeof e.botID !== "string" || e.botID.length === 0) continue;
    if (typeof e.label !== "string" || e.label.length === 0) continue;
    out.set(e.botID, {
      label: e.label,
      ...(typeof e.description === "string" ? { description: e.description } : {}),
      ...(typeof e.difficulty === "string"
        && (e.difficulty === "easy"
          || e.difficulty === "medium"
          || e.difficulty === "hard"
          || e.difficulty === "expert")
        ? { difficulty: e.difficulty }
        : {}),
    });
  }
  return out.size > 0 ? out : null;
}

function extractMultiplayerFromMatch(match: unknown): {
  players: readonly string[];
  minPlayers: number;
  maxPlayers: number;
} {
  if (match === null || typeof match !== "object") {
    return { players: [], minPlayers: 0, maxPlayers: 0 };
  }
  const matchObject = match as { players?: unknown; minPlayers?: unknown };
  const players = Array.isArray(matchObject.players)
    ? matchObject.players.filter((value): value is string => typeof value === "string")
    : [];
  const maxPlayers = players.length;
  const minPlayers =
    typeof matchObject.minPlayers === "number"
      && Number.isFinite(matchObject.minPlayers)
      && matchObject.minPlayers > 0
      ? Math.min(matchObject.minPlayers, maxPlayers)
      : maxPlayers;
  return { players, minPlayers, maxPlayers };
}

export function createGameWorker<TGame extends AnyGame>(
  deployment: GameDeployment<TGame>,
  options: GameWorkerOptions = {},
): GameWorkerExports {
  const idleReapMs = options.idleReapMs ?? DEFAULT_IDLE_REAP_MS;
  const gameTtlSeconds = options.gameTokenTtlSeconds ?? DEFAULT_GAME_TTL_SECONDS;
  const erasedDeployment = deployment as unknown as GameDeployment;
  const {
    players: deploymentPlayers,
    minPlayers: deploymentMinPlayers,
    maxPlayers: deploymentMaxPlayers,
  } = extractMultiplayerFromMatch(erasedDeployment.match);
  // Bot catalog comes from `game.bots` (set via `attachBots(game, registry)`
  // in the consumer's bots package). Engine-inert; `LobbyRuntime` reads it
  // to validate `lobby:assign_bot` and to populate `lobby:state.availableBots`.
  const deploymentKnownBots = extractKnownBotsFromGame(erasedDeployment.game);

  class GameRoom extends DurableObject<GameWorkerEnv> {
    #runtime: RoomRuntime | null = null;
    #runtimePromise: Promise<RoomRuntime> | null = null;
    #lobby: LobbyRuntime | null = null;
    /**
     * In-DO bot driver. Populated when `lobby:start` succeeds with at least
     * one bot seat assignment. Drives `bot.decide()` after every game-message
     * dispatch (human or bot), feeding bot moves back through the runtime so
     * persistence + broadcast follow the same path as a human's move.
     */
    #botDriver: BotDriver<AnyGame> | null = null;

    async fetch(request: Request): Promise<Response> {
      const url = new URL(request.url);

      if (url.pathname === "/__connect") return this.handleConnect(request);
      if (url.pathname === "/__bootstrap") return this.handleBootstrap(request);
      if (url.pathname === "/__state") return this.handleState();
      if (url.pathname === "/__room_state") return this.handleRoomState();
      if (url.pathname === "/__lookup") return this.handleLookup(request);

      return Response.json({ error: "unknown_do_path" }, { status: 404 });
    }

    async webSocketMessage(ws: WebSocket, rawMessage: string | ArrayBuffer): Promise<void> {
      const attachment = ws.deserializeAttachment() as SocketAttachment | null;
      if (attachment === null) return;

      const messageText =
        typeof rawMessage === "string" ? rawMessage : new TextDecoder().decode(rawMessage);

      if (attachment.scope === "lobby") {
        await this.handleLobbyMessage(attachment, messageText);
        return;
      }

      await this.handleGameMessage(attachment, messageText);
    }

    async webSocketClose(
      ws: WebSocket,
      _code: number,
      _reason: string,
      _wasClean: boolean,
    ): Promise<void> {
      const attachment = ws.deserializeAttachment() as SocketAttachment | null;
      if (attachment === null) return;

      if (attachment.scope === "lobby") {
        await this.handleLobbyClose(attachment);
        return;
      }

      if (this.countSocketsForPlayer(attachment.roomID, attachment.playerID) > 0) return;

      if (this.#runtime !== null) {
        this.#runtime.disconnect(attachment.playerID);
      }

      this.broadcastGamePresence(attachment.roomID, {
        kind: "left",
        playerID: attachment.playerID,
      });

      await this.scheduleIdleReap();
    }

    async webSocketError(ws: WebSocket, _error: unknown): Promise<void> {
      try {
        ws.close(1011, "internal_error");
      } catch {}
    }

    async alarm(): Promise<void> {
      const sockets = this.ctx.getWebSockets();

      if (sockets.length > 0) {
        await this.scheduleIdleReap();
        return;
      }

      await this.ctx.storage.deleteAll();
      this.#runtime = null;
      this.#lobby = null;
    }

    private async handleBootstrap(request: Request): Promise<Response> {
      const payload = (await request.json().catch(() => null)) as {
        playerID?: PlayerID;
        roomID?: MatchID;
        initialNow?: number;
        cloudAPIBase?: string;
      } | null;

      if (
        payload === null
        || typeof payload.playerID !== "string"
        || typeof payload.roomID !== "string"
      ) {
        return Response.json({ error: "invalid_bootstrap" }, { status: 400 });
      }

      const meta = await this.ensureMeta({
        roomID: payload.roomID,
        hostUserID: payload.playerID,
        ...(payload.initialNow === undefined ? {} : { initialNow: payload.initialNow }),
        ...(typeof payload.cloudAPIBase === "string" ? { cloudAPIBase: payload.cloudAPIBase } : {}),
      });
      const runtime = await this.getOrCreateRuntime(meta);
      const envelopes = await runtime.handleClientMessage({
        type: "sync",
        matchID: meta.roomID,
        playerID: payload.playerID,
      });

      return Response.json(envelopes[0]?.message ?? null);
    }

    private async handleState(): Promise<Response> {
      const meta = await this.ctx.storage.get<InitMeta>(META_KEY);

      if (meta === undefined) {
        return Response.json({ initialized: false });
      }

      const lobby = await this.loadLobby(meta);

      if (lobby.mode !== "active") {
        return Response.json({
          initialized: true,
          roomID: meta.roomID,
          phase: lobby.mode,
        });
      }

      const runtime = await this.getOrCreateRuntime(meta);
      const state = runtime.getState();

      return Response.json({
        initialized: true,
        roomID: meta.roomID,
        phase: "active" as const,
        revision: state.revision,
        connectedPlayers: state.connectedPlayers,
      });
    }

    private async handleRoomState(): Promise<Response> {
      const meta = await this.ctx.storage.get<InitMeta>(META_KEY);

      if (meta === undefined) {
        return Response.json({ initialized: false });
      }

      const lobby = await this.loadLobby(meta);
      const stateMessage = lobby.buildStateMessage(meta.roomID, this.liveLobbyUserIDs(meta.roomID));

      return Response.json({
        initialized: true,
        roomID: meta.roomID,
        hostUserID: meta.hostUserID,
        phase: stateMessage.phase,
        minPlayers: stateMessage.minPlayers,
        maxPlayers: stateMessage.maxPlayers,
        targetCapacity: stateMessage.targetCapacity,
        seats: stateMessage.seats,
      });
    }

    private async handleLookup(request: Request): Promise<Response> {
      const url = new URL(request.url);
      const userID = url.searchParams.get("userID");

      if (userID === null || userID.length === 0) {
        return Response.json({ error: "missing_user" }, { status: 400 });
      }

      const meta = await this.ctx.storage.get<InitMeta>(META_KEY);
      if (meta === undefined) {
        return Response.json({ phase: "uninitialized", playerID: null });
      }

      const lobby = await this.loadLobby(meta);

      if (lobby.mode !== "active") {
        return Response.json({
          phase: lobby.mode,
          playerID: null,
          seatIndex: lobby.seatIndexFor(userID),
        });
      }

      return Response.json({
        phase: "active" as const,
        playerID: lobby.playerIDFor(userID),
      });
    }

    private async handleConnect(request: Request): Promise<Response> {
      if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
        return Response.json({ error: "expected_websocket_upgrade" }, { status: 426 });
      }

      const claimsHeader = request.headers.get("x-openturn-claims");

      if (claimsHeader === null) {
        return Response.json({ error: "missing_claims" }, { status: 400 });
      }

      let claims: RoomTokenClaims;
      try {
        claims = JSON.parse(claimsHeader) as RoomTokenClaims;
      } catch {
        return Response.json({ error: "invalid_claims" }, { status: 400 });
      }

      const websocketURLBase = request.headers.get("x-openturn-websocket-url") ?? null;
      const initialNowHeader = request.headers.get("x-openturn-initial-now");
      const parsedInitialNow =
        initialNowHeader === null ? undefined : Number.parseInt(initialNowHeader, 10);
      const initialNow =
        typeof parsedInitialNow === "number" && Number.isFinite(parsedInitialNow)
          ? parsedInitialNow
          : undefined;

      const userName = request.headers.get("x-openturn-user-name");

      const meta = await this.ensureMeta({
        roomID: claims.roomID,
        hostUserID: claims.userID,
        ...(initialNow === undefined ? {} : { initialNow }),
        ...(websocketURLBase === null ? {} : { websocketURLBase }),
      });

      if (meta.roomID !== claims.roomID) {
        return Response.json({ error: "room_mismatch" }, { status: 409 });
      }

      const lobby = await this.loadLobby(meta);

      if (claims.scope === "lobby") {
        if (lobby.mode === "active") {
          return Response.json({ error: "room_already_started" }, { status: 409 });
        }
        if (lobby.mode === "closed") {
          return Response.json({ error: "room_closed" }, { status: 410 });
        }

        const pair = new WebSocketPair();
        const clientSocket = pair[0];
        const serverSocket = pair[1];
        const attachment: SocketAttachment = {
          scope: "lobby",
          roomID: meta.roomID,
          userID: claims.userID,
          userName,
        };
        serverSocket.serializeAttachment(attachment);
        this.ctx.acceptWebSocket(serverSocket, [lobbyTag(meta.roomID, claims.userID)]);

        this.sendLobbyMessageToSocket(
          serverSocket,
          lobby.buildStateMessage(meta.roomID, this.liveLobbyUserIDs(meta.roomID)),
        );
        this.broadcastLobbyState(meta, lobby);
        await this.scheduleIdleReap();
        return new Response(null, { status: 101, webSocket: clientSocket });
      }

      // scope === "game"
      if (lobby.mode !== "active") {
        return Response.json({ error: "room_not_started" }, { status: 409 });
      }

      if (claims.playerID === null) {
        return Response.json({ error: "missing_player_id" }, { status: 400 });
      }

      const expectedPlayerID = lobby.playerIDFor(claims.userID);
      if (expectedPlayerID === null || expectedPlayerID !== claims.playerID) {
        return Response.json({ error: "seat_mismatch" }, { status: 403 });
      }

      const runtime = await this.getOrCreateRuntime(meta);

      const attachment: SocketAttachment = {
        scope: "game",
        playerID: claims.playerID,
        roomID: meta.roomID,
        userID: claims.userID,
      };
      const hadPlayerSocket = this.countSocketsForPlayer(meta.roomID, claims.playerID) > 0;
      const pair = new WebSocketPair();
      const clientSocket = pair[0];
      const serverSocket = pair[1];

      serverSocket.serializeAttachment(attachment);
      this.ctx.acceptWebSocket(serverSocket, [playerTag(meta.roomID, claims.playerID)]);

      const deliveries = !hadPlayerSocket
        ? await runtime.connect(claims.playerID)
        : await runtime.handleClientMessage({
            type: "sync",
            matchID: meta.roomID,
            playerID: claims.playerID,
          });

      this.sendGameDeliveriesToSocket(serverSocket, deliveries);

      if (!hadPlayerSocket) {
        this.broadcastGamePresence(meta.roomID, {
          kind: "joined",
          playerID: claims.playerID,
        });
      }

      await this.scheduleIdleReap();

      return new Response(null, { status: 101, webSocket: clientSocket });
    }

    private async ensureMeta(input: {
      roomID: MatchID;
      hostUserID: string;
      initialNow?: number;
      websocketURLBase?: string;
      cloudAPIBase?: string;
    }): Promise<InitMeta> {
      const existing = await this.ctx.storage.get<InitMeta>(META_KEY);

      if (existing !== undefined) {
        // Patch in fields that may only become known on a later bootstrap
        // (websocket URL, cloud base). First-write-wins for cloudAPIBase so
        // a later proxy without the header can't wipe a known good value.
        const patch: Partial<InitMeta> = {};
        if (
          input.websocketURLBase !== undefined
          && existing.websocketURLBase !== input.websocketURLBase
        ) {
          patch.websocketURLBase = input.websocketURLBase;
        }
        if (input.cloudAPIBase !== undefined && existing.cloudAPIBase === null) {
          patch.cloudAPIBase = input.cloudAPIBase;
        }
        if (Object.keys(patch).length === 0) return existing;
        const updated = { ...existing, ...patch };
        await this.ctx.storage.put(META_KEY, updated);
        return updated;
      }

      const meta: InitMeta = {
        initialNow: input.initialNow ?? Date.now(),
        roomID: input.roomID,
        hostUserID: input.hostUserID,
        minPlayers: deploymentMinPlayers,
        maxPlayers: deploymentMaxPlayers,
        initialTargetCapacity: deploymentMaxPlayers,
        playerIDs: deploymentPlayers,
        activePlayerIDs: null,
        websocketURLBase: input.websocketURLBase ?? null,
        cloudAPIBase: input.cloudAPIBase ?? null,
      };

      await this.ctx.storage.put(META_KEY, meta);
      return meta;
    }

    private async loadLobby(meta: InitMeta): Promise<LobbyRuntime> {
      if (this.#lobby !== null) return this.#lobby;

      const persisted = await this.ctx.storage.get<LobbyPersistedState>(LOBBY_KEY);
      const env = {
        hostUserID: meta.hostUserID,
        minPlayers: meta.minPlayers,
        maxPlayers: meta.maxPlayers,
        targetCapacity: meta.initialTargetCapacity,
        playerIDs: meta.playerIDs,
        ...(deploymentKnownBots === null ? {} : { knownBots: deploymentKnownBots }),
      };
      const runtime = new LobbyRuntime(env, persisted);
      // Enforce "disconnect frees seat": any user without a live lobby WS
      // right now loses their seat on cold-start.
      const pruned = runtime.pruneToConnected(this.liveLobbyUserIDs(meta.roomID));
      if (pruned) {
        await this.ctx.storage.put(LOBBY_KEY, runtime.toPersisted());
      }
      this.#lobby = runtime;

      // Rehydrate the bot driver if the persisted lobby is already past
      // start (`mode: "active"` with bot seats). On cold-start after DO
      // hibernation, `lobby.start()` won't fire again; we read seat state
      // from the persisted record and rebuild the driver in place.
      if (this.#botDriver === null && persisted !== undefined) {
        const botSeats = persisted.seats.filter((s) => s.kind === "bot");
        if (botSeats.length > 0) {
          const registry = (erasedDeployment.game as { bots?: BotRegistryShape<AnyGame> }).bots;
          if (registry !== undefined) {
            const assignmentsForRehydrate = botSeats.map((s) => ({
              kind: "bot" as const,
              playerID: meta.playerIDs[s.seatIndex] ?? s.botID,
              botID: s.botID,
            }));
            const botMap = resolveBotMap(registry, assignmentsForRehydrate);
            if (botMap !== null) {
              this.#botDriver = new BotDriver({
                game: erasedDeployment.game,
                bots: botMap,
              });
            }
          }
        }
      }
      return runtime;
    }

    private async persistLobby(): Promise<void> {
      if (this.#lobby === null) return;
      await this.ctx.storage.put(LOBBY_KEY, this.#lobby.toPersisted());
    }

    // ----- LOBBY MESSAGE HANDLING -----

    private async handleLobbyMessage(
      attachment: Extract<SocketAttachment, { scope: "lobby" }>,
      messageText: string,
    ): Promise<void> {
      const meta = await this.ctx.storage.get<InitMeta>(META_KEY);
      if (meta === undefined) return;
      const lobby = await this.loadLobby(meta);

      let parsed: LobbyClientMessage;
      try {
        parsed = parseLobbyClientMessageText(messageText) as LobbyClientMessage;
      } catch {
        this.sendLobbyMessageToUser(meta.roomID, attachment.userID, {
          type: "lobby:rejected",
          reason: "unknown",
          message: "could_not_parse_message",
        });
        return;
      }

      if (parsed.type === "lobby:start") {
        await this.handleStart(meta, lobby, attachment);
        return;
      }

      const result = lobby.apply(attachment.userID, attachment.userName, parsed);
      if (!result.ok) {
        this.sendLobbyMessageToUser(meta.roomID, attachment.userID, {
          type: "lobby:rejected",
          reason: result.reason,
          echoType: parsed.type,
        });
        return;
      }

      await this.persistLobby();

      if (parsed.type === "lobby:close") {
        this.broadcastLobbyClosed("host_close");
        this.closeAllLobbySockets(4011, "host_close");
        return;
      }

      if (result.changed) {
        this.broadcastLobbyState(meta, lobby);
      }
    }

    private async handleLobbyClose(
      attachment: Extract<SocketAttachment, { scope: "lobby" }>,
    ): Promise<void> {
      const meta = await this.ctx.storage.get<InitMeta>(META_KEY);
      if (meta === undefined) return;
      const lobby = await this.loadLobby(meta);

      if (this.countLobbySocketsForUser(attachment.roomID, attachment.userID) > 0) return;

      const drop = lobby.dropUser(attachment.userID);
      if (!drop.changed) {
        await this.scheduleIdleReap();
        return;
      }

      await this.persistLobby();

      if (drop.shouldCloseRoom) {
        this.broadcastLobbyClosed("host_left");
        this.closeAllLobbySockets(4010, "host_left");
      } else {
        this.broadcastLobbyState(meta, lobby);
      }
      await this.scheduleIdleReap();
    }

    private async handleStart(
      initialMeta: InitMeta,
      lobby: LobbyRuntime,
      attachment: Extract<SocketAttachment, { scope: "lobby" }>,
    ): Promise<void> {
      let meta: InitMeta = initialMeta;
      const startResult = lobby.start(attachment.userID);
      if (!startResult.ok) {
        this.sendLobbyMessageToUser(meta.roomID, attachment.userID, {
          type: "lobby:rejected",
          reason: startResult.reason,
          echoType: "lobby:start",
        });
        return;
      }

      // Capture the active player roster (sparse seat-ordered subset of the
      // maximal manifest roster) and persist it on `meta`. The game runtime
      // reads this back when constructing the session so `match.players` is
      // filtered to actually-seated players. Without this, variable-capacity
      // games would see open seats as "absent players" in turn rotation.
      const activePlayerIDs = startResult.assignments
        .slice()
        .sort((a, b) => a.seatIndex - b.seatIndex)
        .map((a) => a.playerID);
      meta = { ...meta, activePlayerIDs };
      await this.ctx.storage.put(META_KEY, meta);

      const issuedAt = Math.floor(Date.now() / 1_000);
      const tokenBase = meta.websocketURLBase;
      const transitions: Array<{
        userID: string;
        message: LobbyServerMessage;
      }> = [];

      // Public seat→player map shipped to every recipient. Includes bots so
      // the game UI can label seats; tokens are NEVER sent to clients for
      // bot seats (they stay server-side and feed the bot supervisor).
      const playerAssignments = startResult.assignments.map((assignment) =>
        assignment.kind === "bot"
          ? {
              seatIndex: assignment.seatIndex,
              playerID: assignment.playerID,
              kind: "bot" as const,
              botID: assignment.botID!,
            }
          : {
              seatIndex: assignment.seatIndex,
              playerID: assignment.playerID,
              kind: "human" as const,
            },
      );

      for (const assignment of startResult.assignments) {
        if (assignment.kind === "bot" || assignment.userID === null) continue;
        const claims: RoomTokenClaims = {
          deploymentVersion: erasedDeployment.deploymentVersion,
          exp: issuedAt + gameTtlSeconds,
          iat: issuedAt,
          playerID: assignment.playerID,
          roomID: meta.roomID,
          scope: "game",
          userID: assignment.userID,
        };
        const signed = await signRoomToken(claims, this.env.ROOM_TOKEN_SECRET);
        const websocketURL =
          tokenBase !== null ? appendQueryParam(tokenBase, "token", signed.token) : "";

        transitions.push({
          userID: assignment.userID,
          message: {
            type: "lobby:transition_to_game",
            roomID: meta.roomID,
            playerID: assignment.playerID,
            roomToken: signed.token,
            tokenExpiresAt: claims.exp,
            websocketURL,
            playerAssignments,
          },
        });
      }

      await this.persistLobby();

      const seatedUserIDs = new Set(
        startResult.assignments
          .filter((a): a is typeof a & { userID: string } => a.userID !== null)
          .map((a) => a.userID),
      );
      for (const transition of transitions) {
        this.sendLobbyMessageToUser(meta.roomID, transition.userID, transition.message);
      }
      // Any non-seated observer gets a clean close.
      for (const socket of this.ctx.getWebSockets()) {
        const socketAttachment = socket.deserializeAttachment() as SocketAttachment | null;
        if (socketAttachment === null || socketAttachment.scope !== "lobby") continue;
        if (!seatedUserIDs.has(socketAttachment.userID)) {
          try {
            socket.send(
              stringifyLobbyServerMessage({
                type: "lobby:closed",
                reason: "room_closed",
              }),
            );
          } catch {}
        }
      }

      this.closeAllLobbySockets(4010, "lobby_transition");

      // Bot dispatch lifecycle. If `lobby:start` minted any bot seat
      // assignments, wire the bot driver now and fire the first tick — this
      // covers games where seat 0 is bot-controlled (the bot must move
      // before any human dispatch happens).
      const registry = (erasedDeployment.game as { bots?: BotRegistryShape<AnyGame> }).bots;
      const botMap = resolveBotMap(registry, startResult.assignments);
      if (botMap !== null) {
        this.#botDriver = new BotDriver({ game: erasedDeployment.game, bots: botMap });
        const runtime = await this.getOrCreateRuntime(meta);
        await this.tickBotDriver(meta, runtime);
      }

      await this.scheduleIdleReap();
    }

    /**
     * Run the bot driver once, dispatching any pending bot moves through
     * `runtime.handleClientMessage`. Each bot dispatch goes through the
     * same broadcast path as a human's, so connected human clients receive
     * the bot's action via the standard `BatchApplied` envelope.
     */
    private async tickBotDriver(meta: InitMeta, runtime: RoomRuntime): Promise<void> {
      const driver = this.#botDriver;
      if (driver === null) return;
      try {
        await driver.tick({
          session: runtime.getSession() as never,
          matchID: meta.roomID,
          dispatch: async (message) => {
            const envelopes = await runtime.handleClientMessage(message);
            this.broadcastGameDeliveries(meta.roomID, envelopes);
            return envelopes;
          },
        });
      } catch {
        // Driver swallows individual bot errors; this catches anything
        // that escaped (e.g. the runtime threw on the bot's dispatch).
      }
    }

    private broadcastLobbyState(meta: InitMeta, lobby: LobbyRuntime): void {
      const message = lobby.buildStateMessage(
        meta.roomID,
        this.liveLobbyUserIDs(meta.roomID),
      );
      const payload = stringifyLobbyServerMessage(message);

      for (const socket of this.ctx.getWebSockets()) {
        const attachment = socket.deserializeAttachment() as SocketAttachment | null;
        if (attachment === null || attachment.scope !== "lobby") continue;
        if (attachment.roomID !== meta.roomID) continue;
        try {
          socket.send(payload);
        } catch {}
      }
    }

    private broadcastLobbyClosed(reason: "host_left" | "host_close" | "room_closed"): void {
      const payload = stringifyLobbyServerMessage({ type: "lobby:closed", reason });

      for (const socket of this.ctx.getWebSockets()) {
        const attachment = socket.deserializeAttachment() as SocketAttachment | null;
        if (attachment === null || attachment.scope !== "lobby") continue;
        try {
          socket.send(payload);
        } catch {}
      }
    }

    private closeAllLobbySockets(code: number, reason: string): void {
      for (const socket of this.ctx.getWebSockets()) {
        const attachment = socket.deserializeAttachment() as SocketAttachment | null;
        if (attachment === null || attachment.scope !== "lobby") continue;
        try {
          socket.close(code, reason);
        } catch {}
      }
    }

    private sendLobbyMessageToSocket(socket: WebSocket, message: LobbyServerMessage): void {
      try {
        socket.send(stringifyLobbyServerMessage(message));
      } catch {}
    }

    private sendLobbyMessageToUser(
      roomID: MatchID,
      userID: string,
      message: LobbyServerMessage,
    ): void {
      const payload = stringifyLobbyServerMessage(message);
      for (const socket of this.ctx.getWebSockets(lobbyTag(roomID, userID))) {
        try {
          socket.send(payload);
        } catch {}
      }
    }

    private countLobbySocketsForUser(roomID: MatchID, userID: string): number {
      return this.ctx.getWebSockets(lobbyTag(roomID, userID)).length;
    }

    private liveLobbyUserIDs(roomID: MatchID): Set<string> {
      const out = new Set<string>();
      for (const socket of this.ctx.getWebSockets()) {
        const attachment = socket.deserializeAttachment() as SocketAttachment | null;
        if (attachment === null || attachment.scope !== "lobby") continue;
        if (attachment.roomID !== roomID) continue;
        out.add(attachment.userID);
      }
      return out;
    }

    // ----- GAME MESSAGE HANDLING -----

    private async handleGameMessage(
      attachment: Extract<SocketAttachment, { scope: "game" }>,
      messageText: string,
    ): Promise<void> {
      if (isLobbyClientMessageText(messageText)) return;

      const meta = await this.ctx.storage.get<InitMeta>(META_KEY);
      if (meta === undefined) return;
      const runtime = await this.getOrCreateRuntime(meta);

      let parsedMessage: ProtocolClientMessage;
      try {
        parsedMessage = parseProtocolClientMessageText(messageText) as ProtocolClientMessage;
      } catch {
        return;
      }

      const boundMessage = bindGameClientMessage(parsedMessage, attachment);
      const deliveries = await runtime.handleClientMessage(boundMessage);

      this.broadcastGameDeliveries(attachment.roomID, deliveries);
      // After every human dispatch, give bot seats a chance to act. The
      // driver no-ops cheaply when no bot is registered or no bot's seat is
      // currently active.
      if (this.#botDriver !== null) {
        await this.tickBotDriver(meta, runtime);
      }
      await this.scheduleIdleReap();
    }

    private async scheduleIdleReap(): Promise<void> {
      try {
        await this.ctx.storage.setAlarm(Date.now() + idleReapMs);
      } catch {}
    }

    private broadcastGamePresence(
      roomID: MatchID,
      event: { kind: "joined" | "left"; playerID: PlayerID },
    ): void {
      const sockets = this.ctx.getWebSockets();
      if (sockets.length === 0) return;

      const connectedPlayers = new Set<string>();
      for (const socket of sockets) {
        const attachment = socket.deserializeAttachment() as SocketAttachment | null;
        if (attachment === null || attachment.scope !== "game") continue;
        if (attachment.roomID !== roomID) continue;
        connectedPlayers.add(attachment.playerID);
      }

      const payload = JSON.stringify({
        type: "openturn:presence",
        event: event.kind,
        playerID: event.playerID,
        connectedPlayers: [...connectedPlayers],
      });

      for (const socket of sockets) {
        const attachment = socket.deserializeAttachment() as SocketAttachment | null;
        if (attachment === null || attachment.scope !== "game") continue;
        if (attachment.roomID !== roomID) continue;
        try {
          socket.send(payload);
        } catch {}
      }
    }

    private async getOrCreateRuntime(meta: InitMeta): Promise<RoomRuntime> {
      if (this.#runtime !== null) return this.#runtime;
      if (this.#runtimePromise !== null) return this.#runtimePromise;

      this.#runtimePromise = (async () => {
        const persistence = createStoragePersistence(this.ctx.storage);
        const cloudBase = meta.cloudAPIBase;
        const sharedSecret = this.env.ROOM_TOKEN_SECRET;
        const hasProfile = (erasedDeployment.game as { profile?: unknown }).profile !== undefined;
        const cloudConfigured = cloudBase !== null && sharedSecret.length > 0;
        const schemaVersion = erasedDeployment.schemaVersion;

        const callCloud = async (path: string, body: object): Promise<Response | null> => {
          if (!cloudConfigured) return null;
          const bodyText = JSON.stringify(body);
          const signature = await signValue(bodyText, sharedSecret);
          try {
            return await fetch(`${cloudBase.replace(/\/$/u, "")}${path}`, {
              body: bodyText,
              headers: {
                "content-type": "application/json",
                "x-openturn-signature": signature,
              },
              method: "POST",
            });
          } catch {
            return null;
          }
        };

        let hydratedDeployment = erasedDeployment;
        // PlayerID -> userID mapping, captured at lobby→active transition.
        // Seats are final once the match starts, so we cache this once rather
        // than re-deriving per commit.
        const playerToUser = new Map<string, string>();
        // Latest-known server revision per (userID, gameKey), seeded from
        // hydrate and updated by applied/conflict responses. Used to gate
        // commits with `expectedRevision` so concurrent writers get a
        // surfaced conflict instead of silent last-writer-wins.
        const revisionByUser = new Map<string, number>();

        if (hasProfile && cloudConfigured) {
          const lobby = await this.loadLobby(meta);
          for (const seat of lobby.seats) {
            if (seat.kind !== "human") continue;
            const playerID = lobby.playerIDFor(seat.userID);
            if (playerID !== null) playerToUser.set(playerID, seat.userID);
          }
          const userIDs = lobby.seats
            .filter((seat): seat is typeof seat & { kind: "human" } => seat.kind === "human")
            .map((seat) => seat.userID);
          if (userIDs.length > 0) {
            const response = await callCloud("/api/profiles/hydrate", {
              gameKey: erasedDeployment.gameKey,
              userIDs,
            });
            if (response !== null && response.ok) {
              const payload = (await response.json()) as {
                profiles?: Array<{ userID: string; data: unknown; revision?: number }>;
              };
              const byPlayer: Record<string, unknown> = {};
              for (const record of payload.profiles ?? []) {
                const playerID = lobby.playerIDFor(record.userID);
                if (playerID !== null) byPlayer[playerID] = record.data;
                if (typeof record.revision === "number") {
                  revisionByUser.set(record.userID, record.revision);
                }
              }
              const baseMatch = (erasedDeployment.match ?? { players: erasedDeployment.game.playerIDs }) as { players: readonly [string, ...string[]]; profiles?: Record<string, unknown> };
              hydratedDeployment = {
                ...erasedDeployment,
                match: {
                  ...baseMatch,
                  profiles: { ...(baseMatch.profiles ?? {}), ...byPlayer },
                } as NonNullable<typeof erasedDeployment.match>,
              };
            }
          }
        }

        /**
         * Commit a single player's delta, retrying on:
         *   - network / 5xx up to `networkAttempts` with exponential backoff
         *   - `revision_conflict` up to `conflictAttempts` (the engine's delta
         *     is re-applied server-side against the new baseline; `inc` ops
         *     compose, `set` ops degrade to LWW — both are intentional)
         *
         * Returns the outcome status; the caller logs on non-terminal
         * failures. No throwing — the match shouldn't wedge on a commit.
         */
        const commitOneWithRetry = async (
          body: {
            actionID?: string;
            delta: unknown;
            deploymentVersion: string;
            gameKey: string;
            playerID: string;
            roomID: string;
            schemaVersion: string;
            userID: string;
          },
          limits: { networkAttempts: number; conflictAttempts: number },
        ): Promise<{
          status: "applied" | "duplicate" | "invalid_delta" | "schema_mismatch" | "revision_conflict" | "network";
          detail?: unknown;
        }> => {
          let conflicts = 0;
          let networkFailures = 0;
          while (true) {
            const expected = revisionByUser.get(body.userID);
            const payload = expected === undefined
              ? body
              : { ...body, expectedRevision: expected };
            const response = await callCloud("/api/profiles/commit", payload);
            if (response === null) {
              networkFailures += 1;
              if (networkFailures >= limits.networkAttempts) {
                return { status: "network" };
              }
              await sleep(100 * Math.pow(4, networkFailures - 1));
              continue;
            }
            if (response.status >= 500) {
              networkFailures += 1;
              if (networkFailures >= limits.networkAttempts) {
                return { status: "network", detail: response.status };
              }
              await sleep(100 * Math.pow(4, networkFailures - 1));
              continue;
            }
            const parsed = (await response.json().catch(() => null)) as
              | { status: string; profile?: { revision?: number }; currentRevision?: number; reason?: string; serverVersion?: string; clientVersion?: string }
              | null;
            if (parsed === null) {
              return { status: "network", detail: "unparseable response" };
            }
            if (parsed.status === "applied" || parsed.status === "duplicate") {
              const rev = parsed.profile?.revision;
              if (typeof rev === "number") revisionByUser.set(body.userID, rev);
              return { status: parsed.status };
            }
            if (parsed.status === "revision_conflict") {
              const current = typeof parsed.currentRevision === "number"
                ? parsed.currentRevision
                : parsed.profile?.revision;
              if (typeof current === "number") revisionByUser.set(body.userID, current);
              conflicts += 1;
              if (conflicts >= limits.conflictAttempts) {
                return { status: "revision_conflict", detail: current };
              }
              continue;
            }
            if (parsed.status === "invalid_delta" || parsed.status === "schema_mismatch") {
              return { status: parsed.status, detail: parsed };
            }
            return { status: "network", detail: parsed };
          }
        };

        const commitAll = async (
          input: {
            actionID?: string;
            delta: Record<string, readonly unknown[] | undefined>;
            deploymentVersion: string;
            gameKey: string;
            roomID: string;
          },
          limits: { networkAttempts: number; conflictAttempts: number },
        ): Promise<void> => {
          const entries = Object.entries(input.delta) as Array<[string, readonly unknown[] | undefined]>;
          await Promise.all(
            entries.map(async ([playerID, delta]) => {
              if (delta === undefined) return;
              const userID = playerToUser.get(playerID);
              if (userID === undefined) return;
              const outcome = await commitOneWithRetry(
                {
                  ...(input.actionID === undefined ? {} : { actionID: input.actionID }),
                  delta,
                  deploymentVersion: input.deploymentVersion,
                  gameKey: input.gameKey,
                  playerID,
                  roomID: input.roomID,
                  schemaVersion,
                  userID,
                },
                limits,
              );
              if (outcome.status !== "applied" && outcome.status !== "duplicate") {
                // Surface to operator logs. In Cloudflare Workers this reaches
                // wrangler tail / Logpush; the alternative (silent drop) is
                // how the pre-refactor code lost writes.
                console.warn(
                  "[openturn] profile commit failed",
                  JSON.stringify({
                    actionID: input.actionID ?? "final",
                    gameKey: input.gameKey,
                    playerID,
                    roomID: input.roomID,
                    status: outcome.status,
                    userID,
                    ...(outcome.detail === undefined ? {} : { detail: outcome.detail }),
                  }),
                );
              }
            }),
          );
        };

        // Filter `match.players` down to the seated subset captured at
        // `lobby:start`. The maximal roster lives in `deployment.match.players`
        // (set at deploy time); for variable-player games the seated subset
        // can be smaller. Game logic that does `match.players.includes(...)`
        // or `roundRobin(match.players, ...)` then naturally cycles only
        // active players. When `activePlayerIDs` is null (room hasn't started
        // yet — e.g. cold-start of the runtime for a room mid-lobby), fall
        // back to the maximal roster.
        const activeDeployment =
          meta.activePlayerIDs === null || meta.activePlayerIDs.length === meta.maxPlayers
            ? hydratedDeployment
            : {
                ...hydratedDeployment,
                match: {
                  ...(hydratedDeployment.match ?? { players: hydratedDeployment.game.playerIDs }),
                  players: meta.activePlayerIDs,
                } as NonNullable<typeof hydratedDeployment.match>,
              };

        const runtime = await createRoomRuntime({
          connectedPlayers: this.getConnectedPlayers(meta.roomID),
          deployment: activeDeployment,
          initialNow: meta.initialNow,
          persistence,
          roomID: meta.roomID,
          ...(cloudConfigured
            ? {
                onActionProfileCommit: async (input) => {
                  await commitAll(
                    {
                      actionID: input.actionID,
                      delta: input.delta as Record<string, readonly unknown[] | undefined>,
                      deploymentVersion: input.deploymentVersion,
                      gameKey: input.gameKey,
                      roomID: input.roomID,
                    },
                    { networkAttempts: 3, conflictAttempts: 3 },
                  );
                },
                onSettle: async (input) => {
                  await commitAll(
                    {
                      delta: input.delta as Record<string, readonly unknown[] | undefined>,
                      deploymentVersion: input.deploymentVersion,
                      gameKey: input.gameKey,
                      roomID: input.roomID,
                    },
                    { networkAttempts: 5, conflictAttempts: 5 },
                  );
                },
              }
            : {}),
        });

        this.#runtime = runtime;
        return runtime;
      })();

      try {
        return await this.#runtimePromise;
      } finally {
        this.#runtimePromise = null;
      }
    }

    private countSocketsForPlayer(roomID: MatchID, playerID: PlayerID): number {
      return this.ctx.getWebSockets(playerTag(roomID, playerID)).length;
    }

    private getConnectedPlayers(roomID: MatchID): readonly PlayerID[] {
      const connectedPlayers = new Set<PlayerID>();

      for (const socket of this.ctx.getWebSockets()) {
        const attachment = socket.deserializeAttachment() as SocketAttachment | null;
        if (attachment === null || attachment.scope !== "game") continue;
        if (attachment.roomID !== roomID) continue;
        connectedPlayers.add(attachment.playerID);
      }

      return [...connectedPlayers];
    }

    private broadcastGameDeliveries(
      roomID: MatchID,
      deliveries: readonly { message: unknown; playerID: PlayerID }[],
    ): void {
      if (deliveries.length === 0) return;

      const allSockets = this.ctx.getWebSockets();

      for (const delivery of deliveries) {
        const serialized = stringifyProtocolServerMessage(delivery.message as never);

        for (const socket of allSockets) {
          const attachment = socket.deserializeAttachment() as SocketAttachment | null;
          if (attachment === null || attachment.scope !== "game") continue;
          if (attachment.roomID !== roomID) continue;
          if (attachment.playerID !== delivery.playerID) continue;

          try {
            socket.send(serialized);
          } catch {}
        }
      }
    }

    private sendGameDeliveriesToSocket(
      socket: WebSocket,
      deliveries: readonly { message: unknown; playerID: PlayerID }[],
    ): void {
      const attachment = socket.deserializeAttachment() as SocketAttachment | null;

      if (attachment === null || attachment.scope !== "game") return;

      for (const delivery of deliveries) {
        if (delivery.playerID !== attachment.playerID) continue;
        try {
          socket.send(stringifyProtocolServerMessage(delivery.message as never));
        } catch {}
      }
    }
  }

  const handler: ExportedHandler<GameWorkerEnv> = {
    async fetch(request, env): Promise<Response> {
      const url = new URL(request.url);

      if (url.pathname === "/__info") {
        return respondInfo(erasedDeployment);
      }

      const connect = url.pathname.match(/^\/rooms\/([^/]+)\/connect$/u);
      if (connect !== null) {
        return dispatchConnect({
          deployment: erasedDeployment,
          env,
          request,
          roomID: connect[1] ?? "",
        });
      }

      const bootstrap = url.pathname.match(/^\/rooms\/([^/]+)\/bootstrap$/u);
      if (bootstrap !== null) {
        return dispatchBootstrap({
          env,
          request,
          roomID: bootstrap[1] ?? "",
        });
      }

      const roomState = url.pathname.match(/^\/rooms\/([^/]+)\/room-state$/u);
      if (roomState !== null) {
        return dispatchRoomState({ env, roomID: roomState[1] ?? "", request });
      }

      const lookup = url.pathname.match(/^\/rooms\/([^/]+)\/lookup$/u);
      if (lookup !== null) {
        return dispatchLookup({ env, roomID: lookup[1] ?? "", request });
      }

      return Response.json({ error: "unknown_route" }, { status: 404 });
    },
  };

  return {
    default: handler,
    GameRoom: GameRoom as unknown as DurableObjectConstructor<GameWorkerEnv>,
  };
}

async function dispatchConnect(input: {
  deployment: GameDeployment;
  env: GameWorkerEnv;
  request: Request;
  roomID: string;
}): Promise<Response> {
  if (input.request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
    return Response.json({ error: "expected_websocket_upgrade" }, { status: 426 });
  }

  const url = new URL(input.request.url);
  const token = url.searchParams.get("token");
  if (token === null) {
    return Response.json({ error: "missing_room_token" }, { status: 401 });
  }

  const claims = await verifyRoomToken(token, input.env.ROOM_TOKEN_SECRET);
  if (claims === null) {
    return Response.json({ error: "invalid_room_token" }, { status: 401 });
  }

  if (claims.roomID !== input.roomID) {
    return Response.json({ error: "room_token_mismatch" }, { status: 401 });
  }

  if (claims.scope === "game") {
    if (claims.playerID === null || !isDeploymentPlayer(input.deployment, claims.playerID)) {
      return Response.json({ error: "player_not_in_deployment" }, { status: 403 });
    }
  }

  const namespace = input.env.GAME_ROOM;
  const stub = namespace.get(namespace.idFromName(claims.roomID));
  const headers = new Headers(input.request.headers);
  headers.set("x-openturn-claims", JSON.stringify(claims));
  headers.set(
    "x-openturn-websocket-url",
    `${url.protocol}//${url.host}${url.pathname}`,
  );

  const forwarded = new Request(new URL("/__connect", input.request.url), {
    method: "GET",
    headers,
  });

  return stub.fetch(forwarded);
}

async function dispatchBootstrap(input: {
  env: GameWorkerEnv;
  request: Request;
  roomID: string;
}): Promise<Response> {
  const payload = (await input.request.json().catch(() => null)) as {
    playerID?: PlayerID;
    token?: string;
    initialNow?: number;
  } | null;

  if (payload === null || typeof payload.playerID !== "string" || typeof payload.token !== "string") {
    return Response.json({ error: "invalid_bootstrap_request" }, { status: 400 });
  }

  const claims = await verifyRoomToken(payload.token, input.env.ROOM_TOKEN_SECRET);

  if (
    claims === null
    || claims.roomID !== input.roomID
    || claims.scope !== "game"
    || claims.playerID !== payload.playerID
  ) {
    return Response.json({ error: "invalid_room_token" }, { status: 401 });
  }

  const namespace = input.env.GAME_ROOM;
  const stub = namespace.get(namespace.idFromName(input.roomID));

  // Cloud proxy injects its own origin as `x-openturn-cloud-base`; forward it
  // into the DO so it can call back to /api/profiles/* without an env binding.
  const cloudAPIBase = input.request.headers.get("x-openturn-cloud-base");

  const response = await stub.fetch("https://game-room.internal/__bootstrap", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      playerID: payload.playerID,
      roomID: input.roomID,
      ...(payload.initialNow === undefined ? {} : { initialNow: payload.initialNow }),
      ...(cloudAPIBase !== null ? { cloudAPIBase } : {}),
    }),
  });

  return response;
}

async function dispatchRoomState(input: {
  env: GameWorkerEnv;
  roomID: string;
  request: Request;
}): Promise<Response> {
  const url = new URL(input.request.url);
  const token = url.searchParams.get("token");
  if (token === null) {
    return Response.json({ error: "missing_room_token" }, { status: 401 });
  }
  const claims = await verifyRoomToken(token, input.env.ROOM_TOKEN_SECRET);
  if (claims === null || claims.roomID !== input.roomID) {
    return Response.json({ error: "invalid_room_token" }, { status: 401 });
  }

  const namespace = input.env.GAME_ROOM;
  const stub = namespace.get(namespace.idFromName(input.roomID));
  return stub.fetch("https://game-room.internal/__room_state");
}

async function dispatchLookup(input: {
  env: GameWorkerEnv;
  roomID: string;
  request: Request;
}): Promise<Response> {
  const url = new URL(input.request.url);
  const token = url.searchParams.get("token");
  if (token === null) {
    return Response.json({ error: "missing_room_token" }, { status: 401 });
  }
  const claims = await verifyRoomToken(token, input.env.ROOM_TOKEN_SECRET);
  if (claims === null || claims.roomID !== input.roomID) {
    return Response.json({ error: "invalid_room_token" }, { status: 401 });
  }

  const namespace = input.env.GAME_ROOM;
  const stub = namespace.get(namespace.idFromName(input.roomID));
  const lookupURL = new URL("https://game-room.internal/__lookup");
  lookupURL.searchParams.set("userID", claims.userID);
  return stub.fetch(lookupURL.toString());
}

function respondInfo(deployment: GameDeployment): Response {
  const { players, minPlayers, maxPlayers } = extractMultiplayerFromMatch(deployment.match);
  const info: GameWorkerInfoResponse = {
    deploymentVersion: deployment.deploymentVersion,
    gameKey: deployment.gameKey,
    players,
    minPlayers,
    maxPlayers,
    schemaVersion: deployment.schemaVersion,
  };
  return Response.json(info);
}

function isDeploymentPlayer(deployment: GameDeployment, playerID: PlayerID): boolean {
  const { players } = extractMultiplayerFromMatch(deployment.match);
  return players.length === 0 || players.includes(playerID);
}

function playerTag(roomID: string, playerID: string): string {
  return `player:${roomID}:${playerID}`;
}

function lobbyTag(roomID: string, userID: string): string {
  return `lobby:${roomID}:${userID}`;
}

function appendQueryParam(baseURL: string, name: string, value: string): string {
  const wsURL = new URL(baseURL);
  wsURL.protocol =
    wsURL.protocol === "https:"
      ? "wss:"
      : wsURL.protocol === "http:"
        ? "ws:"
        : wsURL.protocol;
  wsURL.searchParams.set(name, value);
  return wsURL.toString();
}

function bindGameClientMessage(
  message: ProtocolClientMessage,
  attachment: Extract<SocketAttachment, { scope: "game" }>,
): ProtocolClientMessage {
  switch (message.type) {
    case "action":
    case "resync":
    case "sync":
    case "save-request":
      return {
        ...message,
        matchID: attachment.roomID,
        playerID: attachment.playerID,
      };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createStoragePersistence(storage: DurableObjectStorage): RoomPersistence {
  return {
    async load(_roomID) {
      const value = await storage.get<Record<string, unknown>>(PERSISTENCE_KEY);
      if (value === undefined) return null;
      try {
        return parseRoomPersistenceRecord(value);
      } catch {
        return null;
      }
    },
    async save(record: RoomPersistenceRecord) {
      await storage.put(PERSISTENCE_KEY, record as unknown as Record<string, unknown>);
    },
  };
}
