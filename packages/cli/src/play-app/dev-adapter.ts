import {
  snapshotToBridgeInit,
  type BridgeHostTokenContext,
  type BridgeHostTokenRefreshResult,
  type PlayRoomResult,
  type PlayRoomSnapshot,
  type PlayShellAdapter,
  type PresenceSnapshot,
  type SaveRoomResult,
} from "@openturn/bridge";

const SESSION_KEY = "openturn.dev.play-token";

interface DevAdapterInput {
  deploymentID: string;
  gameName: string;
  bundleBase: string;
}

interface DevLobbySnapshotJSON {
  roomID: string;
  userID: string;
  userName: string;
  scope: "lobby" | "game";
  token: string;
  tokenExpiresAt: number;
  websocketURL: string;
  targetCapacity: number;
  minPlayers: number;
  maxPlayers: number;
  isHost: boolean;
  hostUserID: string;
  playerID?: string;
}

export function createDevPlayShellAdapter(input: DevAdapterInput): PlayShellAdapter {
  const { deploymentID, gameName, bundleBase } = input;

  async function sessionToken(): Promise<string | null> {
    const stored = sessionStorage.getItem(SESSION_KEY);
    if (stored !== null) {
      const probe = await fetch("/api/dev/me", {
        headers: { authorization: `Bearer ${stored}` },
      }).catch(() => null);
      if (probe?.ok === true) return stored;
      sessionStorage.removeItem(SESSION_KEY);
    }
    const probeNoAuth = await fetch("/api/dev/me").catch(() => null);
    if (probeNoAuth?.ok === true) return null;
    try {
      const session = await requestJSON<{ token: string }>("/api/dev/session/anonymous", {
        method: "POST",
      });
      sessionStorage.setItem(SESSION_KEY, session.token);
      return session.token;
    } catch (caught) {
      const err = caught as { status?: number; payload?: { code?: string } };
      if (
        err.status === 400 &&
        err.payload?.code === "ANONYMOUS_USERS_CANNOT_SIGN_IN_AGAIN_ANONYMOUSLY"
      ) {
        return null;
      }
      throw caught;
    }
  }

  async function authorized<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = await sessionToken();
    try {
      return await requestJSON<T>(path, withAuth(init, token));
    } catch (caught) {
      const err = caught as { status?: number };
      if (err.status !== 401 || token === null) throw caught;
      sessionStorage.removeItem(SESSION_KEY);
    }
    const fresh = await sessionToken();
    return await requestJSON<T>(path, withAuth(init, fresh));
  }

  function snapshotFromDev(snap: DevLobbySnapshotJSON): PlayRoomSnapshot {
    return {
      roomID: snap.roomID,
      userID: snap.userID,
      userName: snap.userName,
      scope: snap.scope,
      token: snap.token,
      tokenExpiresAt: snap.tokenExpiresAt,
      websocketURL: snap.websocketURL,
      bundleURL: bundleBase,
      deploymentID,
      gameName,
      parentOrigin: window.location.origin,
      targetCapacity: snap.targetCapacity,
      minPlayers: snap.minPlayers,
      maxPlayers: snap.maxPlayers,
      isHost: snap.isHost,
      hostUserID: snap.hostUserID,
    };
  }

  return {
    meta: {
      deploymentID,
      gameName,
      bundleURL: bundleBase,
      // Filled in lazily — the dev shell currently runs without static
      // multiplayer config metadata; the snapshot returned by the server
      // carries min/max/players already, so the lobby UI works without it.
      multiplayer: {
        gameKey: deploymentID,
        deploymentVersion: "dev",
        minPlayers: 0,
        maxPlayers: 0,
        players: [],
      },
    },
    inviteURL(roomID) {
      const url = new URL(window.location.href);
      url.pathname = `/play/${deploymentID}`;
      url.searchParams.set("room", roomID);
      return url.toString();
    },
    readRoomIDFromLocation() {
      return new URL(window.location.href).searchParams.get("room");
    },
    writeRoomIDToLocation(roomID) {
      const url = new URL(window.location.href);
      url.pathname = `/play/${deploymentID}`;
      if (roomID === null || roomID.length === 0) {
        url.searchParams.delete("room");
      } else {
        url.searchParams.set("room", roomID);
      }
      window.history.replaceState({}, "", url);
    },
    async createRoom(): Promise<PlayRoomResult> {
      try {
        const snap = await authorized<DevLobbySnapshotJSON>("/api/dev/rooms", { method: "POST" });
        return { status: "ok", snapshot: snapshotFromDev(snap) };
      } catch (caught) {
        return mapError(caught);
      }
    },
    async joinRoom(roomID): Promise<PlayRoomResult> {
      try {
        const snap = await authorized<DevLobbySnapshotJSON>(
          `/api/dev/rooms/${encodeURIComponent(roomID)}/lobby-token`,
          { method: "POST" },
        );
        return { status: "ok", snapshot: snapshotFromDev(snap) };
      } catch (caught) {
        return mapError(caught);
      }
    },
    async refreshToken(_ctx: BridgeHostTokenContext): Promise<BridgeHostTokenRefreshResult | null> {
      try {
        const refreshed = await authorized<DevLobbySnapshotJSON>(
          `/api/dev/rooms/${encodeURIComponent(_ctx.roomID)}/lobby-token`,
          { method: "POST" },
        );
        return { token: refreshed.token, tokenExpiresAt: refreshed.tokenExpiresAt };
      } catch {
        return null;
      }
    },
    toBridgeInit(snapshot) {
      return snapshotToBridgeInit(snapshot);
    },
    async createRoomFromSave(bytes): Promise<PlayRoomResult> {
      try {
        const token = await sessionToken();
        const uploadResponse = await fetch("/api/dev/saves", {
          method: "POST",
          headers: {
            "Content-Type": "application/octet-stream",
            ...(token === null ? {} : { authorization: `Bearer ${token}` }),
          },
          body: new Blob([new Uint8Array(bytes)], { type: "application/octet-stream" }),
        });
        const uploadBody = (await uploadResponse.json().catch(() => null)) as
          | { saveID?: string; error?: string }
          | null;
        if (!uploadResponse.ok || uploadBody?.saveID === undefined) {
          return {
            status: "save_error",
            reason: uploadBody?.error ?? `upload failed (${uploadResponse.status})`,
          };
        }
        const newRoom = await authorized<DevLobbySnapshotJSON>(
          `/api/dev/saves/${encodeURIComponent(uploadBody.saveID)}/new-room`,
          { method: "POST" },
        );
        return { status: "ok", snapshot: snapshotFromDev(newRoom) };
      } catch (caught) {
        return mapError(caught);
      }
    },
    async saveCurrentRoom(roomID): Promise<SaveRoomResult> {
      try {
        const result = await authorized<{ saveID: string; downloadURL?: string }>(
          `/api/dev/rooms/${encodeURIComponent(roomID)}/save`,
          { method: "POST" },
        );
        const out: SaveRoomResult = {
          status: "ok",
          saveID: result.saveID,
        };
        if (result.downloadURL !== undefined) {
          out.downloadURL = result.downloadURL;
        } else {
          out.downloadURL = `/api/dev/saves/${encodeURIComponent(result.saveID)}`;
        }
        return out;
      } catch (caught) {
        const err = caught as { status?: number; message?: string };
        const reason = err.message ?? String(caught);
        return {
          status: err.status === 401 ? "unauthorized" : "save_error",
          reason,
        };
      }
    },
    async resetRoom(roomID) {
      try {
        await authorized(`/api/dev/rooms/${encodeURIComponent(roomID)}/reset`, { method: "POST" });
        return { status: "ok" };
      } catch (caught) {
        const err = caught as { status?: number; message?: string };
        const reason = err.message ?? String(caught);
        if (err.status === 404) return { status: "not_found", reason };
        if (err.status === 401) return { status: "unauthorized", reason };
        return { status: "not_found", reason };
      }
    },
    async returnToLobby(roomID) {
      try {
        await authorized(`/api/dev/rooms/${encodeURIComponent(roomID)}/return-to-lobby`, {
          method: "POST",
        });
        return { status: "ok" };
      } catch (caught) {
        const err = caught as { status?: number; message?: string };
        const reason = err.message ?? String(caught);
        if (err.status === 404) return { status: "not_found", reason };
        if (err.status === 401) return { status: "unauthorized", reason };
        return { status: "not_found", reason };
      }
    },
    async pollPresence(roomID, signal): Promise<PresenceSnapshot | null> {
      try {
        const raw = await authorized<DevPresenceJSON>(
          `/api/dev/rooms/${encodeURIComponent(roomID)}/presence`,
          { signal },
        );
        return normalizeDevPresence(raw);
      } catch {
        return null;
      }
    },
  } satisfies PlayShellAdapter;
}

async function requestJSON<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, init);
  const payload = (await response.json().catch(() => null)) as
    | (T & { error?: string; code?: string })
    | null;
  if (!response.ok) {
    const error = new Error(
      payload?.error ?? payload?.code ?? `request_failed_${response.status}`,
    ) as Error & { status?: number; payload?: unknown };
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload as T;
}

function withAuth(init: RequestInit, token: string | null): RequestInit {
  return {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      ...(token === null ? {} : { authorization: `Bearer ${token}` }),
    },
  };
}

interface DevPresenceJSON {
  phase: "lobby" | "active" | "ended";
  seats: ReadonlyArray<DevPresenceSeat>;
}

type DevPresenceSeat =
  | { kind: "open"; seatIndex: number }
  | {
      kind: "human" | "bot";
      seatIndex: number;
      userID?: string;
      userName?: string;
      ready?: boolean;
      connected?: boolean;
    };

function normalizeDevPresence(raw: DevPresenceJSON): PresenceSnapshot {
  return {
    phase: raw.phase,
    seats: raw.seats.map((seat) => {
      if (seat.kind === "open") {
        return {
          seatIndex: seat.seatIndex,
          userID: null,
          userName: null,
          connected: false,
          ready: false,
        };
      }
      return {
        seatIndex: seat.seatIndex,
        userID: seat.userID ?? null,
        userName: seat.userName ?? null,
        connected: seat.connected ?? false,
        ready: seat.ready ?? false,
      };
    }),
  };
}

function mapError(caught: unknown): PlayRoomResult {
  const err = caught as { status?: number; message?: string };
  const reason = err.message ?? String(caught);
  if (err.status === 401) return { status: "unauthorized", reason };
  if (err.status === 404) return { status: "not_found", reason };
  return { status: "rejected", reason };
}
