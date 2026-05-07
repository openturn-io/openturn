import {
  snapshotToBridgeInit,
  type BridgeHostTokenContext,
  type BridgeHostTokenRefreshResult,
  type PlayRoomResult,
  type PlayRoomSnapshot,
  type PlayShellAdapter,
  type PresenceSnapshot,
  type RoomActionResult,
  type SaveRoomResult,
} from "@openturn/bridge";

interface DevAdapterInput {
  deploymentID: string;
  gameName: string;
  bundleBase: string;
  multiplayer?: {
    minPlayers: number;
    maxPlayers: number;
    players: readonly string[];
  };
  shellControls?: PlayShellAdapter["meta"]["shellControls"];
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
  const { deploymentID, gameName, bundleBase, multiplayer, shellControls } = input;
  const resolvedBundleURL = new URL(bundleBase, window.location.href).toString();

  function snapshotFromDev(snap: DevLobbySnapshotJSON): PlayRoomSnapshot {
    const out: PlayRoomSnapshot = {
      roomID: snap.roomID,
      userID: snap.userID,
      userName: snap.userName,
      scope: snap.scope,
      token: snap.token,
      tokenExpiresAt: snap.tokenExpiresAt,
      websocketURL: snap.websocketURL,
      bundleURL: resolvedBundleURL,
      deploymentID,
      gameName,
      parentOrigin: window.location.origin,
      targetCapacity: snap.targetCapacity,
      minPlayers: snap.minPlayers,
      maxPlayers: snap.maxPlayers,
      isHost: snap.isHost,
      hostUserID: snap.hostUserID,
    };
    if (snap.playerID !== undefined) {
      out.playerID = snap.playerID;
    }
    return out;
  }

  return {
    meta: {
      deploymentID,
      gameName,
      bundleURL: resolvedBundleURL,
      multiplayer: {
        gameKey: deploymentID,
        deploymentVersion: "dev",
        minPlayers: multiplayer?.minPlayers ?? 0,
        maxPlayers: multiplayer?.maxPlayers ?? 0,
        players: multiplayer?.players ?? [],
      },
      ...(shellControls === undefined ? {} : { shellControls }),
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
        const snap = await requestJSON<DevLobbySnapshotJSON>("/api/dev/rooms", { method: "POST" });
        return { status: "ok", snapshot: snapshotFromDev(snap) };
      } catch (caught) {
        return mapError(caught);
      }
    },
    async joinRoom(roomID): Promise<PlayRoomResult> {
      try {
        const snap = await requestJSON<DevLobbySnapshotJSON>(
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
        const refreshed = await requestJSON<DevLobbySnapshotJSON>(
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
        const uploadResponse = await fetch("/api/dev/saves", {
          method: "POST",
          headers: { "Content-Type": "application/octet-stream" },
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
        const newRoom = await requestJSON<DevLobbySnapshotJSON>(
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
        const result = await requestJSON<{ saveID: string; downloadURL?: string }>(
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
        await requestJSON(`/api/dev/rooms/${encodeURIComponent(roomID)}/reset`, { method: "POST" });
        return { status: "ok" };
      } catch (caught) {
        return mapRoomActionError(caught);
      }
    },
    async returnToLobby(roomID) {
      try {
        await requestJSON(`/api/dev/rooms/${encodeURIComponent(roomID)}/return-to-lobby`, {
          method: "POST",
        });
        return { status: "ok" };
      } catch (caught) {
        return mapRoomActionError(caught);
      }
    },
    async pollPresence(roomID, signal): Promise<PresenceSnapshot | null> {
      try {
        const raw = await requestJSON<DevPresenceJSON>(
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

// All `/api/dev/*` requests rely on the better-auth session cookie that the
// server primes on the play-shell HTML response. fetch sends same-origin
// cookies by default, so no header plumbing is required here. A 401 means the
// cookie expired or was cleared mid-session — reload to let the server
// re-prime, then bubble the error so `mapError` can surface "unauthorized".
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
    if (response.status === 401 && typeof window !== "undefined") {
      window.location.reload();
    }
    throw error;
  }
  return payload as T;
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

function mapRoomActionError(caught: unknown): RoomActionResult {
  const err = caught as { status?: number; message?: string };
  const reason = err.message ?? String(caught);
  if (err.status === 401) return { status: "unauthorized", reason };
  if (err.status === 404) return { status: "not_found", reason };
  return { status: "rejected", reason };
}
