import { z } from "zod";

export type LobbyPhase = "lobby" | "starting" | "active" | "closed";

/**
 * Discriminated union over seat occupancy. Replaces the legacy
 * `{ userID, userName, ready, connected }` shape; consumers narrow on
 * `kind` to access variant-specific fields.
 *
 * Wire-level invariant: bot and human variants are mutually exclusive on a
 * single seat. The host moves a seat between variants by issuing
 * `lobby:clear_seat` and then `lobby:take_seat` or `lobby:assign_bot`.
 */
export type LobbySeat =
  | { kind: "open"; seatIndex: number }
  | {
      kind: "human";
      seatIndex: number;
      userID: string;
      userName: string | null;
      ready: boolean;
      connected: boolean;
    }
  | {
      kind: "bot";
      seatIndex: number;
      botID: string;
      label: string;
    };

/**
 * Catalog entry broadcast on `lobby:state` so non-host clients can render
 * bot labels in the lobby UI without bundling the game's bot registry.
 */
export type LobbyDifficulty = "easy" | "medium" | "hard" | "expert";

export interface LobbyAvailableBot {
  botID: string;
  label: string;
  description?: string;
  difficulty?: LobbyDifficulty;
}

export type LobbyRejectionReason =
  | "seat_taken"
  | "seat_out_of_range"
  | "not_seated"
  | "already_seated"
  | "not_host"
  | "not_ready"
  | "below_min_players"
  | "bad_phase"
  | "room_closed"
  | "seat_has_bot"
  | "seat_has_human"
  | "unknown_bot"
  | "target_below_min"
  | "target_above_max"
  | "bad_target"
  | "unknown";

export type LobbyCloseReason = "host_left" | "host_close" | "room_closed";

export interface LobbyTakeSeat {
  type: "lobby:take_seat";
  seatIndex: number;
}

export interface LobbyLeaveSeat {
  type: "lobby:leave_seat";
}

export interface LobbySetReady {
  type: "lobby:set_ready";
  ready: boolean;
}

export interface LobbyStart {
  type: "lobby:start";
}

export interface LobbyClose {
  type: "lobby:close";
}

/** Host-only: assign a bot from the registry to a target seat. */
export interface LobbyAssignBot {
  type: "lobby:assign_bot";
  seatIndex: number;
  botID: string;
}

/** Host-only: clear whatever (bot or human) currently occupies a seat. */
export interface LobbyClearSeat {
  type: "lobby:clear_seat";
  seatIndex: number;
}

/**
 * Host-only: change the room's effective capacity within `[minPlayers,
 * maxPlayers]`. Lowering capacity evicts seats whose `seatIndex >=
 * targetCapacity` (humans become unseated, bots are cleared).
 */
export interface LobbySetTargetCapacity {
  type: "lobby:set_target_capacity";
  targetCapacity: number;
}

export type LobbyClientMessage =
  | LobbyTakeSeat
  | LobbyLeaveSeat
  | LobbySetReady
  | LobbyStart
  | LobbyClose
  | LobbyAssignBot
  | LobbyClearSeat
  | LobbySetTargetCapacity;

export interface LobbyStateMessage {
  type: "lobby:state";
  roomID: string;
  phase: LobbyPhase;
  hostUserID: string;
  seats: readonly LobbySeat[];
  /** Lower bound for `lobby:start`. Static across the room's lifetime. */
  minPlayers: number;
  /** Upper bound on `targetCapacity`. Equals manifest `players.length`. Static. */
  maxPlayers: number;
  /**
   * Effective capacity for this room — host-mutable in `[minPlayers, maxPlayers]`.
   * `seats.length === targetCapacity` and seat indexes outside `[0,
   * targetCapacity)` are not visible to clients.
   */
  targetCapacity: number;
  canStart: boolean;
  /** Catalog of bots available for assignment in this room. May be empty. */
  availableBots: readonly LobbyAvailableBot[];
}

export interface LobbyRejectedMessage {
  type: "lobby:rejected";
  reason: LobbyRejectionReason;
  echoType?: LobbyClientMessage["type"];
  message?: string;
}

/**
 * Final post-lobby seat assignment broadcast to every recipient. Includes
 * `playerAssignments` so the bot supervisor (which only sees the host's
 * authoritative copy) can map bot seats to their freshly-minted playerIDs.
 */
export interface LobbyTransitionToGameMessage {
  type: "lobby:transition_to_game";
  roomID: string;
  /** The recipient's assigned playerID. Recipients are always seated humans. */
  playerID: string;
  /** The recipient's freshly-minted game-scope room token. */
  roomToken: string;
  tokenExpiresAt: number;
  websocketURL: string;
  /**
   * Sparse map of every assigned seat (humans + bots). Open seats are
   * omitted. Tokens are NEVER included — bot tokens stay server-side and
   * are consumed by the bot supervisor; this map is purely for UI rendering
   * (e.g. "Player 1 (you) vs Bot · Random") and for the supervisor on the
   * host side which sees the same `LobbyStartAssignment` via the runtime.
   */
  playerAssignments: readonly LobbyPlayerAssignment[];
}

export interface LobbyPlayerAssignment {
  seatIndex: number;
  playerID: string;
  kind: "human" | "bot";
  /** Present when `kind === "bot"`. */
  botID?: string;
}

export interface LobbyClosedMessage {
  type: "lobby:closed";
  reason: LobbyCloseReason;
}

export type LobbyServerMessage =
  | LobbyStateMessage
  | LobbyRejectedMessage
  | LobbyTransitionToGameMessage
  | LobbyClosedMessage;

export const LobbyPhaseSchema = z.enum([
  "lobby",
  "starting",
  "active",
  "closed",
] satisfies readonly LobbyPhase[]);

export const LobbyDifficultySchema = z.enum([
  "easy",
  "medium",
  "hard",
  "expert",
] satisfies readonly LobbyDifficulty[]);

export const LobbyAvailableBotSchema = z.object({
  botID: z.string().min(1),
  label: z.string(),
  description: z.string().optional(),
  difficulty: LobbyDifficultySchema.optional(),
});

export const LobbySeatSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("open"),
    seatIndex: z.number().int().nonnegative(),
  }),
  z.object({
    kind: z.literal("human"),
    seatIndex: z.number().int().nonnegative(),
    userID: z.string(),
    userName: z.string().nullable(),
    ready: z.boolean(),
    connected: z.boolean(),
  }),
  z.object({
    kind: z.literal("bot"),
    seatIndex: z.number().int().nonnegative(),
    botID: z.string().min(1),
    label: z.string(),
  }),
]);

export const LobbyClientMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("lobby:take_seat"), seatIndex: z.number().int().nonnegative() }),
  z.object({ type: z.literal("lobby:leave_seat") }),
  z.object({ type: z.literal("lobby:set_ready"), ready: z.boolean() }),
  z.object({ type: z.literal("lobby:start") }),
  z.object({ type: z.literal("lobby:close") }),
  z.object({
    type: z.literal("lobby:assign_bot"),
    seatIndex: z.number().int().nonnegative(),
    botID: z.string().min(1),
  }),
  z.object({
    type: z.literal("lobby:clear_seat"),
    seatIndex: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal("lobby:set_target_capacity"),
    targetCapacity: z.number().int().positive(),
  }),
]);

export const LobbyStateMessageSchema = z.object({
  type: z.literal("lobby:state"),
  roomID: z.string(),
  phase: LobbyPhaseSchema,
  hostUserID: z.string(),
  seats: z.array(LobbySeatSchema),
  minPlayers: z.number().int().nonnegative(),
  maxPlayers: z.number().int().nonnegative(),
  targetCapacity: z.number().int().nonnegative(),
  canStart: z.boolean(),
  availableBots: z.array(LobbyAvailableBotSchema).default([]),
});

export const LobbyRejectedMessageSchema = z.object({
  type: z.literal("lobby:rejected"),
  reason: z.enum([
    "seat_taken",
    "seat_out_of_range",
    "not_seated",
    "already_seated",
    "not_host",
    "not_ready",
    "below_min_players",
    "bad_phase",
    "room_closed",
    "seat_has_bot",
    "seat_has_human",
    "unknown_bot",
    "target_below_min",
    "target_above_max",
    "bad_target",
    "unknown",
  ] satisfies readonly LobbyRejectionReason[]),
  echoType: z
    .enum([
      "lobby:take_seat",
      "lobby:leave_seat",
      "lobby:set_ready",
      "lobby:start",
      "lobby:close",
      "lobby:assign_bot",
      "lobby:clear_seat",
      "lobby:set_target_capacity",
    ])
    .optional(),
  message: z.string().optional(),
});

export const LobbyPlayerAssignmentSchema = z.object({
  seatIndex: z.number().int().nonnegative(),
  playerID: z.string(),
  kind: z.enum(["human", "bot"]),
  botID: z.string().optional(),
});

export const LobbyTransitionToGameMessageSchema = z.object({
  type: z.literal("lobby:transition_to_game"),
  roomID: z.string(),
  playerID: z.string(),
  roomToken: z.string(),
  tokenExpiresAt: z.number().int(),
  websocketURL: z.string(),
  playerAssignments: z.array(LobbyPlayerAssignmentSchema).default([]),
});

export const LobbyClosedMessageSchema = z.object({
  type: z.literal("lobby:closed"),
  reason: z.enum(["host_left", "host_close", "room_closed"] satisfies readonly LobbyCloseReason[]),
});

export const LobbyServerMessageSchema = z.discriminatedUnion("type", [
  LobbyStateMessageSchema,
  LobbyRejectedMessageSchema,
  LobbyTransitionToGameMessageSchema,
  LobbyClosedMessageSchema,
]);

export function parseLobbyClientMessage(value: unknown): LobbyClientMessage {
  return LobbyClientMessageSchema.parse(value) as LobbyClientMessage;
}

export function parseLobbyClientMessageText(text: string): LobbyClientMessage {
  return parseLobbyClientMessage(JSON.parse(text));
}

export function stringifyLobbyClientMessage(message: LobbyClientMessage): string {
  return JSON.stringify(LobbyClientMessageSchema.parse(message));
}

export function parseLobbyServerMessage(value: unknown): LobbyServerMessage {
  return LobbyServerMessageSchema.parse(value) as LobbyServerMessage;
}

export function parseLobbyServerMessageText(text: string): LobbyServerMessage {
  return parseLobbyServerMessage(JSON.parse(text));
}

export function stringifyLobbyServerMessage(message: LobbyServerMessage): string {
  return JSON.stringify(LobbyServerMessageSchema.parse(message));
}

export function isLobbyClientMessageText(text: string): boolean {
  try {
    const parsed = JSON.parse(text) as { type?: unknown };
    return typeof parsed.type === "string" && parsed.type.startsWith("lobby:");
  } catch {
    return false;
  }
}
