import { z } from "zod";

export const BRIDGE_FRAGMENT_KEY = "openturn-bridge";

// All postMessage kinds are namespaced under `openturn:bridge:*` so the bridge
// channel is unambiguous on a window that may host other iframes.
export const BRIDGE_MESSAGE_NAMESPACE = "openturn:bridge:";

export const BridgeScope = z.enum(["lobby", "game"]);
export type BridgeScope = z.infer<typeof BridgeScope>;

export const BridgeInitSchema = z.object({
  roomID: z.string(),
  userID: z.string(),
  userName: z.string(),
  scope: BridgeScope,
  token: z.string(),
  tokenExpiresAt: z.number().optional(),
  websocketURL: z.string(),
  parentOrigin: z.string().optional(),
  /** Effective seat count for this room (host-mutable). */
  targetCapacity: z.number().int().nonnegative().default(0),
  /** Lower bound for `start`. Static. */
  minPlayers: z.number().int().nonnegative().default(0),
  /** Upper bound on `targetCapacity`. Equals manifest `players.length`. Static. */
  maxPlayers: z.number().int().nonnegative().default(0),
  isHost: z.boolean().default(false),
  hostUserID: z.string().optional(),
  // Present only when scope === "game"; the lobby phase assigns this via
  // `lobby:transition_to_game` over the websocket.
  playerID: z.string().optional(),
});
export type BridgeInit = z.infer<typeof BridgeInitSchema>;

export const BridgeCapabilityPreset = z.enum([
  "share-invite",
  "current-turn",
  "new-game",
  "rules",
]);
export type BridgeCapabilityPreset = z.infer<typeof BridgeCapabilityPreset>;

export type BridgeCapabilitySlot = "header" | "menu";

export interface BridgeCapabilityPresetMeta {
  label: string;
  icon: string;
  slot: BridgeCapabilitySlot;
}

export const BRIDGE_CAPABILITY_PRESETS: Record<
  BridgeCapabilityPreset,
  BridgeCapabilityPresetMeta
> = {
  "share-invite": { label: "Share invite", icon: "share", slot: "menu" },
  "current-turn": { label: "Current turn", icon: "info", slot: "header" },
  "new-game": { label: "New game", icon: "refresh", slot: "header" },
  "rules": { label: "Rules", icon: "book", slot: "menu" },
};

export const BridgeCapabilityDescriptorSchema = z.object({
  preset: BridgeCapabilityPreset,
  disabled: z.boolean().optional(),
  badge: z.union([z.string(), z.number()]).optional(),
});
export type BridgeCapabilityDescriptor = z.infer<
  typeof BridgeCapabilityDescriptorSchema
>;

// Re-export the canonical `JsonValue` from `@openturn/json` so the bridge wire
// shape uses the same type the rest of the workspace targets. The canonical
// type uses `readonly` arrays — bridge messages are immutable in transit, and
// having a single source of truth removes the ad-hoc variance bridge that
// previously forced `as unknown as` casts at workspace boundaries.
import { JsonValueSchema } from "@openturn/json";
export { JsonValueSchema, type JsonValue } from "@openturn/json";

export const BridgeMessageSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("openturn:bridge:ready") }),
  z.object({
    kind: z.literal("openturn:bridge:token-refresh-request"),
    requestID: z.string(),
    roomID: z.string(),
    userID: z.string(),
    scope: BridgeScope,
  }),
  z.object({
    kind: z.literal("openturn:bridge:token-refresh-response"),
    requestID: z.string(),
    token: z.string(),
    tokenExpiresAt: z.number().optional(),
  }),
  z.object({
    kind: z.literal("openturn:bridge:capability-expose"),
    descriptor: BridgeCapabilityDescriptorSchema,
  }),
  z.object({
    kind: z.literal("openturn:bridge:capability-retire"),
    preset: BridgeCapabilityPreset,
  }),
  z.object({
    kind: z.literal("openturn:bridge:capability-invoke"),
    requestID: z.string(),
    preset: BridgeCapabilityPreset,
    args: JsonValueSchema.optional(),
  }),
  z.object({
    kind: z.literal("openturn:bridge:capability-result"),
    requestID: z.string(),
    ok: z.boolean(),
    value: JsonValueSchema.optional(),
    error: z.string().optional(),
  }),
  z.object({ kind: z.literal("openturn:bridge:lifecycle-pause") }),
  z.object({ kind: z.literal("openturn:bridge:lifecycle-resume") }),
  z.object({ kind: z.literal("openturn:bridge:lifecycle-close") }),
  z.object({
    kind: z.literal("openturn:bridge:batch-stream-start"),
    requestID: z.string(),
  }),
  z.object({
    kind: z.literal("openturn:bridge:batch-stream-stop"),
  }),
  z.object({
    kind: z.literal("openturn:bridge:batch-stream-response"),
    requestID: z.string(),
    status: z.enum(["allowed", "denied-by-game", "no-source"]),
  }),
  z.object({
    kind: z.literal("openturn:bridge:initial-snapshot"),
    snapshot: z.unknown(),
  }),
  z.object({
    kind: z.literal("openturn:bridge:batch-applied"),
    batch: z.unknown(),
  }),
  z.object({
    kind: z.literal("openturn:bridge:match-state"),
    matchActive: z.boolean(),
  }),
]);
export type BridgeMessage = z.infer<typeof BridgeMessageSchema>;

export class BridgeUnavailableError extends Error {
  constructor() {
    super("openturn bridge init was not provided to this iframe");
    this.name = "BridgeUnavailableError";
  }
}

export function encodeBridgeFragment(init: BridgeInit): string {
  return `${BRIDGE_FRAGMENT_KEY}=${encodeURIComponent(btoa(JSON.stringify(init)))}`;
}

export function decodeBridgeFragment(hash: string): BridgeInit | null {
  const trimmed = hash.startsWith("#") ? hash.slice(1) : hash;
  if (trimmed.length === 0) return null;
  const params = new URLSearchParams(trimmed);
  const encoded = params.get(BRIDGE_FRAGMENT_KEY);
  if (encoded === null) return null;
  try {
    const decoded = atob(decodeURIComponent(encoded));
    const parsed = BridgeInitSchema.safeParse(JSON.parse(decoded));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function readBridgeFragmentFromLocation(): BridgeInit | null {
  if (typeof window === "undefined") return null;
  return decodeBridgeFragment(window.location.hash);
}
