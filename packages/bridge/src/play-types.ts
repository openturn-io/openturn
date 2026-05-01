import type { BridgeInit, BridgeScope } from "./schema";
import type { BridgeHostTokenContext, BridgeHostTokenRefreshResult } from "./host";

// Snapshot a shell needs to enter a room. Promoted from openturn-cloud's
// PlayRoomSnapshot so both shells (CLI dev + cloud) share the type. The wire
// shape is already nearly identical; CLI dev's `lobby-token` JSON is a
// superset of what's listed here.
export interface PlayRoomSnapshot {
  roomID: string;
  userID: string;
  userName: string;
  scope: BridgeScope;
  token: string;
  tokenExpiresAt: number;
  websocketURL: string;
  bundleURL: string;
  deploymentID: string;
  gameName: string;
  parentOrigin: string;
  targetCapacity: number;
  minPlayers: number;
  maxPlayers: number;
  isHost: boolean;
  hostUserID: string;
  visibility?: PlayRoomVisibility;
  /** Set when scope === "game"; identifies which seat this client owns. */
  playerID?: string;
}

export type PlayRoomVisibility = "private" | "public";

export type PlayRoomStatus =
  | "ok"
  | "unauthorized"
  | "not_found"
  | "invalid_runtime"
  | "missing_request_origin"
  | "deployment_version_mismatch"
  | "save_error"
  | "rejected";

export type PlayRoomResult =
  | { status: "ok"; snapshot: PlayRoomSnapshot }
  | { status: Exclude<PlayRoomStatus, "ok">; reason?: string };

export type SaveRoomResult =
  | { status: "ok"; saveID: string; downloadURL?: string; bytes?: Uint8Array }
  | { status: "unauthorized" | "not_found" | "save_error"; reason?: string };

export type SetVisibilityResult =
  | { status: "ok"; visibility: PlayRoomVisibility }
  | { status: "unauthorized" | "not_found" | "forbidden"; reason?: string };

export type RoomActionResult =
  | { status: "ok" }
  | { status: "not_found" | "unauthorized" | "rejected"; reason?: string };

export interface PresenceSeat {
  seatIndex: number;
  userID: string | null;
  userName: string | null;
  connected: boolean;
  ready: boolean;
}

export interface PresenceSnapshot {
  phase: "lobby" | "active" | "ended";
  seats: readonly PresenceSeat[];
}

export interface PublicRoomSummary {
  roomID: string;
  status: string;
  hostUserID: string;
  createdAt: string;
  lastActiveAt: string;
}

export interface PlayMultiplayerConfig {
  gameKey: string;
  deploymentVersion: string;
  minPlayers: number;
  maxPlayers: number;
  players: readonly string[];
}

export interface PlayShellAdapterMeta {
  deploymentID: string;
  gameName: string;
  bundleURL: string;
  multiplayer: PlayMultiplayerConfig | null;
  user?: { name: string } | null;
}

// Discriminated-status adapter interface. Each shell (CLI dev + cloud)
// implements one of these against its own backend (sqlite + /api/dev/* vs
// Postgres + TanStack server functions). <PlayPage> renders feature-gated UI
// based on which optional methods are present.
export interface PlayShellAdapter {
  readonly meta: PlayShellAdapterMeta;

  /** Construct the URL to share for joining `roomID`. */
  inviteURL(roomID: string): string;

  /** Read the initial roomID from the current URL (for deep-link auto-join). */
  readRoomIDFromLocation?(): string | null;

  /** Update the URL to reflect the current roomID without a navigation. */
  writeRoomIDToLocation?(roomID: string | null): void;

  createRoom(): Promise<PlayRoomResult>;
  joinRoom(roomID: string): Promise<PlayRoomResult>;

  /** Token refresh callback handed to `createBridgeHost`. */
  refreshToken(ctx: BridgeHostTokenContext): Promise<BridgeHostTokenRefreshResult | null>;

  /** Pure-derived `BridgeInit` payload for the iframe URL fragment. */
  toBridgeInit(snapshot: PlayRoomSnapshot): BridgeInit;

  // ── optional capabilities (UI gates on presence) ───────────────────────

  /** Upload a save blob and create a new room from it. */
  createRoomFromSave?(bytes: Uint8Array): Promise<PlayRoomResult>;

  /** Snapshot the current room state into a save blob. */
  saveCurrentRoom?(roomID: string): Promise<SaveRoomResult>;

  /** Reset the active match back to its initial state (dev-only by default). */
  resetRoom?(roomID: string): Promise<RoomActionResult>;

  /** End the active match and return everyone to the lobby (dev-only). */
  returnToLobby?(roomID: string): Promise<RoomActionResult>;

  /** One-shot presence read; <PlayerSeats> polls this on a 3 s interval. */
  pollPresence?(roomID: string, signal: AbortSignal): Promise<PresenceSnapshot | null>;

  /** Toggle public/private (cloud-only by default). */
  setVisibility?(roomID: string, visibility: PlayRoomVisibility): Promise<SetVisibilityResult>;

  /** List public rooms for the current deployment (cloud-only by default). */
  listPublicRooms?(): Promise<readonly PublicRoomSummary[]>;
}

export function describeRoomStatus(status: PlayRoomStatus): string {
  switch (status) {
    case "unauthorized":
      return "you need to sign in";
    case "not_found":
      return "deployment or room wasn't found";
    case "invalid_runtime":
      return "deployment isn't a multiplayer build";
    case "missing_request_origin":
      return "server is missing request origin";
    case "deployment_version_mismatch":
      return "save was made for an older deployment";
    case "save_error":
      return "save could not be loaded";
    case "rejected":
      return "request was rejected";
    case "ok":
      return "ok";
  }
}

// RoomIDs are minted server-side as URL-safe identifiers. Reject anything
// outside that alphabet to keep arbitrary user input (URLs, HTML, etc.) from
// flowing into invite links and JSX as a "valid" room ID.
const ROOM_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

// Accepts either a bare room ID or a URL/string that contains `?room=...`.
export function extractRoomID(value: string): string | null {
  const trimmed = value.trim();

  if (trimmed.length === 0) return null;

  if (trimmed.includes("room=")) {
    try {
      const asURL = new URL(trimmed, "https://example.com");
      const param = asURL.searchParams.get("room");
      if (param !== null && ROOM_ID_PATTERN.test(param)) return param;
    } catch {}
    return null;
  }

  return ROOM_ID_PATTERN.test(trimmed) ? trimmed : null;
}

export function snapshotToBridgeInit(snapshot: PlayRoomSnapshot): BridgeInit {
  const init: BridgeInit = {
    roomID: snapshot.roomID,
    userID: snapshot.userID,
    userName: snapshot.userName,
    scope: snapshot.scope,
    token: snapshot.token,
    tokenExpiresAt: snapshot.tokenExpiresAt,
    websocketURL: snapshot.websocketURL,
    parentOrigin: snapshot.parentOrigin,
    targetCapacity: snapshot.targetCapacity,
    minPlayers: snapshot.minPlayers,
    maxPlayers: snapshot.maxPlayers,
    isHost: snapshot.isHost,
    hostUserID: snapshot.hostUserID,
  };
  if (snapshot.playerID !== undefined) {
    init.playerID = snapshot.playerID;
  }
  return init;
}
