#!/usr/bin/env bun
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

import chokidar from "chokidar";

import { Database } from "bun:sqlite";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import { getSchema } from "better-auth/db";
import { anonymous } from "better-auth/plugins/anonymous";
import { bearer } from "better-auth/plugins/bearer";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import {
  buildOpenturnProject,
  loadOpenturnProjectDeployment,
  resolveOpenturnProject,
  type BuildOpenturnProjectResult,
  type OpenturnDeploymentManifest,
  type OpenturnDeploymentRuntime,
  type OpenturnShellControlsConfig,
} from "@openturn/deploy";
import { parseJsonText, stringifyJson } from "@openturn/json";
import {
  parseLobbyClientMessageText,
  parseProtocolClientMessageText,
  stringifyLobbyServerMessage,
  stringifyProtocolServerMessage,
  type LobbyClientMessage,
  type LobbyServerMessage,
} from "@openturn/protocol";

import {
  BotDriver,
  createRoomRuntime,
  decodeSave,
  encodeSave,
  LobbyRuntime,
  loadGameDeployment,
  parseRoomPersistenceRecord,
  resolveBotMap,
  SAVE_FORMAT_VERSION,
  SaveDecodeError,
  signRoomToken,
  type BotRegistryShape,
  type GameDeployment,
  type InitialSavedSnapshot,
  type LobbyEnv,
  type RoomPersistence,
  type RoomPersistenceRecord,
  type RoomRuntime,
  type RoomSaveHandler,
  type SavedGamePayload,
} from "@openturn/server";
import type { ProtocolClientMessage } from "@openturn/protocol";

import { DEFAULT_CLOUD_URL, cloudDeploy, loadCloudAuth, saveCloudAuth } from "./cloud";
import { startDevBundleServer, type DevBundleServer } from "./dev-bundle";
import { getInitialThemeScript } from "@openturn/bridge";

import { getDevPlayAppBundle, getDevPlayAppTailwind } from "./play-app-bundle";
import { loadTelemetryConfig } from "./telemetry/config";
import { createTelemetryClient, ensureTelemetryConfig } from "./telemetry/client";
import { printFirstRunNotice } from "./telemetry/notice";

// Bind explicitly to loopback. The dev server runs in `auth: "none"` mode
// and reads identity from `?userID=`, so reachability beyond the local
// machine would be a real impersonation surface. "localhost" can resolve to
// other interfaces in some configurations; "127.0.0.1" cannot.
const LOCAL_DEV_HOST = "127.0.0.1";
// Friendlier hostname for printed URLs / browser-launch.
const LOCAL_DEV_DISPLAY_HOST = "localhost";
const CREATE_TEMPLATES = ["local", "multiplayer"] as const;
const LOCAL_DEV_PORT_GUARD_HOSTS = ["127.0.0.1", "::1"] as const;

type CreateTemplate = typeof CREATE_TEMPLATES[number];

async function assertLocalDevPortAvailable(port: number): Promise<void> {
  if (!Number.isInteger(port) || port <= 0) return;

  const occupied: string[] = [];
  for (const host of LOCAL_DEV_PORT_GUARD_HOSTS) {
    if (await canConnectToLocalPort(host, port)) {
      occupied.push(host);
    }
  }

  if (occupied.length === 0) return;
  throw new Error(
    `Port ${port} is already in use on localhost (${occupied.join(", ")}). Stop the existing openturn dev server or choose a different --port.`,
  );
}

function canConnectToLocalPort(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host, port });
    let settled = false;
    const done = (value: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
    socket.setTimeout(250, () => done(false));
  });
}

const roomsTable = sqliteTable("openturn_rooms", {
  branch: text("branch").notNull(),
  checkpoint: text("checkpoint").notNull(),
  createdAt: integer("created_at").notNull(),
  deploymentVersion: text("deployment_version").notNull(),
  initialNow: integer("initial_now").notNull(),
  log: text("log").notNull(),
  match: text("match").notNull(),
  revision: integer("revision").notNull(),
  roomID: text("room_id").primaryKey(),
  seed: text("seed").notNull(),
});

const roomPlayersTable = sqliteTable("openturn_room_players", {
  assignedAt: integer("assigned_at").notNull(),
  playerID: text("player_id").notNull(),
  roomID: text("room_id").notNull(),
  userID: text("user_id").notNull(),
});

const savesTable = sqliteTable("openturn_saves", {
  blob: text("blob").notNull(),
  createdAt: integer("created_at").notNull(),
  createdByUserID: text("created_by_user_id").notNull(),
  deploymentVersion: text("deployment_version").notNull(),
  gameKey: text("game_key").notNull(),
  id: text("id").primaryKey(),
  roomIDOrigin: text("room_id_origin").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
});

const auditEventsTable = sqliteTable("openturn_audit_events", {
  at: integer("at").notNull(),
  eventID: text("event_id").primaryKey(),
  payload: text("payload").notNull(),
  roomID: text("room_id").notNull(),
  type: text("type").notNull(),
});

const authUsersTable = sqliteTable("user", {
  createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull(),
  email: text("email").notNull(),
  emailVerified: integer("emailVerified", { mode: "boolean" }).notNull().default(false),
  id: text("id").primaryKey(),
  image: text("image"),
  isAnonymous: integer("isAnonymous", { mode: "boolean" }).default(false),
  name: text("name").notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull(),
});

const authSessionsTable = sqliteTable("session", {
  createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull(),
  expiresAt: integer("expiresAt", { mode: "timestamp_ms" }).notNull(),
  id: text("id").primaryKey(),
  ipAddress: text("ipAddress"),
  token: text("token").notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull(),
  userAgent: text("userAgent"),
  userId: text("userId").notNull(),
});

const authAccountsTable = sqliteTable("account", {
  accessToken: text("accessToken"),
  accessTokenExpiresAt: integer("accessTokenExpiresAt", { mode: "timestamp_ms" }),
  accountId: text("accountId").notNull(),
  createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull(),
  id: text("id").primaryKey(),
  idToken: text("idToken"),
  password: text("password"),
  providerId: text("providerId").notNull(),
  refreshToken: text("refreshToken"),
  refreshTokenExpiresAt: integer("refreshTokenExpiresAt", { mode: "timestamp_ms" }),
  scope: text("scope"),
  updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull(),
  userId: text("userId").notNull(),
});

const authVerificationsTable = sqliteTable("verification", {
  createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull(),
  expiresAt: integer("expiresAt", { mode: "timestamp_ms" }).notNull(),
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull(),
  value: text("value").notNull(),
});

export interface LocalDevServerOptions {
  /**
   * "dev" (default) sets up better-auth with anonymous sign-in for local
   * development. "none" skips better-auth entirely and derives userIDs from
   * `?userID=` on each request (or generates a random UUID per request) —
   * matches the production-shape used by `openturn start`, where auth is
   * expected to be layered externally.
   */
  auth?: "dev" | "none";
  dbPath?: string;
  deployment: GameDeployment;
  iframe?: {
    bundleURL: string;
    deploymentID: string;
    gameName: string;
    shellControls?: OpenturnShellControlsConfig;
  };
  port?: number;
  secret?: string;
  static?: {
    deploymentID: string;
    gameName: string;
    outDir: string;
    /**
     * When false, serve the built `<outDir>/index.html` directly at `/` and
     * `/play/{deploymentID}` instead of the inspector play shell. Default true.
     */
    shell?: boolean;
    shellControls?: OpenturnShellControlsConfig;
  };
}

export interface LocalDevServer {
  port: number;
  stop(): Promise<void>;
  swapDeployment(next: GameDeployment): Promise<void>;
  url: string;
}

export async function startLocalDevServer(options: LocalDevServerOptions): Promise<LocalDevServer> {
  const port = options.port ?? 4010;
  await assertLocalDevPortAvailable(port);
  const url = `http://${LOCAL_DEV_DISPLAY_HOST}:${port}`;
  const secret = options.secret ?? "openturn-local-dev-secret-1234567890";
  const dbPath = options.dbPath ?? resolve(process.cwd(), ".openturn/local-dev.sqlite");
  ensureSQLiteDatabaseParentDirectory(dbPath);
  const sqlite = new Database(dbPath, {
    create: true,
  });
  const drizzleDB = drizzle({ client: sqlite });

  let currentDeployment = options.deployment;
  const authMode = options.auth ?? "dev";

  bootstrapLocalTables(sqlite);

  const auth = authMode === "dev" ? betterAuth({
    basePath: "/api/auth",
    baseURL: url,
    database: drizzleAdapter(drizzleDB, {
      provider: "sqlite",
      schema: {
        account: authAccountsTable,
        session: authSessionsTable,
        user: authUsersTable,
        verification: authVerificationsTable,
      },
    }),
    plugins: [bearer(), anonymous()],
    rateLimit: {
      enabled: false,
    },
    secret,
  }) : null;
  if (auth !== null) {
    bootstrapBetterAuthTables(sqlite, auth.options);
  }

  const roomPersistence = createSQLiteRoomPersistence(drizzleDB);
  const saveSecret = secret;

  const saveHandler: RoomSaveHandler<GameDeployment["game"]> = async (input) => {
    const saveID = `save_${crypto.randomUUID()}`;
    const payload: SavedGamePayload = {
      branch: input.branch,
      checkpoint: input.snapshot as never,
      deploymentVersion: currentDeployment.deploymentVersion,
      gameKey: currentDeployment.gameKey,
      initialNow: input.initialNow,
      match: input.match as never,
      revision: input.revision,
      roomIDOrigin: input.matchID,
      savedAt: Date.now(),
      savedByUserID: input.playerID,
      saveFormatVersion: SAVE_FORMAT_VERSION,
      schemaVersion: currentDeployment.schemaVersion,
      seed: input.seed,
    };
    const blob = await encodeSave(payload, saveSecret);
    const blobBase64 = Buffer.from(blob).toString("base64");
    drizzleDB.insert(savesTable).values({
      blob: blobBase64,
      createdAt: Date.now(),
      createdByUserID: input.playerID,
      deploymentVersion: currentDeployment.deploymentVersion,
      gameKey: currentDeployment.gameKey,
      id: saveID,
      roomIDOrigin: input.matchID,
      sizeBytes: blob.byteLength,
    }).run();
    return { saveID, downloadURL: `/api/dev/saves/${saveID}` };
  };

  const roomRuntimes = new Map<string, Promise<RoomRuntime>>();
  const socketsByRoom = new Map<string, Set<ServerWebSocket>>();
  const botDriversByRoom = new Map<string, BotDriver<any>>();
  // In-memory lobby state per room. Dev-only; lost on restart.
  const lobbiesByRoom = new Map<string, LobbyRuntime>();
  // For each room, track which userID created it (= permanent host for dev).
  const roomHostsByRoom = new Map<string, string>();

  function buildLobbyEnv(hostUserID: string): LobbyEnv {
    const players = [...((currentDeployment.game as { playerIDs: readonly string[] }).playerIDs)];
    const maxPlayers = players.length;
    const minPlayers = (currentDeployment.game as { minPlayers?: number }).minPlayers ?? maxPlayers;
    const knownBots = extractKnownBotsFromGame(currentDeployment.game);
    return {
      hostUserID,
      minPlayers,
      maxPlayers,
      playerIDs: players,
      ...(knownBots === null ? {} : { knownBots }),
    };
  }

  function deploymentWithMatch(match: GameDeployment["match"]): typeof currentDeployment {
    return {
      ...currentDeployment,
      match,
    } as typeof currentDeployment;
  }

  /**
   * Pull `game.bots` (set via `attachBots(game, registry)` in the consumer's
   * bots package) and flatten to `LobbyEnv.knownBots`. The dev server stays
   * decoupled from `@openturn/lobby` — duck-typed access keeps the dev-server
   * dep tree minimal.
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

  function getOrCreateLobby(roomID: string, hostUserID: string): LobbyRuntime {
    const existing = lobbiesByRoom.get(roomID);
    if (existing !== undefined) return existing;
    const runtime = new LobbyRuntime(buildLobbyEnv(hostUserID));
    lobbiesByRoom.set(roomID, runtime);
    return runtime;
  }

  function liveLobbyUserIDs(roomID: string): Set<string> {
    const out = new Set<string>();
    const sockets = socketsByRoom.get(roomID);
    if (sockets === undefined) return out;
    for (const socket of sockets) {
      if (socket.data.scope !== "lobby") continue;
      out.add(socket.data.userID);
    }
    return out;
  }

  function connectedGamePlayerIDs(roomID: string): Set<string> {
    const out = new Set<string>();
    const sockets = socketsByRoom.get(roomID);
    if (sockets === undefined) return out;
    for (const socket of sockets) {
      if (socket.data.scope !== "game") continue;
      if (socket.data.playerID === null) continue;
      out.add(socket.data.playerID);
    }
    return out;
  }

  function sendLobbyToSocket(socket: ServerWebSocket, message: LobbyServerMessage): void {
    try {
      socket.send(stringifyLobbyServerMessage(message));
    } catch {}
  }

  function broadcastLobbyState(roomID: string): void {
    const lobby = lobbiesByRoom.get(roomID);
    if (lobby === undefined) return;
    const message = lobby.buildStateMessage(roomID, liveLobbyUserIDs(roomID));
    const payload = stringifyLobbyServerMessage(message);
    const sockets = socketsByRoom.get(roomID);
    if (sockets === undefined) return;
    for (const socket of sockets) {
      if (socket.data.scope !== "lobby") continue;
      try {
        socket.send(payload);
      } catch {}
    }
  }

  function broadcastLobbyClosed(
    roomID: string,
    reason: "host_left" | "host_close" | "room_closed",
  ): void {
    const sockets = socketsByRoom.get(roomID);
    if (sockets === undefined) return;
    const payload = stringifyLobbyServerMessage({ type: "lobby:closed", reason });
    for (const socket of sockets) {
      if (socket.data.scope !== "lobby") continue;
      try {
        socket.send(payload);
      } catch {}
    }
  }

  function closeLobbySockets(roomID: string, code: number, reason: string): void {
    const sockets = socketsByRoom.get(roomID);
    if (sockets === undefined) return;
    for (const socket of [...sockets]) {
      if (socket.data.scope !== "lobby") continue;
      try {
        socket.close(code, reason);
      } catch {}
    }
  }

  function closeGameSockets(roomID: string, code: number, reason: string): void {
    const sockets = socketsByRoom.get(roomID);
    if (sockets === undefined) return;
    for (const socket of [...sockets]) {
      if (socket.data.scope !== "game") continue;
      try {
        socket.close(code, reason);
      } catch {}
    }
  }

  const server = Bun.serve<SocketData>({
    async fetch(request, bunServer) {
      const requestURL = new URL(request.url);
      const corsOrigin = getAllowedDevCorsOrigin(request);

      if (request.method === "OPTIONS" && isCorsManagedPath(requestURL.pathname) && corsOrigin !== null) {
        return createCorsPreflightResponse(corsOrigin);
      }

      if (auth !== null && requestURL.pathname.startsWith("/api/auth/")) {
        return withCors(await auth.handler(request), corsOrigin);
      }

      if (options.iframe !== undefined) {
        if (request.method === "GET" && (requestURL.pathname === "/" || requestURL.pathname === `/play/${options.iframe.deploymentID}`)) {
          return htmlResponse(createLocalPlayShell({
            bundleURL: options.iframe.bundleURL,
            deploymentID: options.iframe.deploymentID,
            gameName: options.iframe.gameName,
            multiplayer: extractMultiplayerConfig(currentDeployment),
            ...(options.iframe.shellControls === undefined
              ? {}
              : { shellControls: options.iframe.shellControls }),
          }));
        }

        if (request.method === "GET" && requestURL.pathname === "/__openturn/play-app/main.js") {
          const bundle = await getDevPlayAppBundle();
          return new Response(bundle.js, {
            headers: { "Content-Type": bundle.jsContentType, "Cache-Control": "no-store" },
          });
        }

        if (request.method === "GET" && requestURL.pathname === "/__openturn/play-app/tailwind.js") {
          return new Response(getDevPlayAppTailwind(), {
            headers: { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-store" },
          });
        }
      }

      if (options.static !== undefined) {
        const staticOptions = options.static;
        const wantsShell = staticOptions.shell !== false;
        if (request.method === "GET" && (requestURL.pathname === "/" || requestURL.pathname === `/play/${staticOptions.deploymentID}`)) {
          if (wantsShell) {
            return htmlResponse(createLocalPlayShell({
              deploymentID: staticOptions.deploymentID,
              gameName: staticOptions.gameName,
              multiplayer: extractMultiplayerConfig(currentDeployment),
              ...(staticOptions.shellControls === undefined
                ? {}
                : { shellControls: staticOptions.shellControls }),
            }));
          }
          return fileResponse(resolve(staticOptions.outDir, "index.html"), "text/html; charset=utf-8");
        }

        if (request.method === "GET" && requestURL.pathname.startsWith("/__openturn/bundle/")) {
          const relativePath = requestURL.pathname.slice("/__openturn/bundle/".length) || "index.html";
          const resolved = resolveAssetPath(staticOptions.outDir, relativePath);
          if (resolved === null) {
            return jsonResponse({ error: "invalid_asset_path" }, 400);
          }
          return fileResponse(resolved, contentTypeForPath(relativePath));
        }

        if (request.method === "GET" && requestURL.pathname === "/__openturn/play-app/main.js") {
          const bundle = await getDevPlayAppBundle();
          return new Response(bundle.js, {
            headers: { "Content-Type": bundle.jsContentType, "Cache-Control": "no-store" },
          });
        }

        if (request.method === "GET" && requestURL.pathname === "/__openturn/play-app/tailwind.js") {
          return new Response(getDevPlayAppTailwind(), {
            headers: { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-store" },
          });
        }

        if (!wantsShell && request.method === "GET" && requestURL.pathname.startsWith("/assets/")) {
          const relativePath = requestURL.pathname.slice(1);
          const resolved = resolveAssetPath(staticOptions.outDir, relativePath);
          if (resolved === null) {
            return jsonResponse({ error: "invalid_asset_path" }, 400);
          }
          return fileResponse(resolved, contentTypeForPath(relativePath));
        }
      }

      if (requestURL.pathname === "/api/dev/health") {
        return withCors(jsonResponse({
          deploymentVersion: currentDeployment.deploymentVersion,
          gameKey: currentDeployment.gameKey,
          ok: true,
        }), corsOrigin);
      }

      if (auth !== null && requestURL.pathname === "/api/dev/session/anonymous" && request.method === "POST") {
        return withCors(await auth.handler(
          new Request(new URL("/api/auth/sign-in/anonymous", url), {
            headers: request.headers,
            method: "POST",
          }),
        ), corsOrigin);
      }

      if (requestURL.pathname === "/api/dev/me" && request.method === "GET") {
        return withCors(await withSession(request, async ({ session, user }) =>
          jsonResponse({
            session: {
              id: session.id,
              userId: session.userId,
            },
            user: {
              id: user.id,
              name: user.name,
            },
          }),
        ), corsOrigin);
      }

      if (requestURL.pathname === "/api/dev/rooms" && request.method === "POST") {
        return withCors(await withSession(request, async ({ user }) => {
          const roomID = `room_${crypto.randomUUID()}`;
          const now = Date.now();
          const seed = `${roomID}:seed`;
          const runtime = await createRoomRuntime({
            deployment: currentDeployment,
            initialNow: now,
            onSaveRequest: saveHandler,
            persistence: roomPersistence,
            roomID,
            seed,
          });

          roomRuntimes.set(roomID, Promise.resolve(runtime));
          roomHostsByRoom.set(roomID, user.id);
          getOrCreateLobby(roomID, user.id);

          await roomPersistence.save({
            branch: runtime.getState().branch,
            checkpoint: runtime.getState().snapshot,
            deploymentVersion: currentDeployment.deploymentVersion,
            initialNow: now,
            log: runtime.getState().snapshot.log,
            match: { players: (currentDeployment.game as { playerIDs: readonly [string, ...string[]] }).playerIDs },
            roomID,
            seed,
          });
          drizzleDB.insert(auditEventsTable).values({
            at: now,
            eventID: crypto.randomUUID(),
            payload: stringifyJson({
              deploymentVersion: currentDeployment.deploymentVersion,
            }),
            roomID,
            type: "room_created",
          }).run();

          return jsonResponse(
            await buildLobbySnapshotResponse({
              roomID,
              user,
              hostUserID: user.id,
              url,
              secret,
            }),
            201,
          );
        }), corsOrigin);
      }

      const lobbyTokenMatch = requestURL.pathname.match(
        /^\/api\/dev\/rooms\/([^/]+)\/lobby-token$/u,
      );
      if (lobbyTokenMatch !== null && request.method === "POST") {
        return withCors(await withSession(request, async ({ user }) => {
          const roomID = lobbyTokenMatch[1]!;
          const room = drizzleDB.select().from(roomsTable).where(eq(roomsTable.roomID, roomID)).get();
          if (room === undefined) {
            return jsonResponse({ error: "unknown_room" }, 404);
          }
          const hostUserID = roomHostsByRoom.get(roomID) ?? user.id;
          roomHostsByRoom.set(roomID, hostUserID);
          const lobby = getOrCreateLobby(roomID, hostUserID);

          if (lobby.mode === "active") {
            const playerID = lobby.playerIDFor(user.id);
            if (playerID === null) {
              return jsonResponse({ error: "player_not_assigned" }, 403);
            }
            return jsonResponse(
              await buildGameSnapshotResponse({
                hostUserID,
                playerID,
                roomID,
                secret,
                url,
                user,
              }),
            );
          }

          return jsonResponse(
            await buildLobbySnapshotResponse({
              roomID,
              user,
              hostUserID,
              url,
              secret,
            }),
          );
        }), corsOrigin);
      }

      if (requestURL.pathname.match(/^\/api\/dev\/rooms\/[^/]+$/u) && request.method === "GET") {
        return withCors(await withSession(request, async () => {
          const roomID = requestURL.pathname.split("/").at(-1)!;
          const room = drizzleDB.select().from(roomsTable).where(eq(roomsTable.roomID, roomID)).get();

          if (room === undefined) {
            return jsonResponse({ error: "unknown_room" }, 404);
          }

          return jsonResponse({
            deploymentVersion: room.deploymentVersion,
            revision: room.revision,
            roomID,
          });
        }), corsOrigin);
      }

      const roomSaveMatch = requestURL.pathname.match(/^\/api\/dev\/rooms\/([^/]+)\/save$/u);
      if (roomSaveMatch !== null && request.method === "POST") {
        return withCors(await withSession(request, async ({ user }) => {
          const roomID = roomSaveMatch[1]!;
          const runtimePromise = roomRuntimes.get(roomID);
          if (runtimePromise === undefined) {
            return jsonResponse({ error: "room_not_running" }, 404);
          }
          const runtime = await runtimePromise;
          const state = runtime.getState();
          const persisted = await roomPersistence.load(roomID);
          if (persisted === null) {
            return jsonResponse({ error: "room_not_persisted" }, 404);
          }
          const session = (runtime as unknown as { __session?: unknown }).__session;
          void session;
          try {
            const result = await saveHandler({
              branch: state.branch,
              clientRequestID: crypto.randomUUID(),
              initialNow: persisted.initialNow,
              match: persisted.match,
              matchID: roomID,
              playerID: user.id,
              revision: state.revision,
              seed: persisted.seed,
              snapshot: state.snapshot as never,
            });
            return jsonResponse({ saveID: result.saveID, downloadURL: result.downloadURL }, 201);
          } catch (error) {
            return jsonResponse({ error: "save_failed", message: (error as Error).message }, 500);
          }
        }), corsOrigin);
      }

      const saveDownloadMatch = requestURL.pathname.match(/^\/api\/dev\/saves\/([^/]+)$/u);
      if (saveDownloadMatch !== null && request.method === "GET") {
        return withCors(await withSession(request, async () => {
          const saveID = saveDownloadMatch[1]!;
          const row = drizzleDB.select().from(savesTable).where(eq(savesTable.id, saveID)).get();
          if (row === undefined) {
            return jsonResponse({ error: "unknown_save" }, 404);
          }
          const bytes = Buffer.from(row.blob, "base64");
          return new Response(bytes, {
            headers: {
              "Content-Type": "application/octet-stream",
              "Content-Disposition": `attachment; filename="${saveID}.otsave"`,
              "Content-Length": String(bytes.byteLength),
            },
          });
        }), corsOrigin);
      }

      if (requestURL.pathname === "/api/dev/saves" && request.method === "POST") {
        return withCors(await withSession(request, async ({ user }) => {
          const body = await request.arrayBuffer();
          if (body.byteLength === 0) {
            return jsonResponse({ error: "empty_body" }, 400);
          }
          const bytes = new Uint8Array(body);
          let decoded: SavedGamePayload;
          try {
            decoded = await decodeSave(bytes, saveSecret, currentDeployment.deploymentVersion);
          } catch (error) {
            if (error instanceof SaveDecodeError) {
              const status = error.code === "version" ? 409 : 400;
              return jsonResponse({ error: error.code, message: error.message }, status);
            }
            return jsonResponse({ error: "decode_failed", message: (error as Error).message }, 400);
          }
          const saveID = `save_${crypto.randomUUID()}`;
          drizzleDB.insert(savesTable).values({
            blob: Buffer.from(bytes).toString("base64"),
            createdAt: Date.now(),
            createdByUserID: user.id,
            deploymentVersion: decoded.deploymentVersion,
            gameKey: decoded.gameKey,
            id: saveID,
            roomIDOrigin: decoded.roomIDOrigin,
            sizeBytes: bytes.byteLength,
          }).run();
          return jsonResponse({ saveID }, 201);
        }), corsOrigin);
      }

      const newRoomFromSaveMatch = requestURL.pathname.match(
        /^\/api\/dev\/saves\/([^/]+)\/new-room$/u,
      );
      if (newRoomFromSaveMatch !== null && request.method === "POST") {
        return withCors(await withSession(request, async ({ user }) => {
          const saveID = newRoomFromSaveMatch[1]!;
          const row = drizzleDB.select().from(savesTable).where(eq(savesTable.id, saveID)).get();
          if (row === undefined) {
            return jsonResponse({ error: "unknown_save" }, 404);
          }
          const bytes = Buffer.from(row.blob, "base64");
          let decoded: SavedGamePayload;
          try {
            decoded = await decodeSave(bytes, saveSecret, currentDeployment.deploymentVersion);
          } catch (error) {
            if (error instanceof SaveDecodeError) {
              const status = error.code === "version" ? 409 : 400;
              return jsonResponse({ error: error.code, message: error.message }, status);
            }
            return jsonResponse({ error: "decode_failed", message: (error as Error).message }, 400);
          }

          const roomID = `room_${crypto.randomUUID()}`;
          const now = Date.now();
          const initialSavedSnapshot: InitialSavedSnapshot<GameDeployment["game"]> = {
            branch: decoded.branch,
            initialNow: decoded.initialNow,
            match: decoded.match as never,
            revision: decoded.revision,
            seed: decoded.seed,
            snapshot: decoded.checkpoint as never,
          };
          const runtime = await createRoomRuntime({
            deployment: currentDeployment,
            initialNow: now,
            initialSavedSnapshot,
            onSaveRequest: saveHandler,
            persistence: roomPersistence,
            roomID,
            seed: decoded.seed,
          });
          roomRuntimes.set(roomID, Promise.resolve(runtime));
          roomHostsByRoom.set(roomID, user.id);
          getOrCreateLobby(roomID, user.id);

          const state = runtime.getState();
          await roomPersistence.save({
            branch: state.branch,
            checkpoint: state.snapshot,
            deploymentVersion: currentDeployment.deploymentVersion,
            initialNow: decoded.initialNow,
            log: state.snapshot.log,
            match: decoded.match as never,
            roomID,
            seed: decoded.seed,
          });

          drizzleDB.insert(auditEventsTable).values({
            at: now,
            eventID: crypto.randomUUID(),
            payload: stringifyJson({
              deploymentVersion: currentDeployment.deploymentVersion,
              fromSaveID: saveID,
            }),
            roomID,
            type: "room_created_from_save",
          }).run();

          return jsonResponse(
            await buildLobbySnapshotResponse({
              roomID,
              user,
              hostUserID: user.id,
              url,
              secret,
            }),
            201,
          );
        }), corsOrigin);
      }

      const roomResetMatch = requestURL.pathname.match(/^\/api\/dev\/rooms\/([^/]+)\/reset$/u);
      if (roomResetMatch !== null && request.method === "POST") {
        return withCors(await withSession(request, async ({ user }) => {
          const roomID = roomResetMatch[1]!;
          const hostUserID = roomHostsByRoom.get(roomID);
          if (hostUserID === undefined) {
            return jsonResponse({ error: "unknown_room" }, 404);
          }
          if (hostUserID !== user.id) {
            return jsonResponse({ error: "not_host" }, 403);
          }
          const lobby = lobbiesByRoom.get(roomID);
          if (lobby === undefined || lobby.mode !== "active") {
            return jsonResponse({ error: "match_not_active", phase: lobby?.mode ?? "unknown" }, 409);
          }
          const persisted = await roomPersistence.load(roomID);
          if (persisted === null) {
            return jsonResponse({ error: "room_not_persisted" }, 404);
          }

          const now = Date.now();
          const runtime = await createRoomRuntime({
            connectedPlayers: [...connectedGamePlayerIDs(roomID)],
            deployment: deploymentWithMatch(persisted.match as GameDeployment["match"]),
            initialNow: persisted.initialNow,
            onSaveRequest: saveHandler,
            persistence: roomPersistence,
            restorePersistedState: false,
            roomID,
            seed: persisted.seed,
          });
          roomRuntimes.set(roomID, Promise.resolve(runtime));

          const state = runtime.getState();
          await roomPersistence.save({
            branch: state.branch,
            checkpoint: state.snapshot,
            deploymentVersion: currentDeployment.deploymentVersion,
            initialNow: persisted.initialNow,
            log: state.snapshot.log,
            match: persisted.match,
            roomID,
            seed: persisted.seed,
          });
          drizzleDB.insert(auditEventsTable).values({
            at: now,
            eventID: crypto.randomUUID(),
            payload: stringifyJson({
              deploymentVersion: currentDeployment.deploymentVersion,
            }),
            roomID,
            type: "room_reset",
          }).run();

          await syncGameSockets(roomID, runtime);
          await tickBotDriver(roomID, runtime);

          return jsonResponse({ ok: true, roomID, revision: state.revision });
        }), corsOrigin);
      }

      const roomReturnToLobbyMatch = requestURL.pathname.match(
        /^\/api\/dev\/rooms\/([^/]+)\/return-to-lobby$/u,
      );
      if (roomReturnToLobbyMatch !== null && request.method === "POST") {
        return withCors(await withSession(request, async ({ user }) => {
          const roomID = roomReturnToLobbyMatch[1]!;
          const hostUserID = roomHostsByRoom.get(roomID);
          if (hostUserID === undefined) {
            return jsonResponse({ error: "unknown_room" }, 404);
          }
          if (hostUserID !== user.id) {
            return jsonResponse({ error: "not_host" }, 403);
          }
          const lobby = lobbiesByRoom.get(roomID);
          if (lobby === undefined || lobby.mode !== "active") {
            return jsonResponse({ error: "match_not_active", phase: lobby?.mode ?? "unknown" }, 409);
          }
          const persisted = await roomPersistence.load(roomID);
          if (persisted === null) {
            return jsonResponse({ error: "room_not_persisted" }, 404);
          }

          roomRuntimes.delete(roomID);
          botDriversByRoom.delete(roomID);
          closeGameSockets(roomID, 4013, "returning_to_lobby");

          const now = Date.now();
          const runtime = await createRoomRuntime({
            deployment: currentDeployment,
            initialNow: persisted.initialNow,
            onSaveRequest: saveHandler,
            persistence: roomPersistence,
            roomID,
            seed: persisted.seed,
          });
          roomRuntimes.set(roomID, Promise.resolve(runtime));

          const state = runtime.getState();
          await roomPersistence.save({
            branch: state.branch,
            checkpoint: state.snapshot,
            deploymentVersion: currentDeployment.deploymentVersion,
            initialNow: persisted.initialNow,
            log: state.snapshot.log,
            match: persisted.match,
            roomID,
            seed: persisted.seed,
          });

          lobbiesByRoom.set(roomID, new LobbyRuntime(buildLobbyEnv(hostUserID)));
          broadcastLobbyState(roomID);

          drizzleDB.insert(auditEventsTable).values({
            at: now,
            eventID: crypto.randomUUID(),
            payload: stringifyJson({
              deploymentVersion: currentDeployment.deploymentVersion,
            }),
            roomID,
            type: "room_returned_to_lobby",
          }).run();

          return jsonResponse({ ok: true, roomID });
        }), corsOrigin);
      }

      if (requestURL.pathname === "/api/dev/local/saves" && request.method === "POST") {
        return withCors(await withSession(request, async ({ user }) => {
          let body: {
            branch?: unknown;
            checkpoint?: unknown;
            initialNow?: unknown;
            match?: unknown;
            revision?: unknown;
            seed?: unknown;
          };
          try {
            body = (await request.json()) as typeof body;
          } catch {
            return jsonResponse({ error: "invalid_json" }, 400);
          }
          if (
            body.branch === undefined
            || body.checkpoint === undefined
            || typeof body.initialNow !== "number"
            || body.match === undefined
            || typeof body.revision !== "number"
            || typeof body.seed !== "string"
          ) {
            return jsonResponse({ error: "invalid_body" }, 400);
          }
          const saveID = `save_${crypto.randomUUID()}`;
          const payload: SavedGamePayload = {
            branch: body.branch as SavedGamePayload["branch"],
            checkpoint: body.checkpoint as SavedGamePayload["checkpoint"],
            deploymentVersion: currentDeployment.deploymentVersion,
            gameKey: currentDeployment.gameKey,
            initialNow: body.initialNow,
            match: body.match as SavedGamePayload["match"],
            revision: body.revision,
            roomIDOrigin: "local",
            savedAt: Date.now(),
            savedByUserID: user.id,
            saveFormatVersion: SAVE_FORMAT_VERSION,
            schemaVersion: currentDeployment.schemaVersion,
            seed: body.seed,
          };
          const blob = await encodeSave(payload, saveSecret);
          const blobBase64 = Buffer.from(blob).toString("base64");
          drizzleDB.insert(savesTable).values({
            blob: blobBase64,
            createdAt: Date.now(),
            createdByUserID: user.id,
            deploymentVersion: currentDeployment.deploymentVersion,
            gameKey: currentDeployment.gameKey,
            id: saveID,
            roomIDOrigin: "local",
            sizeBytes: blob.byteLength,
          }).run();
          return jsonResponse({ saveID, downloadURL: `/api/dev/saves/${saveID}` }, 201);
        }), corsOrigin);
      }

      const saveDecodedMatch = requestURL.pathname.match(
        /^\/api\/dev\/saves\/([^/]+)\/decoded$/u,
      );
      if (saveDecodedMatch !== null && request.method === "GET") {
        return withCors(await withSession(request, async () => {
          const saveID = saveDecodedMatch[1]!;
          const row = drizzleDB.select().from(savesTable).where(eq(savesTable.id, saveID)).get();
          if (row === undefined) {
            return jsonResponse({ error: "unknown_save" }, 404);
          }
          const bytes = Buffer.from(row.blob, "base64");
          let decoded: SavedGamePayload;
          try {
            decoded = await decodeSave(bytes, saveSecret, currentDeployment.deploymentVersion);
          } catch (error) {
            if (error instanceof SaveDecodeError) {
              const status = error.code === "version" ? 409 : 400;
              return jsonResponse({ error: error.code, message: error.message }, status);
            }
            return jsonResponse({ error: "decode_failed", message: (error as Error).message }, 400);
          }
          return jsonResponse({
            branch: decoded.branch,
            checkpoint: decoded.checkpoint,
            deploymentVersion: decoded.deploymentVersion,
            gameKey: decoded.gameKey,
            initialNow: decoded.initialNow,
            match: decoded.match,
            revision: decoded.revision,
            roomIDOrigin: decoded.roomIDOrigin,
            savedAt: decoded.savedAt,
            seed: decoded.seed,
          });
        }), corsOrigin);
      }

      if (requestURL.pathname.match(/^\/api\/dev\/rooms\/[^/]+\/presence$/u) && request.method === "GET") {
        return withCors(await withSession(request, async () => {
          const roomID = requestURL.pathname.split("/")[4]!;
          const lobby = lobbiesByRoom.get(roomID);
          if (lobby === undefined) {
            return jsonResponse({ error: "unknown_room" }, 404);
          }

          const connectedLobbyUserIDs = liveLobbyUserIDs(roomID);
          const baseMessage = lobby.buildStateMessage(roomID, connectedLobbyUserIDs);
          const connectedPlayerIDs = [...connectedGamePlayerIDs(roomID)];
          const connectedPlayerIDSet = new Set(connectedPlayerIDs);

          const seats = baseMessage.phase === "active"
            ? baseMessage.seats.map((seat) => {
                if (seat.kind !== "human") return seat;
                const playerID = lobby.playerIDFor(seat.userID);
                const connected = playerID !== null && connectedPlayerIDSet.has(playerID);
                return { ...seat, connected };
              })
            : baseMessage.seats;

          return jsonResponse({
            roomID,
            phase: baseMessage.phase,
            hostUserID: baseMessage.hostUserID,
            minPlayers: baseMessage.minPlayers,
            maxPlayers: baseMessage.maxPlayers,
            targetCapacity: baseMessage.targetCapacity,
            seats,
            connectedPlayerIDs,
          });
        }), corsOrigin);
      }

      if (requestURL.pathname.match(/^\/api\/dev\/rooms\/[^/]+\/join-token$/u) && request.method === "POST") {
        return withCors(
          jsonResponse(
            {
              error: "endpoint_removed",
              code: "use_lobby_token",
              message:
                "Game tokens are delivered over the lobby websocket. POST /api/dev/rooms/:roomID/lobby-token to enter the room.",
            },
            410,
          ),
          corsOrigin,
        );
      }

      if (requestURL.pathname.match(/^\/api\/dev\/rooms\/[^/]+\/bootstrap$/u) && request.method === "GET") {
        return withCors(await withSession(request, async ({ user }) => {
          const roomID = requestURL.pathname.split("/")[4]!;
          const lobby = lobbiesByRoom.get(roomID);
          const playerID = lobby?.playerIDFor(user.id) ?? null;

          if (playerID === null) {
            return jsonResponse({ error: "player_not_assigned" }, 403);
          }

          const runtime = await getRoomRuntime(roomID);
          const envelopes = await runtime.handleClientMessage({
            type: "sync",
            matchID: roomID,
            playerID,
          });

          return jsonResponse(envelopes[0]?.message ?? null);
        }), corsOrigin);
      }

      const websocketMatch = requestURL.pathname.match(/^\/rooms\/([^/]+)\/connect$/u);

      if (websocketMatch !== null) {
        return handleWebSocketUpgrade({
          request,
          requestURL,
          roomID: websocketMatch[1]!,
          secret,
          server: bunServer,
        });
      }

      return withCors(jsonResponse({ error: "not_found" }, 404), corsOrigin);
    },
    hostname: LOCAL_DEV_HOST,
    port,
    websocket: {
      async close(ws) {
        const listeners = socketsByRoom.get(ws.data.roomID);
        listeners?.delete(ws);
        if (listeners?.size === 0) {
          socketsByRoom.delete(ws.data.roomID);
        }

        if (ws.data.scope === "lobby") {
          const lobby = lobbiesByRoom.get(ws.data.roomID);
          if (lobby === undefined) return;
          if (countLobbySocketsForUser(listeners, ws.data.userID) > 0) return;
          const drop = lobby.dropUser(ws.data.userID);
          if (!drop.changed) return;
          if (drop.shouldCloseRoom) {
            broadcastLobbyClosed(ws.data.roomID, "host_left");
            closeLobbySockets(ws.data.roomID, 4010, "host_left");
          } else {
            broadcastLobbyState(ws.data.roomID);
          }
          return;
        }

        if (ws.data.playerID === null) return;
        if (countSocketsForPlayer(listeners, ws.data.playerID) > 0) return;

        const runtime = await getRoomRuntime(ws.data.roomID);
        runtime.disconnect(ws.data.playerID);
      },
      async message(ws, rawMessage) {
        if (ws.data.scope === "lobby") {
          await handleLobbyWsMessage(ws, rawMessage.toString());
          return;
        }

        let parsed: ProtocolClientMessage;
        try {
          parsed = parseProtocolClientMessageText(rawMessage.toString()) as ProtocolClientMessage;
        } catch {
          return;
        }

        const runtime = await getRoomRuntime(ws.data.roomID);
        const deliveries = await runtime.handleClientMessage(
          bindSocketClientMessage(parsed, ws.data),
        );

        broadcastDeliveries(ws.data.roomID, deliveries);
        await tickBotDriver(ws.data.roomID, runtime);
      },
      async open(ws) {
        const listeners = socketsByRoom.get(ws.data.roomID) ?? new Set<ServerWebSocket>();
        listeners.add(ws);
        socketsByRoom.set(ws.data.roomID, listeners);

        if (ws.data.scope === "lobby") {
          const lobby = lobbiesByRoom.get(ws.data.roomID);
          if (lobby === undefined) {
            sendLobbyToSocket(ws, {
              type: "lobby:closed",
              reason: "room_closed",
            });
            try {
              ws.close(4011, "room_not_initialised");
            } catch {}
            return;
          }
          sendLobbyToSocket(
            ws,
            lobby.buildStateMessage(ws.data.roomID, liveLobbyUserIDs(ws.data.roomID)),
          );
          broadcastLobbyState(ws.data.roomID);
          return;
        }

        const gamePlayerID = ws.data.playerID;
        if (gamePlayerID === null) return;
        const runtime = await getRoomRuntime(ws.data.roomID);
        const deliveries =
          countSocketsForPlayer(listeners, gamePlayerID) === 1
            ? await runtime.connect(gamePlayerID)
            : await runtime.handleClientMessage({
                type: "sync",
                matchID: ws.data.roomID,
                playerID: gamePlayerID,
              });

        sendDeliveriesToSocket(ws, deliveries);
      },
    },
  });

  return {
    port: server.port ?? port,
    async stop() {
      server.stop(true);
      botDriversByRoom.clear();
      sqlite.close();
    },
    async swapDeployment(next) {
      currentDeployment = next;
      roomRuntimes.clear();
      botDriversByRoom.clear();

      for (const sockets of socketsByRoom.values()) {
        for (const socket of sockets) {
          try {
            socket.close(4003, "deployment_swap");
          } catch {}
        }
      }

      socketsByRoom.clear();
    },
    url,
  };

  function broadcastDeliveries(roomID: string, deliveries: readonly { message: unknown; playerID: string }[]) {
    const sockets = socketsByRoom.get(roomID);
    if (sockets === undefined) return;

    for (const delivery of deliveries) {
      for (const socket of sockets) {
        if (socket.data.scope !== "game") continue;
        if (socket.data.playerID !== delivery.playerID) continue;
        socket.send(stringifyProtocolServerMessage(delivery.message as never));
      }
    }
  }

  async function tickBotDriver(roomID: string, runtime: RoomRuntime): Promise<void> {
    const driver = botDriversByRoom.get(roomID);
    if (driver === undefined) return;
    try {
      await driver.tick({
        session: runtime.getSession() as never,
        matchID: roomID,
        dispatch: async (message) => {
          const deliveries = await runtime.handleClientMessage(message);
          broadcastDeliveries(roomID, deliveries);
          return deliveries;
        },
      });
    } catch {
      // Individual bot decisions are contained by BotDriver; this catches
      // runtime-level dispatch failures so the dev server stays responsive.
    }
  }

  function sendDeliveriesToSocket(
    socket: ServerWebSocket,
    deliveries: readonly { message: unknown; playerID: string }[],
  ) {
    if (socket.data.scope !== "game") return;
    for (const delivery of deliveries) {
      if (socket.data.playerID !== delivery.playerID) continue;
      socket.send(stringifyProtocolServerMessage(delivery.message as never));
    }
  }

  async function syncGameSockets(roomID: string, runtime: RoomRuntime): Promise<void> {
    const sockets = socketsByRoom.get(roomID);
    if (sockets === undefined) return;

    await Promise.all([...sockets].map(async (socket) => {
      if (socket.data.scope !== "game" || socket.data.playerID === null) return;
      const deliveries = await runtime.handleClientMessage({
        type: "sync",
        matchID: roomID,
        playerID: socket.data.playerID,
      });
      sendDeliveriesToSocket(socket, deliveries);
    }));
  }

  async function getRoomRuntime(roomID: string) {
    const existingRuntime = roomRuntimes.get(roomID);

    if (existingRuntime !== undefined) {
      return existingRuntime;
    }

    const nextRuntime = createRoomRuntime({
      deployment: currentDeployment,
      onSaveRequest: saveHandler,
      persistence: roomPersistence,
      roomID,
    });
    roomRuntimes.set(roomID, nextRuntime);
    return nextRuntime;
  }

  async function handleWebSocketUpgrade(input: {
    request: Request;
    requestURL: URL;
    roomID: string;
    secret: string;
    server: Bun.Server<SocketData>;
  }) {
    const token = input.requestURL.searchParams.get("token");

    if (token === null) {
      return jsonResponse({ error: "missing_token" }, 401);
    }

    const claims = await import("@openturn/server").then(({ verifyRoomToken }) =>
      verifyRoomToken(token, input.secret),
    );

    if (claims === null || claims.roomID !== input.roomID) {
      return jsonResponse({ error: "invalid_token" }, 401);
    }

    const userName = input.request.headers.get("x-openturn-user-name");

    if (claims.scope === "lobby") {
      const lobby = lobbiesByRoom.get(claims.roomID);
      if (lobby === undefined) {
        return jsonResponse({ error: "unknown_room" }, 404);
      }
      if (lobby.mode === "active") {
        return jsonResponse({ error: "room_already_started" }, 409);
      }
      if (lobby.mode === "closed") {
        return jsonResponse({ error: "room_closed" }, 410);
      }

      const upgraded = input.server.upgrade(input.request, {
        data: {
          scope: "lobby",
          roomID: claims.roomID,
          userID: claims.userID,
          userName,
          playerID: null,
        } satisfies SocketData,
      });
      if (!upgraded) {
        return jsonResponse({ error: "websocket_upgrade_failed" }, 500);
      }
      return undefined;
    }

    // scope === "game"
    if (claims.playerID === null) {
      return jsonResponse({ error: "missing_player_id" }, 400);
    }

    const lobby = lobbiesByRoom.get(claims.roomID);
    if (lobby === undefined || lobby.mode !== "active") {
      return jsonResponse({ error: "room_not_started" }, 409);
    }
    const expected = lobby.playerIDFor(claims.userID);
    // The CLI-only "watch the bots" path mints the host a game token bound
    // to seat 0's playerID even though the host never took a seat. Skip the
    // seat-mismatch check for the room host so they can ride along on
    // player 0's broadcast — the token signature is still verified above.
    const isHostObserver =
      expected === null && claims.userID === roomHostsByRoom.get(claims.roomID);
    if (expected !== claims.playerID && !isHostObserver) {
      return jsonResponse({ error: "seat_mismatch" }, 403);
    }

    const upgraded = input.server.upgrade(input.request, {
      data: {
        scope: "game",
        roomID: claims.roomID,
        userID: claims.userID,
        userName: null,
        playerID: claims.playerID,
      } satisfies SocketData,
    });

    if (!upgraded) {
      return jsonResponse({ error: "websocket_upgrade_failed" }, 500);
    }

    return undefined;
  }

  async function handleLobbyWsMessage(ws: ServerWebSocket, rawMessage: string) {
    const lobby = lobbiesByRoom.get(ws.data.roomID);
    if (lobby === undefined) return;

    let parsed: LobbyClientMessage;
    try {
      parsed = parseLobbyClientMessageText(rawMessage);
    } catch {
      sendLobbyToSocket(ws, {
        type: "lobby:rejected",
        reason: "unknown",
        message: "could_not_parse_message",
      });
      return;
    }

    if (parsed.type === "lobby:start") {
      const startResult = lobby.start(ws.data.userID);
      if (!startResult.ok) {
        sendLobbyToSocket(ws, {
          type: "lobby:rejected",
          reason: startResult.reason,
          echoType: "lobby:start",
        });
        return;
      }

      // For variable-capacity games, filter the running game's `match.players`
      // down to the seated subset. Without this, an N-of-M lobby would still
      // run the game with M players — leaving M-N never-going turns and
      // never-rendered tableaus. Mirrors the cloud worker's behavior in
      // `packages/server/src/worker.ts` (search for `activePlayerIDs`).
      const activePlayerIDs = startResult.assignments
        .slice()
        .sort((a, b) => a.seatIndex - b.seatIndex)
        .map((a) => a.playerID);
      const gamePlayerIDs = (currentDeployment.game as { playerIDs: readonly [string, ...string[]] }).playerIDs;
      const maxPlayers = gamePlayerIDs.length;
      if (activePlayerIDs.length < maxPlayers) {
        const filteredMatch = {
          players: activePlayerIDs as unknown as readonly [string, ...string[]],
        };
        const startNow = Date.now();
        const startSeed = `${ws.data.roomID}:seed`;
        const filteredRuntime = await createRoomRuntime({
          deployment: deploymentWithMatch(filteredMatch as GameDeployment["match"]),
          initialNow: startNow,
          onSaveRequest: saveHandler,
          persistence: roomPersistence,
          // Skip restoring the prior persisted snapshot — it was made with the
          // maximal player roster from room creation, which no longer matches.
          restorePersistedState: false,
          roomID: ws.data.roomID,
          seed: startSeed,
        });
        roomRuntimes.set(ws.data.roomID, Promise.resolve(filteredRuntime));
        const filteredState = filteredRuntime.getState();
        await roomPersistence.save({
          branch: filteredState.branch,
          checkpoint: filteredState.snapshot,
          deploymentVersion: currentDeployment.deploymentVersion,
          initialNow: startNow,
          log: filteredState.snapshot.log,
          match: filteredMatch,
          roomID: ws.data.roomID,
          seed: startSeed,
        });
      }

      const issuedAt = Math.floor(Date.now() / 1_000);
      const baseWsURL = `${url.replace(/^http/, "ws")}/rooms/${ws.data.roomID}/connect`;

      // Public seat→player map for every recipient (humans + bots). Bot
      // tokens are never sent to clients — they stay server-side and are
      // consumed by the bot supervisor (PR 3).
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

      const transitions: Array<{ userID: string; message: LobbyServerMessage }> = [];
      for (const assignment of startResult.assignments) {
        if (assignment.kind === "bot" || assignment.userID === null) continue;
        const signed = await signRoomToken(
          {
            deploymentVersion: currentDeployment.deploymentVersion,
            exp: issuedAt + 60 * 10,
            iat: issuedAt,
            playerID: assignment.playerID,
            roomID: ws.data.roomID,
            scope: "game",
            userID: assignment.userID,
          },
          secret,
        );
        transitions.push({
          userID: assignment.userID,
          message: {
            type: "lobby:transition_to_game",
            roomID: ws.data.roomID,
            playerID: assignment.playerID,
            roomToken: signed.token,
            tokenExpiresAt: issuedAt + 60 * 10,
            websocketURL: `${baseWsURL}?token=${encodeURIComponent(signed.token)}`,
            playerAssignments,
          },
        });
      }

      const seatedUsers = new Set(
        startResult.assignments
          .filter((a): a is typeof a & { userID: string } => a.userID !== null)
          .map((a) => a.userID),
      );
      const roomHostUserID = roomHostsByRoom.get(ws.data.roomID) ?? null;
      // CLI-only "watch the bots" affordance: when no human took a seat (only
      // possible locally — cloud blocks this via `requireHumanSeat`), mint
      // the host a game token bound to seat 0's playerID so they ride along
      // on player 0's broadcast and can watch the bot vs bot match unfold.
      // The host can technically dispatch as player 0 too, but in practice
      // they're observing — see the changeset for the trade-off.
      const allBotsWithHostObserver =
        seatedUsers.size === 0
        && roomHostUserID !== null
        && startResult.assignments.length > 0;
      if (allBotsWithHostObserver) {
        const seatZeroPlayerID = startResult.assignments[0]!.playerID;
        const signed = await signRoomToken(
          {
            deploymentVersion: currentDeployment.deploymentVersion,
            exp: issuedAt + 60 * 10,
            iat: issuedAt,
            playerID: seatZeroPlayerID,
            roomID: ws.data.roomID,
            scope: "game",
            userID: roomHostUserID,
          },
          secret,
        );
        transitions.push({
          userID: roomHostUserID,
          message: {
            type: "lobby:transition_to_game",
            roomID: ws.data.roomID,
            playerID: seatZeroPlayerID,
            roomToken: signed.token,
            tokenExpiresAt: issuedAt + 60 * 10,
            websocketURL: `${baseWsURL}?token=${encodeURIComponent(signed.token)}`,
            playerAssignments,
          },
        });
      }
      // Sockets to close after the per-socket fan-out. We close each socket
      // explicitly so the host's lobby socket can opt out and remain open
      // when the room started with no human seats (CLI-only "watch the bots
      // play" affordance — cloud blocks the case via `requireHumanSeat`).
      const socketsToClose: ServerWebSocket[] = [];
      const sockets = socketsByRoom.get(ws.data.roomID);
      if (sockets !== undefined) {
        for (const socket of sockets) {
          if (socket.data.scope !== "lobby") continue;
          const transition = transitions.find((entry) => entry.userID === socket.data.userID);
          if (transition !== undefined) {
            try {
              socket.send(stringifyLobbyServerMessage(transition.message));
            } catch {}
            socketsToClose.push(socket);
          } else if (
            !seatedUsers.has(socket.data.userID)
            && socket.data.userID !== roomHostUserID
          ) {
            try {
              socket.send(
                stringifyLobbyServerMessage({
                  type: "lobby:closed",
                  reason: "room_closed",
                }),
              );
            } catch {}
            socketsToClose.push(socket);
          }
          // Host with no seat falls through: socket stays open. The next
          // `broadcastLobbyState` below pushes `phase: "active"` so the
          // lobby UI flips from "Tap Ready" to "Game in progress.".
        }
      }

      const registry = (currentDeployment.game as { bots?: BotRegistryShape<any> }).bots;
      const botMap = resolveBotMap(registry, startResult.assignments);
      if (botMap !== null) {
        botDriversByRoom.set(ws.data.roomID, new BotDriver({
          game: currentDeployment.game,
          bots: botMap,
        }));
        const runtime = await getRoomRuntime(ws.data.roomID);
        await tickBotDriver(ws.data.roomID, runtime);
      } else {
        botDriversByRoom.delete(ws.data.roomID);
      }

      for (const socket of socketsToClose) {
        try {
          socket.close(4010, "lobby_transition");
        } catch {}
      }
      broadcastLobbyState(ws.data.roomID);
      return;
    }

    const result = lobby.apply(ws.data.userID, ws.data.userName ?? null, parsed);
    if (!result.ok) {
      sendLobbyToSocket(ws, {
        type: "lobby:rejected",
        reason: result.reason,
        echoType: parsed.type,
      });
      return;
    }

    if (parsed.type === "lobby:close") {
      broadcastLobbyClosed(ws.data.roomID, "host_close");
      closeLobbySockets(ws.data.roomID, 4011, "host_close");
      return;
    }

    if (result.changed) {
      broadcastLobbyState(ws.data.roomID);
    }
  }

  async function buildLobbySnapshotResponse(input: {
    roomID: string;
    user: { id: string; name?: string | null };
    hostUserID: string;
    url: string;
    secret: string;
  }) {
    const issuedAt = Math.floor(Date.now() / 1_000);
    const ttlSeconds = 60 * 30;
    const signed = await signRoomToken(
      {
        deploymentVersion: currentDeployment.deploymentVersion,
        exp: issuedAt + ttlSeconds,
        iat: issuedAt,
        playerID: null,
        roomID: input.roomID,
        scope: "lobby",
        userID: input.user.id,
      },
      input.secret,
    );
    const websocketURL = `${input.url.replace(/^http/, "ws")}/rooms/${input.roomID}/connect`;
    const players = [...((currentDeployment.game as { playerIDs: readonly [string, ...string[]] }).playerIDs)];
    const maxPlayers = players.length;
    const minPlayers = (currentDeployment.game as { minPlayers?: number }).minPlayers ?? maxPlayers;
    const lobby = lobbiesByRoom.get(input.roomID);
    const targetCapacity = lobby?.targetCapacity ?? maxPlayers;
    return {
      roomID: input.roomID,
      userID: input.user.id,
      userName: input.user.name ?? input.user.id,
      scope: "lobby" as const,
      token: signed.token,
      tokenExpiresAt: issuedAt + ttlSeconds,
      websocketURL,
      targetCapacity,
      minPlayers,
      maxPlayers,
      isHost: input.hostUserID === input.user.id,
      hostUserID: input.hostUserID,
    };
  }

  async function buildGameSnapshotResponse(input: {
    roomID: string;
    user: { id: string; name?: string | null };
    hostUserID: string;
    playerID: string;
    url: string;
    secret: string;
  }) {
    const issuedAt = Math.floor(Date.now() / 1_000);
    const ttlSeconds = 60 * 10;
    const signed = await signRoomToken(
      {
        deploymentVersion: currentDeployment.deploymentVersion,
        exp: issuedAt + ttlSeconds,
        iat: issuedAt,
        playerID: input.playerID,
        roomID: input.roomID,
        scope: "game",
        userID: input.user.id,
      },
      input.secret,
    );
    const websocketURL = `${input.url.replace(/^http/, "ws")}/rooms/${input.roomID}/connect`;
    const players = [...((currentDeployment.game as { playerIDs: readonly [string, ...string[]] }).playerIDs)];
    const maxPlayers = players.length;
    const minPlayers = (currentDeployment.game as { minPlayers?: number }).minPlayers ?? maxPlayers;
    const lobby = lobbiesByRoom.get(input.roomID);
    const targetCapacity = lobby?.targetCapacity ?? maxPlayers;
    return {
      roomID: input.roomID,
      userID: input.user.id,
      userName: input.user.name ?? input.user.id,
      scope: "game" as const,
      token: signed.token,
      tokenExpiresAt: issuedAt + ttlSeconds,
      websocketURL,
      targetCapacity,
      minPlayers,
      maxPlayers,
      isHost: input.hostUserID === input.user.id,
      hostUserID: input.hostUserID,
      playerID: input.playerID,
    };
  }

  async function withSession(
    request: Request,
    handler: (session: NonNullable<Awaited<ReturnType<typeof getSession>>>) => Promise<Response> | Response,
  ) {
    const session = await getSession(request);

    if (session === null) {
      return jsonResponse({ error: "unauthorized" }, 401);
    }

    return handler(session);
  }

  async function getSession(request: Request) {
    if (auth === null) {
      const userID = resolveAuthlessUserID(request);
      const sessionID = `nosession_${userID}`;
      return {
        session: {
          id: sessionID,
          userId: userID,
          token: sessionID,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          createdAt: new Date(),
          updatedAt: new Date(),
          ipAddress: null,
          userAgent: null,
        },
        user: {
          id: userID,
          name: userID,
          email: `${userID}@local`,
          emailVerified: false,
          createdAt: new Date(),
          updatedAt: new Date(),
          image: null,
        },
      } as unknown as NonNullable<Awaited<ReturnType<NonNullable<typeof auth>["api"]["getSession"]>>>;
    }
    const result = await auth.api.getSession({
      headers: request.headers,
    });

    return result;
  }
}

/**
 * Pulls a userID from `?userID=` on the request URL, or falls back to a fresh
 * UUID. Used by `startLocalDevServer({ auth: "none" })` to identify connections
 * without better-auth.
 */
function resolveAuthlessUserID(request: Request): string {
  try {
    const requestURL = new URL(request.url);
    const provided = requestURL.searchParams.get("userID");
    if (provided !== null && provided.length > 0) {
      return provided;
    }
  } catch {}
  return `anon_${crypto.randomUUID()}`;
}

async function runCli(rawArgs: readonly string[]): Promise<void> {
  const [command, ...args] = rawArgs;

  if (command === undefined || command === "--help" || command === "-h" || command === "help") {
    printRootHelp();
    process.exit(command === undefined ? 1 : 0);
  }

  if (hasHelpFlag(args) && CLI_COMMANDS[command] !== undefined) {
    printCommandHelp(command);
    process.exit(0);
  }

  const isKnownCommand = CLI_COMMANDS[command] !== undefined;

  let telemetryConfig = loadTelemetryConfig();
  if (telemetryConfig === null && isKnownCommand) {
    telemetryConfig = ensureTelemetryConfig();
    if (telemetryConfig !== null) printFirstRunNotice();
  }
  const telemetry = telemetryConfig !== null ? createTelemetryClient(telemetryConfig) : null;

  if (telemetry !== null && isKnownCommand) {
    try {
      telemetry.track("cli_command", { command });
    } catch {}
  }

  const startedAt = Date.now();
  let exitCode = 0;
  let errorClass: string | null = null;
  let caughtError: unknown = null;

  try {
    switch (command) {
      case "build":
        await runLocalBuild(args);
        break;
      case "create":
        await runCreateCommand(args);
        break;
      case "deploy":
        await runDeployCommand(args);
        break;
      case "dev":
        await runDevCommand(args);
        break;
      case "login":
        await runLoginCommand(args);
        break;
      case "logout":
        await runLogoutCommand();
        break;
      case "start":
        await runLocalStart(args);
        break;
      default:
        console.error(`Unknown command: ${command}`);
        console.error("");
        printRootHelp();
        exitCode = 1;
    }
  } catch (error) {
    caughtError = error;
    exitCode = 1;
    errorClass = error instanceof Error ? error.constructor.name : "unknown";
  }

  if (telemetry !== null && isKnownCommand) {
    try {
      telemetry.track("cli_command_finished", {
        command,
        duration_ms: Date.now() - startedAt,
        exit_code: exitCode,
        error_class: errorClass,
      });
      await telemetry.shutdown(500);
    } catch {}
  }

  if (caughtError !== null) {
    console.error(caughtError instanceof Error ? caughtError.message : String(caughtError));
  }
  if (telemetry !== null && telemetry.status.enabled) process.exit(exitCode);
  if (exitCode !== 0) process.exit(exitCode);
}

async function runDevCommand(args: readonly string[]) {
  const [target = ".", ...flags] = args;

  if (isFileTarget(target)) {
    await runHostedDevServer(target, flags);
    return;
  }

  const port = Number(readFlagValue(flags, "--port") ?? "3000");
  const server = await startProjectDevServer({
    port,
    projectDir: target,
  });

  const playURL = `${server.url}/play/${server.deploymentID}`;
  console.log("");
  console.log(`  ▶ Play URL:  ${playURL}`);
  console.log("");

  await waitForShutdownSignal();
  await server.stop();
}

async function runHostedDevServer(manifestPath: string, flags: readonly string[]) {
  const port = readFlagValue(flags, "--port");
  const dbPath = readFlagValue(flags, "--db");
  const deployment = await loadDeploymentFromPath(manifestPath);
  const serverOptions: LocalDevServerOptions = {
    deployment,
  };

  if (dbPath !== null) {
    serverOptions.dbPath = dbPath;
  }

  if (port !== null) {
    serverOptions.port = Number(port);
  }

  const server = await startLocalDevServer(serverOptions);

  console.log(`Openturn local hosted dev server ready at ${server.url}`);
  console.log(`Auth endpoint: ${server.url}/api/dev/session/anonymous`);
  console.log(`Room endpoint: ${server.url}/api/dev/rooms`);

  await waitForShutdownSignal();
  await server.stop();
}

function waitForShutdownSignal(): Promise<void> {
  return new Promise<void>((resolve) => {
    const onSignal = () => {
      process.off("SIGINT", onSignal);
      process.off("SIGTERM", onSignal);
      resolve();
    };
    process.once("SIGINT", onSignal);
    process.once("SIGTERM", onSignal);
  });
}

async function runLocalBuild(
  args: readonly string[],
  options: { deployAlias?: boolean } = {},
) {
  const projectDir = readPositionalProjectDir(args);
  const outDir = readFlagValue(args, "--out") ?? ".openturn/deploy";
  const deploymentID = readFlagValue(args, "--deployment-id") ?? undefined;
  const projectID = readFlagValue(args, "--project-id") ?? undefined;
  const result = await buildOpenturnProject({
    outDir,
    projectDir,
    ...(deploymentID === undefined ? {} : { deploymentID }),
    ...(projectID === undefined ? {} : { projectID }),
  });

  printBuildResult(result, options.deployAlias === true ? "Prepared deployment" : "Built deployment");
}

function printBuildResult(result: BuildOpenturnProjectResult, label: string) {
  console.log(`${label} ${result.manifest.deploymentID}`);
  console.log(`Runtime: ${result.manifest.runtime}`);
  console.log(`Output: ${result.outDir}`);
  console.log(`Entry: ${result.manifest.entry}`);
}

async function runLocalStart(args: readonly string[]) {
  const projectDir = readPositionalProjectDir(args);
  const outFlag = readFlagValue(args, "--out") ?? ".openturn/deploy";
  const portFlag = readFlagValue(args, "--port");
  const port = portFlag === null ? 3000 : Number(portFlag);
  const dbPath = readFlagValue(args, "--db");
  const shellFlag = readBooleanFlag(args, "--shell");
  const shell = shellFlag ?? true;

  const absoluteProjectDir = resolve(process.cwd(), projectDir);
  const outDir = resolve(absoluteProjectDir, outFlag);
  const manifest = loadDeploymentManifest(outDir);
  const deploymentID = manifest.deploymentID ?? "dep";

  if (manifest.runtime === "local") {
    const server = await startStaticServer({
      deploymentID,
      gameName: manifest.gameName,
      outDir,
      port,
      shell,
    });
    const playURL = shell ? `${server.url}/play/${deploymentID}` : server.url;
    console.log("");
    console.log(`  ▶ Play URL:  ${playURL}`);
    console.log(`    Mode:      single-player${shell ? "" : " (no shell)"}`);
    console.log("");

    await waitForShutdownSignal();
    await server.stop();
    return;
  }

  const deploymentVersion = manifest.multiplayer?.deploymentVersion ?? "dev";
  const deployment = await loadOpenturnProjectDeployment({
    deploymentVersion,
    projectDir: absoluteProjectDir,
  }) as GameDeployment;

  const serverOptions: LocalDevServerOptions = {
    auth: "none",
    deployment,
    port,
    static: {
      deploymentID,
      gameName: manifest.gameName,
      outDir,
      shell,
      ...(manifest.shellControls === undefined
        ? {}
        : { shellControls: manifest.shellControls }),
    },
  };
  if (dbPath !== null) {
    serverOptions.dbPath = dbPath;
  }

  const server = await startLocalDevServer(serverOptions);
  const playURL = shell ? `${server.url}/play/${deploymentID}` : server.url;
  console.log("");
  console.log(`  ▶ Play URL:  ${playURL}`);
  console.log(`    Mode:      multiplayer (no-auth)${shell ? "" : ", no shell"}`);
  console.log(`    Note:      local emulation; production uses Cloudflare Workers.`);
  console.log("");

  await waitForShutdownSignal();
  await server.stop();
}

interface StaticServerHandle {
  port: number;
  stop(): Promise<void>;
  url: string;
}

async function startStaticServer(options: {
  deploymentID: string;
  gameName: string;
  outDir: string;
  port: number;
  shell: boolean;
}): Promise<StaticServerHandle> {
  await assertLocalDevPortAvailable(options.port);
  const url = `http://${LOCAL_DEV_DISPLAY_HOST}:${options.port}`;

  const server = Bun.serve({
    async fetch(request) {
      const requestURL = new URL(request.url);

      if (request.method !== "GET" && request.method !== "HEAD") {
        return jsonResponse({ error: "method_not_allowed" }, 405);
      }

      if (options.shell) {
        if (requestURL.pathname === "/" || requestURL.pathname === `/play/${options.deploymentID}`) {
          return htmlResponse(createLocalPlayShell({
            deploymentID: options.deploymentID,
            gameName: options.gameName,
          }));
        }

        if (requestURL.pathname.startsWith("/__openturn/bundle/")) {
          const relativePath = requestURL.pathname.slice("/__openturn/bundle/".length) || "index.html";
          const resolved = resolveAssetPath(options.outDir, relativePath);
          if (resolved === null) {
            return jsonResponse({ error: "invalid_asset_path" }, 400);
          }
          return fileResponse(resolved, contentTypeForPath(relativePath));
        }

        if (requestURL.pathname === "/__openturn/play-app/main.js") {
          const bundle = await getDevPlayAppBundle();
          return new Response(bundle.js, {
            headers: { "Content-Type": bundle.jsContentType, "Cache-Control": "no-store" },
          });
        }

        if (requestURL.pathname === "/__openturn/play-app/tailwind.js") {
          return new Response(getDevPlayAppTailwind(), {
            headers: { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-store" },
          });
        }

        return jsonResponse({ error: "not_found" }, 404);
      }

      if (requestURL.pathname === "/" || requestURL.pathname === `/play/${options.deploymentID}`) {
        return fileResponse(resolve(options.outDir, "index.html"), "text/html; charset=utf-8");
      }

      const relativePath = requestURL.pathname.replace(/^\/+/, "");
      const resolved = resolveAssetPath(options.outDir, relativePath);
      if (resolved === null) {
        return jsonResponse({ error: "not_found" }, 404);
      }
      return fileResponse(resolved, contentTypeForPath(relativePath));
    },
    hostname: LOCAL_DEV_HOST,
    port: options.port,
  });

  return {
    port: server.port ?? options.port,
    async stop() {
      await server.stop();
    },
    url,
  };
}

function loadDeploymentManifest(outDir: string): OpenturnDeploymentManifest {
  const manifestPath = resolve(outDir, "manifest.json");
  if (!existsSync(manifestPath)) {
    throw new Error(
      `No build artifacts found at ${outDir}. Run \`openturn build\` first (or pass --out <dir>).`,
    );
  }
  const raw = readFileSync(manifestPath, "utf8");
  return JSON.parse(raw) as OpenturnDeploymentManifest;
}

/**
 * Read a boolean flag pair like `--shell` / `--no-shell`. Returns:
 *  - `true` when only `--name` is present (or appears after `--no-name`)
 *  - `false` when only `--no-name` is present (or appears after `--name`)
 *  - `undefined` when neither is present
 */
function readBooleanFlag(args: readonly string[], flag: string): boolean | undefined {
  if (!flag.startsWith("--")) {
    throw new Error(`readBooleanFlag expects a --flag name, got ${flag}`);
  }
  const positiveFlag = flag;
  const negativeFlag = `--no-${flag.slice(2)}`;
  let value: boolean | undefined;
  for (const arg of args) {
    if (arg === positiveFlag) value = true;
    else if (arg === negativeFlag) value = false;
    else if (arg.startsWith(`${positiveFlag}=`)) {
      const raw = arg.slice(positiveFlag.length + 1).toLowerCase();
      if (raw === "true" || raw === "1" || raw === "yes") value = true;
      else if (raw === "false" || raw === "0" || raw === "no") value = false;
      else throw new Error(`Invalid value for ${positiveFlag}: ${arg.slice(positiveFlag.length + 1)} (expected true/false)`);
    }
  }
  return value;
}

async function runCreateCommand(args: readonly string[]) {
  const projectDir = readPositionalProjectDir(args);
  const template = readFlagValue(args, "--template") ?? "local";
  const result = createOpenturnProject({
    projectDir,
    template,
  });

  console.log(`Created ${result.template} Openturn project at ${result.projectDir}`);
  console.log("");
  console.log("Next steps:");
  console.log(`  cd ${result.relativeProjectDir}`);
  console.log("  bun install");
  console.log("  bun run dev");
}

export function createOpenturnProject(options: {
  projectDir: string;
  template?: string;
}): {
  projectDir: string;
  relativeProjectDir: string;
  template: CreateTemplate;
} {
  const template = parseCreateTemplate(options.template ?? "local");
  const projectDir = resolve(process.cwd(), options.projectDir);

  if (existsSync(projectDir)) {
    const stats = statSync(projectDir);

    if (!stats.isDirectory()) {
      throw new Error(`Cannot create project because the target exists and is not a directory: ${projectDir}`);
    }

    if (readdirSync(projectDir).length > 0) {
      throw new Error(`Cannot create project in a non-empty directory: ${projectDir}`);
    }
  }

  const slug = slugify(basename(projectDir)) || "openturn-game";
  const gameName = toTitleCase(slug);
  const openturnVersion = resolveCreatedProjectOpenturnVersion();
  const packageJson = createProjectPackageJson({
    name: slug,
    openturnVersion,
  });

  mkdirSync(join(projectDir, "app"), { recursive: true });
  writeFileSync(join(projectDir, "package.json"), `${JSON.stringify(packageJson, null, 2)}\n`);
  writeFileSync(join(projectDir, "tsconfig.json"), createProjectTsconfig());
  writeFileSync(join(projectDir, "app", "game.ts"), createTemplateGameSource());
  writeFileSync(join(projectDir, "app", "page.tsx"), createTemplatePageSource(template));
  writeFileSync(join(projectDir, "app", "openturn.ts"), createTemplateMetadataSource({
    gameName,
    slug,
    template,
  }));

  return {
    projectDir,
    relativeProjectDir: toDisplayPath(projectDir),
    template,
  };
}

function parseCreateTemplate(value: string): CreateTemplate {
  if (CREATE_TEMPLATES.includes(value as CreateTemplate)) {
    return value as CreateTemplate;
  }

  throw new Error(`Unknown template "${value}". Supported templates: local, multiplayer.`);
}

function createProjectPackageJson(input: {
  name: string;
  openturnVersion: string;
}) {
  return {
    name: input.name,
    private: true,
    type: "module",
    openturn: {
      runtime: "browser",
    },
    scripts: {
      dev: "openturn dev .",
      build: "openturn build .",
      start: "openturn start .",
      deploy: "openturn deploy .",
      typecheck: "tsc -p tsconfig.json --pretty false",
    },
    dependencies: {
      "@openturn/core": input.openturnVersion,
      "@openturn/gamekit": input.openturnVersion,
      "@openturn/react": input.openturnVersion,
      react: "^19.2.0",
      "react-dom": "^19.2.0",
    },
    devDependencies: {
      "@openturn/cli": input.openturnVersion,
      "@types/react": "^19.2.0",
      "@types/react-dom": "^19.2.0",
      typescript: "^6.0.2",
    },
  };
}

function createProjectTsconfig(): string {
  return `${JSON.stringify({
    compilerOptions: {
      target: "ES2023",
      lib: ["ES2023", "DOM", "DOM.Iterable"],
      module: "ESNext",
      moduleResolution: "Bundler",
      jsx: "react-jsx",
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      types: ["react", "react-dom"],
    },
    include: ["app"],
  }, null, 2)}\n`;
}

function createTemplateGameSource(): string {
  return `import { defineGame, move, permissions } from "@openturn/gamekit";

export interface CounterState {
  value: number;
}

export const game = defineGame({
  playerIDs: ["0", "1"] as const,
  setup: (): CounterState => ({
    value: 0,
  }),
  moves: {
    increment: move({
      canPlayer: permissions.currentPlayer,
      run({ G, move, player }) {
        const value = G.value + 1;

        if (value >= 5) {
          return move.finish({ winner: player.id }, { value });
        }

        return move.endTurn({ value });
      },
    }),
  },
  views: {
    public: ({ G, turn }) => ({
      currentPlayer: turn.currentPlayer,
      value: G.value,
    }),
  },
});
`;
}

function createTemplatePageSource(template: CreateTemplate): string {
  return template === "local" ? createLocalTemplatePageSource() : createMultiplayerTemplatePageSource();
}

function createLocalTemplatePageSource(): string {
  return `import { createOpenturnBindings } from "@openturn/react";
import { game } from "./game";

const { OpenturnProvider, useMatch } = createOpenturnBindings(game, {
  runtime: "local",
  match: { players: game.playerIDs },
});

export default function Page() {
  return (
    <>
      <style>{styles}</style>
      <OpenturnProvider>
        <CounterGame />
      </OpenturnProvider>
    </>
  );
}

function CounterGame() {
  const view = useMatch();
  if (view.mode !== "local") throw new Error("CounterGame requires a local match.");
  const { dispatch, reset, snapshot } = view.state;
  const activePlayer = snapshot.derived.activePlayers[0] ?? game.playerIDs[0];
  const result = snapshot.meta.result;

  return (
    <main className="shell">
      <section className="panel" aria-labelledby="game-title">
        <p className="eyebrow">Openturn local game</p>
        <h1 id="game-title">Counter Duel</h1>
        <p className="value">{snapshot.G.value}</p>
        <p className="status">
          {result === null ? \`Player \${activePlayer} to move\` : \`Player \${result.winner ?? "?"} wins\`}
        </p>
        <div className="actions">
          <button disabled={result !== null} onClick={() => dispatch.increment(activePlayer)} type="button">
            Increment
          </button>
          <button onClick={reset} type="button">
            Reset
          </button>
        </div>
      </section>
    </main>
  );
}

${createTemplateStyles()}
`;
}

function createMultiplayerTemplatePageSource(): string {
  return `import { useState } from "react";

import { createOpenturnBindings } from "@openturn/react";
import { game } from "./game";

const { OpenturnProvider, useRoom } = createOpenturnBindings(game, {
  runtime: "multiplayer",
});

export default function Page() {
  return (
    <>
      <style>{styles}</style>
      <OpenturnProvider>
        <CounterGame />
      </OpenturnProvider>
    </>
  );
}

function CounterGame() {
  const room = useRoom();
  const [message, setMessage] = useState("Waiting for the hosted room.");

  if (room.game === null) {
    if (room.phase === "missing_backend") {
      return (
        <main className="shell">
          <section className="panel" aria-labelledby="missing-backend-title">
            <p className="eyebrow">Openturn multiplayer game</p>
            <h1 id="missing-backend-title">No host connection</h1>
            <p className="status">
              This page must be embedded by an Openturn play shell to host a multiplayer match.
            </p>
            <ul className="hints">
              <li>Local dev: open the <strong>Play URL</strong> printed by <code>openturn dev</code> (typically <code>/play/dev</code>).</li>
              <li>Cloud: navigate to <code>/play/&lt;deploymentID&gt;</code> on your Openturn deployment.</li>
            </ul>
          </section>
        </main>
      );
    }

    return (
      <main className="shell">
        <section className="panel">
          <p className="status">{\`\${room.phase}…\`}</p>
        </section>
      </main>
    );
  }

  const hostedMatch = room.game;
  const value = hostedMatch.snapshot?.G.value ?? 0;
  const winner = hostedMatch.result?.winner ?? null;

  async function increment() {
    setMessage("Move sent.");
    const outcome = await hostedMatch.dispatch.increment();

    if (!outcome.ok) {
      setMessage(outcome.error);
    }
  }

  return (
    <main className="shell">
      <section className="panel" aria-labelledby="game-title">
        <p className="eyebrow">Openturn multiplayer game</p>
        <h1 id="game-title">Counter Duel</h1>
        <p className="value">{value}</p>
        <p className="status">
          {winner === null
            ? \`\${hostedMatch.status} · player \${hostedMatch.playerID ?? "?"}\`
            : \`Player \${winner} wins\`}
        </p>
        <div className="actions">
          <button disabled={!hostedMatch.canDispatch.increment || winner !== null} onClick={() => { void increment(); }} type="button">
            Increment
          </button>
        </div>
        <p className="message" aria-live="polite">{message}</p>
      </section>
    </main>
  );
}

${createTemplateStyles()}
`;
}

function createTemplateStyles(): string {
  return `const styles = \`
  * {
    box-sizing: border-box;
  }

  body {
    margin: 0;
  }

  button {
    font: inherit;
  }

  .shell {
    min-height: 100vh;
    display: grid;
    place-items: center;
    padding: 24px;
    color: #14213d;
    background: #f5f7fb;
    font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }

  .panel {
    width: min(520px, 100%);
    border: 1px solid #d7deea;
    border-radius: 8px;
    padding: 28px;
    background: #ffffff;
    box-shadow: 0 18px 48px rgba(20, 33, 61, 0.10);
  }

  .eyebrow {
    margin: 0 0 8px;
    color: #4f6f52;
    font-size: 0.78rem;
    font-weight: 700;
    text-transform: uppercase;
  }

  h1 {
    margin: 0;
    font-size: 2rem;
  }

  .value {
    margin: 26px 0 8px;
    font-size: 5rem;
    font-weight: 800;
    line-height: 1;
  }

  .status,
  .message {
    min-height: 1.5rem;
    color: #536179;
  }

  .actions {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
  }

  .actions button {
    min-width: 120px;
    border: 1px solid #14213d;
    border-radius: 6px;
    padding: 10px 14px;
    color: #ffffff;
    background: #14213d;
    cursor: pointer;
  }

  .actions button:disabled {
    border-color: #aab4c5;
    background: #aab4c5;
    cursor: not-allowed;
  }

  .hints {
    margin: 12px 0 0;
    padding-left: 18px;
    color: #536179;
    font-size: 0.9rem;
    line-height: 1.5;
  }

  .hints code {
    background: #eef1f7;
    border-radius: 4px;
    padding: 1px 5px;
    font-size: 0.85em;
  }
\`;
`;
}

function createTemplateMetadataSource(input: {
  gameName: string;
  slug: string;
  template: CreateTemplate;
}): string {
  if (input.template === "local") {
    return `export const metadata = {
  name: ${JSON.stringify(input.gameName)},
  runtime: "local",
};
`;
  }

  return `export const metadata = {
  name: ${JSON.stringify(input.gameName)},
  runtime: "multiplayer",
  multiplayer: {
    gameKey: ${JSON.stringify(input.slug)},
    schemaVersion: "1",
  },
};
`;
}

function resolveCreatedProjectOpenturnVersion(): string {
  return findOpenturnWorkspaceRoot(process.cwd()) === null ? "latest" : "workspace:*";
}

function findOpenturnWorkspaceRoot(start: string): string | null {
  let current = resolve(start);

  while (true) {
    const packageJsonPath = join(current, "package.json");

    if (existsSync(packageJsonPath) && existsSync(join(current, "packages", "core", "package.json"))) {
      try {
        const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { name?: unknown };

        if (packageJson.name === "openturn") {
          return current;
        }
      } catch {}
    }

    const parent = dirname(current);
    if (parent === current) {
      return null;
    }

    current = parent;
  }
}

function toDisplayPath(path: string): string {
  const relativePath = relative(process.cwd(), path);
  return relativePath.length === 0 || relativePath.startsWith("..") ? path : relativePath;
}

function toTitleCase(slug: string): string {
  return slug
    .split("-")
    .filter((part) => part.length > 0)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replaceAll(/[^a-z0-9-]+/gu, "-")
    .replaceAll(/-+/gu, "-")
    .replace(/^-|-$/gu, "");
}

async function startProjectDevServer(options: {
  port: number;
  projectDir: string;
}): Promise<{
  deploymentID: string;
  stop(): void | Promise<void>;
  url: string;
}> {
  const projectDir = resolve(options.projectDir);
  const metadata = await collectProjectMetadata(projectDir);
  const deploymentID = "dev";
  const projectID = "dev";

  const bundleOptions: Parameters<typeof startDevBundleServer>[0] = {
    deploymentID,
    gameName: metadata.gameName,
    projectDir,
    projectID,
    runtime: metadata.runtime,
  };

  if (metadata.runtime !== "multiplayer") {
    bundleOptions.port = options.port;
  }

  const bundle = await startDevBundleServer(bundleOptions);

  if (metadata.runtime !== "multiplayer") {
    return {
      deploymentID,
      async stop() {
        await bundle.stop();
      },
      url: bundle.url,
    };
  }

  const deployment = await loadOpenturnProjectDeployment({
    deploymentVersion: "dev",
    projectDir,
  }) as GameDeployment;

  const server = await startLocalDevServer({
    deployment,
    iframe: {
      bundleURL: bundle.url,
      deploymentID,
      gameName: metadata.gameName,
    },
    port: options.port,
  });

  const watcher = startDeploymentWatcher({
    projectDir,
    swap: async (next) => {
      await server.swapDeployment(next);
    },
  });

  return {
    deploymentID,
    async stop() {
      await watcher.stop();
      await server.stop();
      await bundle.stop();
    },
    url: server.url,
  };
}

async function collectProjectMetadata(projectDir: string): Promise<{
  gameName: string;
  runtime: OpenturnDeploymentRuntime;
}> {
  const paths = await resolveOpenturnProject(projectDir);

  const projectID = basename(paths.projectDir);
  let runtime: OpenturnDeploymentRuntime = "multiplayer";
  let gameName = projectID;

  if (paths.metadata !== null) {
    const moduleValue = await import(
      `${pathToFileURL(paths.metadata).href}?t=${Date.now()}-${Math.random()}`
    ) as Record<string, unknown>;
    const rawMetadata = moduleValue.metadata as { name?: unknown; runtime?: unknown } | undefined;
    const topRuntime = moduleValue.runtime;
    const declaredRuntime = (rawMetadata?.runtime ?? topRuntime) as unknown;

    if (declaredRuntime === "local" || declaredRuntime === "multiplayer") {
      runtime = declaredRuntime;
    }

    if (typeof rawMetadata?.name === "string" && rawMetadata.name.length > 0) {
      gameName = rawMetadata.name;
    }
  }

  return { gameName, runtime };
}

function startDeploymentWatcher(input: {
  projectDir: string;
  swap: (deployment: GameDeployment) => Promise<void>;
}): { stop(): Promise<void> } {
  const watchedPaths = [
    join(input.projectDir, "app/game.ts"),
    join(input.projectDir, "app/openturn.ts"),
  ];
  const watcher = chokidar.watch(watchedPaths, {
    ignoreInitial: true,
  });

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const trigger = () => {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
    }

    debounceTimer = setTimeout(() => {
      void reload();
    }, 150);
  };

  const reload = async () => {
    try {
      const next = await loadOpenturnProjectDeployment({
        deploymentVersion: "dev",
        projectDir: input.projectDir,
      }) as GameDeployment;
      await input.swap(next);
      console.log(`[openturn] Reloaded game deployment ${next.deploymentVersion}`);
    } catch (error) {
      console.error(
        `[openturn] Failed to reload deployment: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };

  watcher.on("add", trigger);
  watcher.on("change", trigger);

  return {
    async stop() {
      if (debounceTimer !== null) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      await watcher.close();
    },
  };
}

function fileResponse(path: string, contentType: string): Response {
  if (!existsSync(path)) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  return new Response(readFileSync(path), {
    headers: {
      "Content-Type": contentType,
    },
  });
}

/**
 * Resolves `relativePath` underneath `rootDir` and returns the absolute path
 * iff the result stays inside `rootDir`. Returns null on traversal attempts
 * (`..` segments, absolute paths, Windows drive prefixes, backslash escapes).
 *
 * Substring-based checks like `path.split("/").includes("..")` miss `..\` on
 * Windows and absolute paths like `/etc/passwd` (which `resolve` would happily
 * walk to). Doing one final `startsWith(rootDir + sep)` catches both.
 */
function resolveAssetPath(rootDir: string, relativePath: string): string | null {
  if (relativePath.length === 0) return null;
  const root = resolve(rootDir);
  const candidate = resolve(root, relativePath);
  if (candidate !== root && !candidate.startsWith(root + sep)) return null;
  return candidate;
}

function htmlResponse(html: string): Response {
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
    },
  });
}


// HTML wrapper for the React-based dev play shell. The actual UI lives in
// packages/cli/src/play-app/main.tsx and is bundled on demand by
// `getDevPlayAppBundle()`. Tailwind utility classes are JIT-compiled in the
// browser via `@tailwindcss/browser`, served locally from the CLI's own
// node_modules so the dev shell works offline and doesn't depend on a CDN.
interface DevPlayMultiplayerConfig {
  minPlayers: number;
  maxPlayers: number;
  players: readonly string[];
}

function extractMultiplayerConfig(deployment: GameDeployment): DevPlayMultiplayerConfig {
  const declaredPlayerIDs = (deployment.game as { playerIDs?: readonly string[] }).playerIDs;
  if (declaredPlayerIDs === undefined || declaredPlayerIDs.length === 0) {
    // The dev play shell needs `playerIDs` to mint seats. A multiplayer
    // deployment that ships without them yields a 0-seat lobby that silently
    // does nothing — surface that loudly so the developer can fix it.
    throw new Error(
      `Multiplayer deployment "${deployment.gameKey ?? "unknown"}" is missing \`game.playerIDs\`. ` +
      `Add a non-empty playerIDs array to the game definition.`,
    );
  }
  const players = [...declaredPlayerIDs];
  const maxPlayers = players.length;
  const minPlayers = (deployment.game as { minPlayers?: number }).minPlayers ?? maxPlayers;
  return { players, minPlayers, maxPlayers };
}

function createLocalPlayShell(input: {
  bundleURL?: string;
  deploymentID: string;
  gameName: string;
  multiplayer?: DevPlayMultiplayerConfig;
  shellControls?: OpenturnShellControlsConfig;
}): string {
  const title = escapeHTML(input.gameName);
  const bundleBase = input.bundleURL ?? "/__openturn/bundle/";
  const config = {
    deploymentID: input.deploymentID,
    gameName: input.gameName,
    bundleBase,
    multiplayer: input.multiplayer,
    ...(input.shellControls === undefined ? {} : { shellControls: input.shellControls }),
  };
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${title}</title>
    <script>${getInitialThemeScript()}</script>
    <script src="/__openturn/play-app/tailwind.js"></script>
    <style type="text/tailwindcss">
      @custom-variant dark (&:is(.dark *, .dark));
    </style>
    <style>
      html, body, #root { height: 100%; margin: 0; }
      body { font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script>window.__OPENTURN_PLAY__ = ${escapeJSONForScript(config)};</script>
    <script type="module" src="/__openturn/play-app/main.js"></script>
  </body>
</html>
`;
}

function escapeHTML(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeJSONForScript(value: unknown): string {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, (ch) => {
    return JSON_SCRIPT_ESCAPES[ch] ?? ch;
  });
}

const JSON_SCRIPT_ESCAPES: Record<string, string> = {
  "<": "\\u003c",
  ">": "\\u003e",
  "&": "\\u0026",
  "\u2028": "\\u2028",
  "\u2029": "\\u2029",
};

function contentTypeForPath(path: string): string {
  if (path.endsWith(".html")) {
    return "text/html; charset=utf-8";
  }

  if (path.endsWith(".js")) {
    return "text/javascript; charset=utf-8";
  }

  if (path.endsWith(".css")) {
    return "text/css; charset=utf-8";
  }

  if (path.endsWith(".json")) {
    return "application/json; charset=utf-8";
  }

  return "application/octet-stream";
}

function readPositionalProjectDir(args: readonly string[]): string {
  return args.find((arg) => !arg.startsWith("--") && !isFlagValue(args, arg)) ?? ".";
}

function isFlagValue(args: readonly string[], value: string): boolean {
  const index = args.indexOf(value);

  if (index <= 0) {
    return false;
  }

  return args[index - 1]?.startsWith("--") === true;
}

function isFileTarget(target: string): boolean {
  const absoluteTarget = resolve(process.cwd(), target);

  return existsSync(absoluteTarget) && statSync(absoluteTarget).isFile();
}

interface CliFlag {
  name: string;
  value?: string;
  description: string;
}

interface CliCommand {
  summary: string;
  usage: string[];
  flags: CliFlag[];
  notes?: string[];
}

const CLI_COMMANDS: Record<string, CliCommand> = {
  create: {
    summary: "Scaffold a new Openturn project.",
    usage: ["openturn create <project-dir> [--template local|multiplayer]"],
    flags: [
      { name: "--template", value: "local|multiplayer", description: "Starter template to scaffold (default: local)." },
    ],
  },
  dev: {
    summary: "Start the local dev server with HMR and inspector.",
    usage: [
      "openturn dev [project-dir] [--port <port>]",
      "openturn dev <deployment-module> [--port <port>] [--db <path>]",
    ],
    flags: [
      { name: "--port", value: "<port>", description: "Port to bind (default: 3000 for projects, auto for deployment modules)." },
      { name: "--db", value: "<path>", description: "SQLite path for the hosted dev server (deployment-module form only)." },
    ],
    notes: [
      "Vite HMR for app/page.tsx; app/game.ts and app/openturn.ts hot-swap on change.",
      "Inspector toolbar is auto-mounted; toggle with the button or press Alt+I.",
      "If the project's openturn.ts declares runtime: \"multiplayer\", open the printed Play URL.",
    ],
  },
  build: {
    summary: "Build a deployable bundle to disk (single-player or multiplayer).",
    usage: ["openturn build [project-dir] [--out <dir>] [--deployment-id <id>] [--project-id <id>]"],
    flags: [
      { name: "--out", value: "<dir>", description: "Output directory (default: .openturn/deploy)." },
      { name: "--deployment-id", value: "<id>", description: "Override the generated deployment ID." },
      { name: "--project-id", value: "<id>", description: "Override the generated project ID." },
    ],
    notes: [
      "Runtime is read from app/openturn.ts. Multiplayer projects also emit a server bundle.",
    ],
  },
  start: {
    summary: "Run a previously-built bundle locally.",
    usage: ["openturn start [project-dir] [--port <port>] [--out <dir>] [--no-shell] [--db <path>]"],
    flags: [
      { name: "--port", value: "<port>", description: "Port to bind (default: 3000)." },
      { name: "--out", value: "<dir>", description: "Build output directory to serve (default: .openturn/deploy)." },
      { name: "--no-shell", description: "Serve the raw built game without the inspector toolbar shell." },
      { name: "--db", value: "<path>", description: "SQLite path for room persistence (multiplayer only)." },
    ],
    notes: [
      "Requires a prior `openturn build`. Multiplayer mode runs the bun server with no auth injection — layer auth externally.",
      "Multiplayer is local emulation; production runs on Cloudflare Workers.",
    ],
  },
  deploy: {
    summary: "Build and upload to Openturn Cloud.",
    usage: ["openturn deploy [project-dir] [--project <slug>] [--name <name>] [--url <url>] [--token <token>]"],
    flags: [
      { name: "--project", value: "<slug>", description: "Target project slug (defaults to the directory name)." },
      { name: "--name", value: "<name>", description: "Human-readable project name (only used on first deploy)." },
      { name: "--url", value: "<url>", description: "Cloud control-plane URL (overrides stored login + OPENTURN_CLOUD_URL)." },
      { name: "--token", value: "<token>", description: "Auth token (overrides stored login + OPENTURN_CLOUD_TOKEN)." },
    ],
    notes: [
      "Run `openturn login --token <token>` once to persist credentials.",
    ],
  },
  login: {
    summary: "Persist Openturn Cloud credentials.",
    usage: ["openturn login [--url <url>] [--token <token>]"],
    flags: [
      { name: "--url", value: "<url>", description: "Cloud control-plane URL (default: hosted Openturn Cloud)." },
      { name: "--token", value: "<token>", description: "API token from your Openturn Cloud dashboard." },
    ],
  },
  logout: {
    summary: "Clear stored Openturn Cloud credentials.",
    usage: ["openturn logout"],
    flags: [],
  },
};

function hasHelpFlag(args: readonly string[]): boolean {
  return args.includes("--help") || args.includes("-h");
}

function printRootHelp() {
  console.log("openturn — multiplayer game framework CLI");
  console.log("");
  console.log("Usage:");
  console.log("  openturn <command> [options]");
  console.log("  openturn <command> --help");
  console.log("");
  console.log("Commands:");
  const entries = Object.entries(CLI_COMMANDS).sort(([a], [b]) => a.localeCompare(b));
  const width = Math.max(...entries.map(([name]) => name.length));
  for (const [name, command] of entries) {
    console.log(`  ${name.padEnd(width)}  ${command.summary}`);
  }
  console.log("");
  console.log("Run `openturn <command> --help` for command-specific options.");
}

function printCommandHelp(name: string) {
  const command = CLI_COMMANDS[name];

  if (command === undefined) {
    printRootHelp();
    return;
  }

  console.log(`openturn ${name} — ${command.summary}`);
  console.log("");
  console.log("Usage:");
  for (const line of command.usage) {
    console.log(`  ${line}`);
  }

  if (command.flags.length > 0) {
    console.log("");
    console.log("Options:");
    const rows = command.flags.map((flag) => ({
      label: flag.value === undefined ? flag.name : `${flag.name} ${flag.value}`,
      description: flag.description,
    }));
    const width = Math.max(...rows.map((row) => row.label.length));
    for (const row of rows) {
      console.log(`  ${row.label.padEnd(width)}  ${row.description}`);
    }
  }

  if (command.notes !== undefined && command.notes.length > 0) {
    console.log("");
    console.log("Notes:");
    for (const note of command.notes) {
      console.log(`  - ${note}`);
    }
  }
}

async function runDeployCommand(args: readonly string[]) {
  const projectDir = readPositionalProjectDir(args);
  const projectSlug = readFlagValue(args, "--project");
  const projectName = readFlagValue(args, "--name");
  const urlFlag = readFlagValue(args, "--url");
  const tokenFlag = readFlagValue(args, "--token");

  const storedConfig = loadCloudAuth();
  const url = urlFlag ?? storedConfig?.url ?? process.env.OPENTURN_CLOUD_URL ?? DEFAULT_CLOUD_URL;
  const token = tokenFlag ?? storedConfig?.token ?? process.env.OPENTURN_CLOUD_TOKEN ?? null;

  if (token === null) {
    throw new Error("Not signed in. Run `openturn login --token <token>` first.");
  }

  console.log(`Deploying ${projectDir} to ${url}…`);

  const result = await cloudDeploy({
    projectDir,
    ...(projectSlug === null ? {} : { projectSlug }),
    ...(projectName === null ? {} : { projectName }),
    config: { url, token },
  });

  console.log(`Deployment ID: ${result.deploymentID}`);
  console.log(`Project ID:    ${result.projectID}`);
  console.log(`Game URL:      ${result.gameURL}`);
  console.log(`Play URL:      ${result.playURL}`);
  console.log(`Dashboard:     ${result.dashboardURL}`);

  if (result.serverBundleStatus !== undefined && result.serverBundleStatus !== "live") {
    console.log(`Server bundle: ${result.serverBundleStatus} (may take up to ~2 min to go live)`);
  }
}

async function runLoginCommand(args: readonly string[]) {
  const urlFlag = readFlagValue(args, "--url");
  const tokenFlag = readFlagValue(args, "--token");

  const url = urlFlag ?? process.env.OPENTURN_CLOUD_URL ?? DEFAULT_CLOUD_URL;
  const token = tokenFlag ?? process.env.OPENTURN_CLOUD_TOKEN;

  if (token === undefined || token.length === 0) {
    console.error(`Missing --token. Create one at ${url}/dashboard/settings/tokens and pass it with --token.`);
    process.exit(1);
  }

  const path = saveCloudAuth({ url, token });
  console.log(`Saved credentials for ${url} to ${path}`);
}

async function runLogoutCommand() {
  const configDir = process.env.XDG_CONFIG_HOME
    ?? `${process.env.HOME ?? ""}/.config`;
  const authPath = `${configDir}/openturn/auth.json`;

  if (existsSync(authPath)) {
    unlinkSync(authPath);
    console.log(`Removed ${authPath}`);
  } else {
    console.log("Nothing to do; no stored credentials.");
  }
}

async function loadDeploymentFromPath(modulePath: string): Promise<GameDeployment> {
  const absoluteModulePath = resolve(process.cwd(), modulePath);
  const moduleValue = await import(pathToFileURL(absoluteModulePath).href);

  return loadGameDeployment(moduleValue);
}

function readFlagValue(flags: readonly string[], flag: string): string | null {
  const flagIndex = flags.indexOf(flag);

  if (flagIndex < 0) {
    return null;
  }

  return flags[flagIndex + 1] ?? null;
}

function ensureSQLiteDatabaseParentDirectory(path: string) {
  if (path === ":memory:" || path.startsWith("file:")) {
    return;
  }

  mkdirSync(dirname(path), { recursive: true });
}

function bootstrapLocalTables(database: Database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS openturn_rooms (
      room_id TEXT PRIMARY KEY,
      deployment_version TEXT NOT NULL,
      seed TEXT NOT NULL,
      initial_now INTEGER NOT NULL,
      revision INTEGER NOT NULL,
      branch TEXT NOT NULL,
      checkpoint TEXT NOT NULL,
      log TEXT NOT NULL,
      match TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS openturn_room_players (
      room_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      player_id TEXT NOT NULL,
      assigned_at INTEGER NOT NULL,
      PRIMARY KEY (room_id, user_id),
      UNIQUE (room_id, player_id)
    );

    CREATE TABLE IF NOT EXISTS openturn_audit_events (
      event_id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL,
      type TEXT NOT NULL,
      payload TEXT NOT NULL,
      at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS openturn_saves (
      id TEXT PRIMARY KEY,
      deployment_version TEXT NOT NULL,
      game_key TEXT NOT NULL,
      room_id_origin TEXT NOT NULL,
      created_by_user_id TEXT NOT NULL,
      blob TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);
}

function bootstrapBetterAuthTables(
  database: Database,
  options: Parameters<typeof getSchema>[0],
) {
  const schema = getSchema(options);
  const orderedTables = Object.entries(schema).sort((left, right) => left[1].order - right[1].order);

  for (const [tableName, definition] of orderedTables) {
    const columns = ['id TEXT PRIMARY KEY NOT NULL'];
    const indexes: string[] = [];

    for (const [fieldName, field] of Object.entries(definition.fields)) {
      const columnName = field.fieldName ?? fieldName;
      const constraints: string[] = [columnName, mapAuthFieldType(field.type)];

      if (field.required !== false) {
        constraints.push("NOT NULL");
      }

      if (field.defaultValue !== undefined) {
        constraints.push(`DEFAULT ${formatDefaultValue(field.defaultValue)}`);
      }

      if (field.unique) {
        constraints.push("UNIQUE");
      }

      if (field.references !== undefined) {
        constraints.push(
          `REFERENCES ${field.references.model}(id) ON DELETE ${(field.references.onDelete ?? "cascade").toUpperCase()}`,
        );
      }

      columns.push(constraints.join(" "));

      if (field.index) {
        indexes.push(
          `CREATE INDEX IF NOT EXISTS idx_${tableName}_${columnName} ON ${tableName} (${columnName});`,
        );
      }
    }

    database.exec(`CREATE TABLE IF NOT EXISTS ${tableName} (${columns.join(", ")});`);

    for (const indexStatement of indexes) {
      database.exec(indexStatement);
    }
  }
}

function createSQLiteRoomPersistence(
  db: ReturnType<typeof drizzle>,
): RoomPersistence {
  return {
    async load(roomID) {
      const room = db.select().from(roomsTable).where(eq(roomsTable.roomID, roomID)).get();

      if (room === undefined) {
        return null;
      }

      return parseRoomPersistenceRecord({
        branch: parseJsonText(room.branch, "room.branch"),
        checkpoint: parseJsonText(room.checkpoint, "room.checkpoint"),
        deploymentVersion: room.deploymentVersion,
        initialNow: room.initialNow,
        log: parseJsonText(room.log, "room.log"),
        match: parseJsonText(room.match, "room.match"),
        roomID: room.roomID,
        seed: room.seed,
      });
    },
    async save(record) {
      db.insert(roomsTable).values({
        branch: stringifyJson(record.branch),
        checkpoint: stringifyJson(record.checkpoint),
        createdAt: Date.now(),
        deploymentVersion: record.deploymentVersion,
        initialNow: record.initialNow,
        log: stringifyJson(record.log),
        match: stringifyJson(record.match),
        revision: record.checkpoint.revision,
        roomID: record.roomID,
        seed: record.seed,
      }).onConflictDoUpdate({
        set: {
          branch: stringifyJson(record.branch),
          checkpoint: stringifyJson(record.checkpoint),
          deploymentVersion: record.deploymentVersion,
          initialNow: record.initialNow,
          log: stringifyJson(record.log),
          match: stringifyJson(record.match),
          revision: record.checkpoint.revision,
          seed: record.seed,
        },
        target: roomsTable.roomID,
      }).run();
    },
  };
}

function assignRoomPlayer(input: {
  db: ReturnType<typeof drizzle>;
  roomID: string;
  userID: string;
  validPlayers: readonly string[];
}): string | null {
  const existingAssignment = input.db.select().from(roomPlayersTable)
    .where(and(eq(roomPlayersTable.roomID, input.roomID), eq(roomPlayersTable.userID, input.userID)))
    .get();

  if (existingAssignment !== undefined) {
    return existingAssignment.playerID;
  }

  const assignedPlayers = input.db.select().from(roomPlayersTable)
    .where(eq(roomPlayersTable.roomID, input.roomID))
    .all()
    .map((assignment) => assignment.playerID);
  const nextPlayerID = input.validPlayers.find((playerID) => !assignedPlayers.includes(playerID));

  if (nextPlayerID === undefined) {
    return null;
  }

  input.db.insert(roomPlayersTable).values({
    assignedAt: Date.now(),
    playerID: nextPlayerID,
    roomID: input.roomID,
    userID: input.userID,
  }).run();

  return nextPlayerID;
}

function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

function withCors(response: Response, origin: string | null): Response {
  if (origin === null) {
    return response;
  }

  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Credentials", "true");
  headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
  headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Vary", "Origin");

  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
}

function createCorsPreflightResponse(origin: string): Response {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Credentials": "true",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Origin": origin,
      "Vary": "Origin",
    },
    status: 204,
  });
}

function isCorsManagedPath(pathname: string): boolean {
  return pathname.startsWith("/api/auth/") || pathname.startsWith("/api/dev/");
}

function getAllowedDevCorsOrigin(request: Request): string | null {
  const origin = request.headers.get("origin");

  if (origin === null) {
    return null;
  }

  try {
    const url = new URL(origin);

    if ((url.protocol === "http:" || url.protocol === "https:") && (url.hostname === "127.0.0.1" || url.hostname === "localhost")) {
      return origin;
    }
  } catch {}

  return null;
}

function mapAuthFieldType(type: string | readonly string[]): string {
  if (Array.isArray(type)) {
    return "TEXT";
  }

  switch (type) {
    case "boolean":
    case "number":
      return "INTEGER";
    case "date":
      return "DATE";
    case "json":
    case "number[]":
    case "string":
    case "string[]":
    default:
      return "TEXT";
  }
}

function formatDefaultValue(value: unknown): string {
  const resolvedValue = typeof value === "function" ? value() : value;

  if (resolvedValue === null || resolvedValue === undefined) {
    return "NULL";
  }

  if (typeof resolvedValue === "boolean") {
    return resolvedValue ? "1" : "0";
  }

  if (typeof resolvedValue === "number") {
    return String(resolvedValue);
  }

  if (resolvedValue instanceof Date) {
    return `'${resolvedValue.toISOString()}'`;
  }

  if (Array.isArray(resolvedValue) || typeof resolvedValue === "object") {
    return `'${JSON.stringify(resolvedValue).replaceAll("'", "''")}'`;
  }

  return `'${String(resolvedValue).replaceAll("'", "''")}'`;
}

type ServerWebSocket = Bun.ServerWebSocket<SocketData>;

interface SocketData {
  scope: "lobby" | "game";
  roomID: string;
  userID: string;
  userName: string | null;
  // Present for scope === "game"; null for scope === "lobby" (playerID is
  // assigned at Start and delivered to clients via lobby:transition_to_game).
  playerID: string | null;
}

function bindSocketClientMessage(
  message: ProtocolClientMessage,
  socketData: SocketData,
): ProtocolClientMessage {
  const playerID = socketData.playerID ?? "";
  switch (message.type) {
    case "action":
    case "resync":
    case "sync":
    case "save-request":
      return {
        ...message,
        matchID: socketData.roomID,
        playerID,
      };
  }
}

function countSocketsForPlayer(
  sockets: ReadonlySet<ServerWebSocket> | undefined,
  playerID: string | null,
): number {
  if (sockets === undefined || playerID === null) return 0;
  let count = 0;
  for (const socket of sockets) {
    if (socket.data.scope !== "game") continue;
    if (socket.data.playerID === playerID) count += 1;
  }
  return count;
}

function countLobbySocketsForUser(
  sockets: ReadonlySet<ServerWebSocket> | undefined,
  userID: string,
): number {
  if (sockets === undefined) return 0;
  let count = 0;
  for (const socket of sockets) {
    if (socket.data.scope !== "lobby") continue;
    if (socket.data.userID === userID) count += 1;
  }
  return count;
}

export function removeDatabaseFile(path: string) {
  try {
    unlinkSync(path);
  } catch {}

  try {
    unlinkSync(`${path}-shm`);
  } catch {}

  try {
    unlinkSync(`${path}-wal`);
  } catch {}
}

if (import.meta.main) {
  await runCli(Bun.argv.slice(2));
}
