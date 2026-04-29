import { z } from "zod";

import type { BridgeInit } from "./schema";

export interface AnonymousSession {
  token: string;
  user: {
    id: string;
    name?: string | undefined;
  };
}

export interface DevLobbySnapshot {
  roomID: string;
  userID: string;
  userName: string;
  scope: "lobby";
  token: string;
  tokenExpiresAt: number;
  websocketURL: string;
  targetCapacity: number;
  minPlayers: number;
  maxPlayers: number;
  isHost: boolean;
  hostUserID: string;
}

export interface DevTransportOptions {
  baseURL?: string;
  sessionStorageKey?: string;
  storage?: Pick<Storage, "getItem" | "removeItem" | "setItem">;
}

export interface DevTransport {
  readonly baseURL: string;
  createInviteURL(roomID: string): string;
  createRoom(): Promise<DevLobbySnapshot>;
  joinRoom(roomID: string): Promise<DevLobbySnapshot>;
  readRoomIDFromLocation(): string | null;
  writeRoomIDToLocation(roomID: string | null): void;
  toBridgeInit(snapshot: DevLobbySnapshot): BridgeInit;
}

const DEFAULT_BASE_URL = "http://localhost:4010";
const DEFAULT_SESSION_STORAGE_KEY = "openturn.dev.anonymous-token";
const ROOM_QUERY_KEY = "room";

const AnonymousSessionSchema = z.object({
  token: z.string(),
  user: z.object({
    id: z.string(),
    name: z.string().optional(),
  }),
});

const LobbySnapshotSchema = z.object({
  roomID: z.string(),
  userID: z.string(),
  userName: z.string(),
  scope: z.literal("lobby"),
  token: z.string(),
  tokenExpiresAt: z.number(),
  websocketURL: z.string(),
  targetCapacity: z.number().int().nonnegative(),
  minPlayers: z.number().int().nonnegative(),
  maxPlayers: z.number().int().nonnegative(),
  isHost: z.boolean(),
  hostUserID: z.string(),
});

const ErrorResponseSchema = z.object({ error: z.string().optional() });

export function createDevTransport(options: DevTransportOptions = {}): DevTransport {
  const baseURL = normalizeBaseURL(options.baseURL ?? getEnvironmentBaseURL());
  const sessionStorageKey = options.sessionStorageKey ?? DEFAULT_SESSION_STORAGE_KEY;

  const getStorage = () => {
    if (options.storage !== undefined) return options.storage;
    if (typeof window === "undefined") return null;
    return window.sessionStorage;
  };

  const readStoredSessionToken = () => getStorage()?.getItem(sessionStorageKey) ?? null;
  const writeStoredSessionToken = (token: string | null) => {
    const storage = getStorage();
    if (storage === null) return;
    if (token === null) {
      storage.removeItem(sessionStorageKey);
      return;
    }
    storage.setItem(sessionStorageKey, token);
  };

  const createAnonymousSession = async (): Promise<AnonymousSession> => {
    const session = await requestDevJSON(
      baseURL,
      "/api/dev/session/anonymous",
      AnonymousSessionSchema,
      { method: "POST" },
    );
    writeStoredSessionToken(session.token);
    return session;
  };

  const ensureSessionToken = async (): Promise<string> => {
    const storedToken = readStoredSessionToken();
    if (storedToken !== null) return storedToken;
    const session = await createAnonymousSession();
    return session.token;
  };

  const requestAuthorizedJSON = async <TValue>(
    path: string,
    schema: z.ZodType<TValue>,
    init?: RequestInit,
  ): Promise<TValue> => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const authToken = await ensureSessionToken();
      const response = await fetch(new URL(path, baseURL), {
        ...init,
        headers: { ...init?.headers, Authorization: `Bearer ${authToken}` },
      });
      const payload = await response.json().catch(() => null);
      const errorPayload = ErrorResponseSchema.safeParse(payload);

      if (response.status === 401 && attempt === 0) {
        writeStoredSessionToken(null);
        continue;
      }
      if (!response.ok) {
        throw new Error(
          errorPayload.success
            ? (errorPayload.data.error ?? `request_failed_${response.status}`)
            : `request_failed_${response.status}`,
        );
      }
      return schema.parse(payload);
    }
    throw new Error("unauthorized");
  };

  return {
    baseURL: baseURL.replace(/\/$/u, ""),
    createInviteURL(roomID) {
      if (typeof window === "undefined") {
        return `?${ROOM_QUERY_KEY}=${encodeURIComponent(roomID)}`;
      }
      const inviteURL = new URL(window.location.href);
      inviteURL.searchParams.set(ROOM_QUERY_KEY, roomID);
      return inviteURL.toString();
    },
    async createRoom() {
      return requestAuthorizedJSON("/api/dev/rooms", LobbySnapshotSchema, {
        method: "POST",
      });
    },
    async joinRoom(roomID) {
      return requestAuthorizedJSON(
        `/api/dev/rooms/${encodeURIComponent(roomID)}/lobby-token`,
        LobbySnapshotSchema,
        { method: "POST" },
      );
    },
    readRoomIDFromLocation() {
      if (typeof window === "undefined") return null;
      return new URLSearchParams(window.location.search).get(ROOM_QUERY_KEY);
    },
    writeRoomIDToLocation(roomID) {
      if (typeof window === "undefined") return;
      const nextURL = new URL(window.location.href);
      if (roomID === null || roomID.length === 0) {
        nextURL.searchParams.delete(ROOM_QUERY_KEY);
      } else {
        nextURL.searchParams.set(ROOM_QUERY_KEY, roomID);
      }
      window.history.replaceState({}, "", nextURL);
    },
    toBridgeInit(snapshot): BridgeInit {
      return {
        roomID: snapshot.roomID,
        userID: snapshot.userID,
        userName: snapshot.userName,
        scope: snapshot.scope,
        token: snapshot.token,
        tokenExpiresAt: snapshot.tokenExpiresAt,
        websocketURL: snapshot.websocketURL,
        targetCapacity: snapshot.targetCapacity,
        minPlayers: snapshot.minPlayers,
        maxPlayers: snapshot.maxPlayers,
        isHost: snapshot.isHost,
        hostUserID: snapshot.hostUserID,
      };
    },
  };
}

async function requestDevJSON<TValue>(
  baseURL: string,
  path: string,
  schema: z.ZodType<TValue>,
  init?: RequestInit,
): Promise<TValue> {
  const response = await fetch(new URL(path, baseURL), init);
  const payload = await response.json().catch(() => null);
  const errorPayload = ErrorResponseSchema.safeParse(payload);
  if (!response.ok) {
    throw new Error(
      errorPayload.success
        ? (errorPayload.data.error ?? `request_failed_${response.status}`)
        : `request_failed_${response.status}`,
    );
  }
  return schema.parse(payload);
}

function getEnvironmentBaseURL(): string {
  const meta = import.meta as ImportMeta & {
    env?: { VITE_OPENTURN_DEV_SERVER_URL?: string };
  };
  return meta.env?.VITE_OPENTURN_DEV_SERVER_URL ?? DEFAULT_BASE_URL;
}

function normalizeBaseURL(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}
