import type {
  GameActionRecord,
  GameGraph,
  GameObservedTransition,
  GameSnapshot,
  GameStep,
  ReplayValue as CoreReplayValue,
} from "@openturn/core";
import {
  InvalidJsonValueError,
  JsonValueSchema,
  cloneJsonValue,
  parseJsonText,
  parseJsonValue,
  stringifyJson,
  type JsonValue,
} from "@openturn/json";
import { z } from "zod";

export type MatchID = string;
export type Revision = number;
export type ProtocolPlayerID = string;
export type ProtocolValue = JsonValue;

export interface ProtocolControlMetadataEntry {
  key: string;
  value: ProtocolValue;
}

export interface ProtocolControlMeta {
  deadline: number | null;
  label: string | null;
  metadata: readonly ProtocolControlMetadataEntry[];
  pendingTargets: readonly string[];
}

export interface ProtocolDerivedState {
  activePlayers: readonly ProtocolPlayerID[];
  control: ProtocolValue | null;
  controlMeta: ProtocolControlMeta;
  selectors: Readonly<Record<string, ProtocolValue>>;
}

export interface ProtocolRuntimeState {
  node: string;
  path: readonly string[];
  turn: number;
}

export interface ProtocolActionRecord {
  actionID: string;
  at: number;
  event: string;
  payload: ProtocolValue;
  playerID: ProtocolPlayerID;
  turn: number;
  type: "event";
}

export interface ProtocolInternalEventRecord {
  actionID: string;
  at: number;
  event: string;
  payload: ProtocolValue;
  playerID: null;
  turn: number;
  type: "internal";
}

export type ProtocolEventRecord = ProtocolActionRecord | ProtocolInternalEventRecord;

export interface ProtocolQueuedEventRecord {
  kind: string;
  payload: ProtocolValue;
}

export interface ProtocolTransitionCandidateEvaluation {
  details?: ProtocolValue | undefined;
  from: string;
  matched: boolean;
  reason?: string | undefined;
  rejectedBy: "reject" | "resolver" | null;
  resolver: string | null;
  to: string;
}

export interface ProtocolTransitionFamilyEvaluation {
  event: string;
  from: string;
  matchedTo: string | null;
  outcome: "ambiguous" | "no_match" | "selected";
  path: readonly string[];
  transitions: readonly ProtocolTransitionCandidateEvaluation[];
}

export interface ProtocolObservedTransition {
  enqueued: readonly ProtocolQueuedEventRecord[];
  event: string;
  evaluations: readonly ProtocolTransitionFamilyEvaluation[];
  from: string;
  fromPath: readonly string[];
  matchedFrom: string;
  matchedFromPath: readonly string[];
  resolver: string | null;
  rng: { after: number; before: number; draws: number } | null;
  to: string;
  toPath: readonly string[];
  turn: "increment" | "preserve";
}

export interface MatchSnapshot<
  TPublicState = ProtocolValue,
  TResult = ProtocolValue | null,
> {
  derived: ProtocolDerivedState;
  G: TPublicState;
  log: readonly ProtocolActionRecord[];
  matchID: MatchID;
  position: ProtocolRuntimeState;
  result: TResult;
  revision: Revision;
}

export interface PlayerViewSnapshot<
  TPublicState = ProtocolValue,
  TResult = ProtocolValue | null,
> extends MatchSnapshot<TPublicState, TResult> {
  playerID: ProtocolPlayerID;
}

export interface ProtocolStep<
  TPublicState = ProtocolValue,
  TResult = ProtocolValue | null,
> {
  event: ProtocolEventRecord;
  kind: "action" | "internal";
  snapshot: MatchSnapshot<TPublicState, TResult> | PlayerViewSnapshot<TPublicState, TResult>;
  transition: ProtocolObservedTransition;
}

export interface ProtocolGraphNode {
  id: string;
  kind: "compound" | "leaf";
  parent: string | null;
  path: readonly string[];
}

export interface ProtocolGraphEdge {
  event: string;
  from: string;
  resolver: string | null;
  to: string;
  turn: "increment" | "preserve";
}

export interface ProtocolGraph {
  edges: readonly ProtocolGraphEdge[];
  initial: string;
  nodes: readonly ProtocolGraphNode[];
}

export interface ProtocolHistoryBranch {
  branchID: string;
  createdAtActionID: string | null;
  createdAtRevision: number;
  headActionID: string | null;
  parentBranchID: string | null;
}

export interface ClientAction<
  TEvent extends string = string,
  TPayload extends ProtocolValue = ProtocolValue,
> {
  type: "action";
  matchID: MatchID;
  playerID: ProtocolPlayerID;
  event: TEvent;
  payload: TPayload;
  clientActionID: string;
  baseRevision?: Revision;
}

export interface SyncRequest {
  type: "sync";
  matchID: MatchID;
  playerID: ProtocolPlayerID;
}

export interface ResyncRequest {
  type: "resync";
  matchID: MatchID;
  playerID: ProtocolPlayerID;
  sinceRevision: Revision;
}

export type ProtocolErrorCode =
  | "ambiguous_transition"
  | "game_over"
  | "inactive_player"
  | "invalid_event"
  | "invalid_transition_result"
  | "non_serializable_args"
  | "stale_revision"
  | "unauthorized"
  | "unknown_event"
  | "unknown_match"
  | "unknown_player";

export interface ProtocolErrorDetail {
  code: string;
  message: string;
  path?: string;
  stepID?: string;
}

export interface BatchApplied<
  TPublicState = ProtocolValue,
  TResult = ProtocolValue | null,
> {
  type: "batch_applied";
  matchID: MatchID;
  revision: Revision;
  snapshot: MatchSnapshot<TPublicState, TResult> | PlayerViewSnapshot<TPublicState, TResult>;
  steps: readonly ProtocolStep<TPublicState, TResult>[];
  ackClientActionID?: string;
  branch?: ProtocolHistoryBranch;
}

export interface ActionRejected {
  type: "action_rejected";
  matchID: MatchID;
  clientActionID: string;
  detail?: ProtocolErrorDetail;
  details?: ProtocolValue | undefined;
  error: ProtocolErrorCode;
  event?: string | undefined;
  reason?: string | undefined;
  revision?: Revision;
}

export interface SaveRequest {
  type: "save-request";
  matchID: MatchID;
  playerID: string;
  clientRequestID: string;
}

export interface SaveReady {
  type: "save-ready";
  matchID: MatchID;
  clientRequestID: string;
  saveID: string;
  downloadURL?: string;
}

export interface SaveError {
  type: "save-error";
  matchID: MatchID;
  clientRequestID: string;
  reason: string;
}

export type ProtocolClientMessage =
  | ClientAction
  | SyncRequest
  | ResyncRequest
  | SaveRequest;
export type ProtocolServerMessage<
  TPublicState = ProtocolValue,
  TResult = ProtocolValue | null,
> =
  | MatchSnapshot<TPublicState, TResult>
  | PlayerViewSnapshot<TPublicState, TResult>
  | BatchApplied<TPublicState, TResult>
  | ActionRejected
  | SaveReady
  | SaveError;

const finiteNumberSchema = z.number().finite();
const protocolErrorCodeSchema = z.enum([
  "ambiguous_transition",
  "game_over",
  "inactive_player",
  "invalid_event",
  "invalid_transition_result",
  "non_serializable_args",
  "stale_revision",
  "unauthorized",
  "unknown_event",
  "unknown_match",
  "unknown_player",
] satisfies readonly ProtocolErrorCode[]);

export const ProtocolControlMetadataEntrySchema = z.object({
  key: z.string(),
  value: JsonValueSchema,
});

export const ProtocolControlMetaSchema = z.object({
  deadline: finiteNumberSchema.nullable(),
  label: z.string().nullable(),
  metadata: z.array(ProtocolControlMetadataEntrySchema),
  pendingTargets: z.array(z.string()),
});

export const ProtocolDerivedStateSchema = z.object({
  activePlayers: z.array(z.string()),
  control: JsonValueSchema.nullable(),
  controlMeta: ProtocolControlMetaSchema,
  selectors: z.record(z.string(), JsonValueSchema),
});

export const ProtocolRuntimeStateSchema = z.object({
  node: z.string(),
  path: z.array(z.string()),
  turn: finiteNumberSchema.int(),
});

export const ProtocolActionRecordSchema = z.object({
  actionID: z.string(),
  at: finiteNumberSchema,
  event: z.string(),
  payload: JsonValueSchema,
  playerID: z.string(),
  turn: finiteNumberSchema.int(),
  type: z.literal("event"),
});

export const ProtocolInternalEventRecordSchema = z.object({
  actionID: z.string(),
  at: finiteNumberSchema,
  event: z.string(),
  payload: JsonValueSchema,
  playerID: z.null(),
  turn: finiteNumberSchema.int(),
  type: z.literal("internal"),
});

export const ProtocolEventRecordSchema = z.union([
  ProtocolActionRecordSchema,
  ProtocolInternalEventRecordSchema,
]);

export const ProtocolQueuedEventRecordSchema = z.object({
  kind: z.string(),
  payload: JsonValueSchema,
});

export const ProtocolTransitionCandidateEvaluationSchema = z.object({
  details: JsonValueSchema.optional(),
  from: z.string(),
  matched: z.boolean(),
  reason: z.string().optional(),
  rejectedBy: z.union([z.literal("reject"), z.literal("resolver"), z.null()]),
  resolver: z.string().nullable(),
  to: z.string(),
});

export const ProtocolTransitionFamilyEvaluationSchema = z.object({
  event: z.string(),
  from: z.string(),
  matchedTo: z.string().nullable(),
  outcome: z.enum(["ambiguous", "no_match", "selected"]),
  path: z.array(z.string()),
  transitions: z.array(ProtocolTransitionCandidateEvaluationSchema),
});

export const ProtocolObservedTransitionSchema = z.object({
  enqueued: z.array(ProtocolQueuedEventRecordSchema),
  event: z.string(),
  evaluations: z.array(ProtocolTransitionFamilyEvaluationSchema),
  from: z.string(),
  fromPath: z.array(z.string()),
  matchedFrom: z.string(),
  matchedFromPath: z.array(z.string()),
  resolver: z.string().nullable(),
  rng: z.object({
    after: finiteNumberSchema,
    before: finiteNumberSchema,
    draws: finiteNumberSchema.int(),
  }).nullable(),
  to: z.string(),
  toPath: z.array(z.string()),
  turn: z.enum(["increment", "preserve"]),
});

export const MatchSnapshotSchema = z.object({
  derived: ProtocolDerivedStateSchema,
  G: JsonValueSchema,
  log: z.array(ProtocolActionRecordSchema),
  matchID: z.string(),
  position: ProtocolRuntimeStateSchema,
  result: JsonValueSchema.nullable(),
  revision: finiteNumberSchema.int(),
});

export const PlayerViewSnapshotSchema = MatchSnapshotSchema.extend({
  playerID: z.string(),
});

const SnapshotSchema = z.union([PlayerViewSnapshotSchema, MatchSnapshotSchema]);

export const ProtocolStepSchema = z.object({
  event: ProtocolEventRecordSchema,
  kind: z.enum(["action", "internal"]),
  snapshot: SnapshotSchema,
  transition: ProtocolObservedTransitionSchema,
});

export const ProtocolHistoryBranchSchema = z.object({
  branchID: z.string(),
  createdAtActionID: z.string().nullable(),
  createdAtRevision: finiteNumberSchema.int(),
  headActionID: z.string().nullable(),
  parentBranchID: z.string().nullable(),
});

export const ClientActionSchema = z.object({
  type: z.literal("action"),
  matchID: z.string(),
  playerID: z.string(),
  event: z.string(),
  payload: JsonValueSchema,
  clientActionID: z.string(),
  baseRevision: finiteNumberSchema.int().optional(),
});

export const SyncRequestSchema = z.object({
  type: z.literal("sync"),
  matchID: z.string(),
  playerID: z.string(),
});

export const ResyncRequestSchema = z.object({
  type: z.literal("resync"),
  matchID: z.string(),
  playerID: z.string(),
  sinceRevision: finiteNumberSchema.int(),
});

export const ActionRejectedSchema = z.object({
  type: z.literal("action_rejected"),
  matchID: z.string(),
  clientActionID: z.string(),
  detail: z.object({
    code: z.string(),
    message: z.string(),
    path: z.string().optional(),
    stepID: z.string().optional(),
  }).optional(),
  details: JsonValueSchema.optional(),
  error: protocolErrorCodeSchema,
  event: z.string().optional(),
  reason: z.string().optional(),
  revision: finiteNumberSchema.int().optional(),
});

export const BatchAppliedSchema = z.object({
  type: z.literal("batch_applied"),
  matchID: z.string(),
  revision: finiteNumberSchema.int(),
  snapshot: SnapshotSchema,
  steps: z.array(ProtocolStepSchema),
  ackClientActionID: z.string().optional(),
  branch: ProtocolHistoryBranchSchema.optional(),
});

export const SaveRequestSchema = z.object({
  type: z.literal("save-request"),
  matchID: z.string(),
  playerID: z.string(),
  clientRequestID: z.string(),
});

export const SaveReadySchema = z.object({
  type: z.literal("save-ready"),
  matchID: z.string(),
  clientRequestID: z.string(),
  saveID: z.string(),
  downloadURL: z.string().optional(),
});

export const SaveErrorSchema = z.object({
  type: z.literal("save-error"),
  matchID: z.string(),
  clientRequestID: z.string(),
  reason: z.string(),
});

export const ProtocolClientMessageSchema = z.union([
  ClientActionSchema,
  SyncRequestSchema,
  ResyncRequestSchema,
  SaveRequestSchema,
]);

export const ProtocolServerMessageSchema = z.union([
  PlayerViewSnapshotSchema,
  MatchSnapshotSchema,
  BatchAppliedSchema,
  ActionRejectedSchema,
  SaveReadySchema,
  SaveErrorSchema,
]);

export function parseProtocolClientMessage(value: unknown): ProtocolClientMessage {
  return ProtocolClientMessageSchema.parse(value) as ProtocolClientMessage;
}

export function parseProtocolClientMessageText(text: string): ProtocolClientMessage {
  return parseProtocolClientMessage(parseJsonText(text, "protocol_client_message"));
}

export function stringifyProtocolClientMessage(message: ProtocolClientMessage): string {
  return stringifyJson(parseProtocolClientMessage(message));
}

export function parseProtocolServerMessage<TPublicState = ProtocolValue, TResult = ProtocolValue | null>(
  value: unknown,
): ProtocolServerMessage<TPublicState, TResult> {
  return ProtocolServerMessageSchema.parse(value) as ProtocolServerMessage<TPublicState, TResult>;
}

export function parseProtocolServerMessageText<TPublicState = ProtocolValue, TResult = ProtocolValue | null>(
  text: string,
): ProtocolServerMessage<TPublicState, TResult> {
  return parseProtocolServerMessage(parseJsonText(text, "protocol_server_message"));
}

export function stringifyProtocolServerMessage<
  TPublicState = ProtocolValue,
  TResult = ProtocolValue | null,
>(message: ProtocolServerMessage<TPublicState, TResult>): string {
  return stringifyJson(parseProtocolServerMessage(message));
}

export function protocolizeGameActionRecord(action: GameActionRecord): ProtocolActionRecord {
  return ProtocolActionRecordSchema.parse({
    actionID: action.actionID,
    at: action.at,
    event: action.event,
    payload: cloneJsonValue(action.payload),
    playerID: action.playerID,
    turn: action.turn,
    type: "event",
  });
}

export function protocolizeGameEventRecord(event: GameStep<any>["event"]): ProtocolEventRecord {
  if (event.type === "internal") {
    return ProtocolInternalEventRecordSchema.parse({
      actionID: event.actionID,
      at: event.at,
      event: event.event,
      payload: cloneJsonValue(event.payload),
      playerID: null,
      turn: event.turn,
      type: "internal",
    });
  }

  return protocolizeGameActionRecord(event);
}

export function protocolizeGameObservedTransition(transition: GameObservedTransition): ProtocolObservedTransition {
  return ProtocolObservedTransitionSchema.parse({
    enqueued: transition.enqueued.map((event) => ({
      kind: event.kind,
      payload: cloneJsonValue(event.payload),
    })),
    event: transition.event,
    evaluations: transition.evaluations.map((evaluation) => ({
      event: evaluation.event,
      from: evaluation.from,
      matchedTo: evaluation.matchedTo,
      outcome: evaluation.outcome,
      path: [...evaluation.path],
      transitions: evaluation.transitions.map((candidate) => ({
        ...(candidate.details === undefined ? {} : { details: cloneJsonValue(candidate.details) }),
        from: candidate.from,
        matched: candidate.matched,
        ...(candidate.reason === undefined ? {} : { reason: candidate.reason }),
        rejectedBy: candidate.rejectedBy,
        resolver: candidate.resolver,
        to: candidate.to,
      })),
    })),
    from: transition.from,
    fromPath: [...transition.fromPath],
    matchedFrom: transition.matchedFrom,
    matchedFromPath: [...transition.matchedFromPath],
    resolver: transition.resolver,
    rng: transition.rng === null ? null : { ...transition.rng },
    to: transition.to,
    toPath: [...transition.toPath],
    turn: transition.turn,
  });
}

export function protocolizeGameStep<
  TPublicState = ProtocolValue,
  TResult = ProtocolValue | null,
>(
  step: GameStep<any>,
  snapshot: MatchSnapshot<TPublicState, TResult> | PlayerViewSnapshot<TPublicState, TResult>,
): ProtocolStep<TPublicState, TResult> {
  return ProtocolStepSchema.parse({
    event: protocolizeGameEventRecord(step.event),
    kind: step.kind,
    snapshot,
    transition: protocolizeGameObservedTransition(step.transition),
  }) as unknown as ProtocolStep<TPublicState, TResult>;
}

export function protocolizeGameGraph(graph: GameGraph): ProtocolGraph {
  return {
    edges: graph.edges.map((edge) => ({
      event: edge.event,
      from: edge.from,
      resolver: edge.resolver,
      to: edge.to,
      turn: edge.turn,
    })),
    initial: graph.initial,
    nodes: graph.nodes.map((node) => ({
      id: node.id,
      kind: node.kind,
      parent: node.parent,
      path: [...node.path],
    })),
  };
}

export function protocolizeGameSnapshot<
  TPublicState extends CoreReplayValue,
  TResult extends CoreReplayValue | null,
>(
  snapshot: GameSnapshot<TPublicState, TResult>,
  options: {
    matchID: MatchID;
    revision: Revision;
  },
): MatchSnapshot<TPublicState, TResult> {
  return MatchSnapshotSchema.parse({
    derived: {
      activePlayers: [...snapshot.derived.activePlayers],
      control: cloneJsonValue(snapshot.derived.control),
      controlMeta: {
        deadline: snapshot.derived.controlMeta.deadline,
        label: snapshot.derived.controlMeta.label,
        metadata: snapshot.derived.controlMeta.metadata.map((entry) => ({
          key: entry.key,
          value: cloneJsonValue(entry.value),
        })),
        pendingTargets: [...snapshot.derived.controlMeta.pendingTargets],
      },
      selectors: cloneJsonValue(snapshot.derived.selectors),
    },
    G: cloneJsonValue(snapshot.G),
    log: snapshot.meta.log.map((action) => protocolizeGameActionRecord(action)),
    position: {
      node: snapshot.position.name,
      path: [...snapshot.position.path],
      turn: snapshot.position.turn,
    },
    matchID: options.matchID,
    result: cloneJsonValue(snapshot.meta.result),
    revision: options.revision,
  }) as unknown as MatchSnapshot<TPublicState, TResult>;
}

export function protocolizeValue<TValue extends CoreReplayValue>(value: TValue): TValue {
  return cloneJsonValue(value);
}

export type { JsonValue };
export { InvalidJsonValueError, JsonValueSchema, parseJsonText, parseJsonValue, stringifyJson };

export type {
  LobbyAssignBot,
  LobbyAvailableBot,
  LobbyClearSeat,
  LobbyClientMessage,
  LobbyClose,
  LobbyCloseReason,
  LobbyClosedMessage,
  LobbyDifficulty,
  LobbyLeaveSeat,
  LobbyPhase,
  LobbyPlayerAssignment,
  LobbyRejectionReason,
  LobbyRejectedMessage,
  LobbySeat,
  LobbyServerMessage,
  LobbySetReady,
  LobbyStart,
  LobbyStateMessage,
  LobbyTakeSeat,
  LobbyTransitionToGameMessage,
} from "./lobby";
export {
  LobbyAvailableBotSchema,
  LobbyClientMessageSchema,
  LobbyClosedMessageSchema,
  LobbyDifficultySchema,
  LobbyPhaseSchema,
  LobbyPlayerAssignmentSchema,
  LobbyRejectedMessageSchema,
  LobbySeatSchema,
  LobbyServerMessageSchema,
  LobbyStateMessageSchema,
  LobbyTransitionToGameMessageSchema,
  isLobbyClientMessageText,
  parseLobbyClientMessage,
  parseLobbyClientMessageText,
  parseLobbyServerMessage,
  parseLobbyServerMessageText,
  stringifyLobbyClientMessage,
  stringifyLobbyServerMessage,
} from "./lobby";
