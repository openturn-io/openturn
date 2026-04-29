import type {
  BatchApplied,
  ClientAction,
  MatchID,
  MatchSnapshot,
  ProtocolErrorCode,
  PlayerViewSnapshot,
  ProtocolClientMessage,
  ProtocolServerMessage,
  ProtocolValue,
  ResyncRequest,
  Revision,
  SyncRequest,
} from "@openturn/protocol";
import {
  parseProtocolServerMessageText,
  stringifyProtocolClientMessage,
} from "@openturn/protocol";

export type HostedConnectionStatus =
  | "idle"
  | "authorizing"
  | "connecting"
  | "connected"
  | "disconnected"
  | "error";

export type HostedSnapshot<
  TPublicState = ProtocolValue,
  TResult = ProtocolValue | null,
> = MatchSnapshot<TPublicState, TResult> | PlayerViewSnapshot<TPublicState, TResult>;

export interface HostedClientState<
  TPublicState = ProtocolValue,
  TResult = ProtocolValue | null,
> {
  error: string | null;
  lastAcknowledgedActionID: string | null;
  lastBatch: BatchApplied<TPublicState, TResult> | null;
  lastEvent: ProtocolServerMessage<TPublicState, TResult> | null;
  snapshot: HostedSnapshot<TPublicState, TResult> | null;
  status: HostedConnectionStatus;
}

export type HostedDispatchOutcome<
  TPublicState = ProtocolValue,
  TResult = ProtocolValue | null,
> =
  | {
      ok: true;
      clientActionID: string;
      batch: BatchApplied<TPublicState, TResult>;
    }
  | {
      ok: false;
      clientActionID: string;
      details?: ProtocolValue;
      error: ProtocolErrorCode | string;
      event?: string;
      reason?: string;
      revision?: Revision;
    };

export interface HostedConnectionDescriptor {
  roomID: MatchID;
  playerID: string;
  getRoomToken: () => Promise<string>;
  createSocketURL?: (context: { playerID: string; roomID: MatchID; token: string }) => string;
}

export interface HostedSocketEventMap {
  close: { code?: number; reason?: string };
  error: { error?: unknown };
  message: { data: string };
  open: Record<string, never>;
}

export interface HostedSocket {
  readonly readyState: number;
  addEventListener<TType extends keyof HostedSocketEventMap>(
    type: TType,
    listener: (event: HostedSocketEventMap[TType]) => void,
  ): void;
  close(code?: number, reason?: string): void;
  removeEventListener<TType extends keyof HostedSocketEventMap>(
    type: TType,
    listener: (event: HostedSocketEventMap[TType]) => void,
  ): void;
  send(data: string): void;
}

export interface HostedTransport {
  createSocket(url: string): HostedSocket;
}

export interface HostedClientOptions<
  TPublicState = ProtocolValue,
  TResult = ProtocolValue | null,
> extends HostedConnectionDescriptor {
  transport?: HostedTransport;
  retainBatchHistory?: boolean;
}

export interface HostedDispatchOptions {
  baseRevision?: Revision;
  clientActionID?: string;
}

export interface HostedClient<
  TPublicState = ProtocolValue,
  TResult = ProtocolValue | null,
> {
  connect(): Promise<void>;
  disconnect(code?: number, reason?: string): void;
  /**
   * Send a dispatch to the hosted room. Resolves with the real outcome:
   * `{ ok: true, batch }` when the server acks the action, or
   * `{ ok: false, error, reason?, details? }` when the server rejects it or
   * the connection drops while the action is in flight.
   */
  dispatchEvent(
    event: string,
    payload: ProtocolValue,
    options?: HostedDispatchOptions,
  ): Promise<HostedDispatchOutcome<TPublicState, TResult>>;
  getState(): HostedClientState<TPublicState, TResult>;
  getBatchHistory(): readonly BatchApplied<TPublicState, TResult>[];
  getInitialSnapshot(): HostedSnapshot<TPublicState, TResult> | null;
  requestResync(sinceRevision?: Revision): void;
  requestSync(): void;
  subscribe(listener: () => void): () => void;
}

const CONNECTING = 0;
const OPEN = 1;

export function createHostedClient<
  TPublicState = ProtocolValue,
  TResult = ProtocolValue | null,
>(
  options: HostedClientOptions<TPublicState, TResult>,
): HostedClient<TPublicState, TResult> {
  let socket: HostedSocket | null = null;
  let connectionGeneration = 0;
  let currentState: HostedClientState<TPublicState, TResult> = {
    error: null,
    lastAcknowledgedActionID: null,
    lastBatch: null,
    lastEvent: null,
    snapshot: null,
    status: "idle",
  };
  let nextActionID = 1;
  const retainHistory = options.retainBatchHistory === true;
  let batchHistory: BatchApplied<TPublicState, TResult>[] = [];
  let initialSnapshot: HostedSnapshot<TPublicState, TResult> | null = null;
  const listeners = new Set<() => void>();
  const pendingDispatches = new Map<
    string,
    (outcome: HostedDispatchOutcome<TPublicState, TResult>) => void
  >();

  const rejectPending = (error: ProtocolErrorCode | string, reason?: string) => {
    if (pendingDispatches.size === 0) return;
    const entries = [...pendingDispatches.entries()];
    pendingDispatches.clear();
    for (const [clientActionID, resolve] of entries) {
      resolve({
        ok: false,
        clientActionID,
        error,
        ...(reason === undefined ? {} : { reason }),
      });
    }
  };

  const notify = () => {
    for (const listener of listeners) {
      listener();
    }
  };

  const setState = (
    patch: Partial<HostedClientState<TPublicState, TResult>>,
  ) => {
    currentState = {
      ...currentState,
      ...patch,
    };
    notify();
  };

  const updateFromMessage = (message: ProtocolServerMessage<TPublicState, TResult>) => {
    const nextSnapshot = selectSnapshot(message);

    if (retainHistory) {
      if (isBatchApplied(message)) {
        const lastRetained = batchHistory[batchHistory.length - 1];
        if (lastRetained === undefined || lastRetained.revision !== message.revision) {
          batchHistory = [...batchHistory, message];
        }
      } else if (initialSnapshot === null && nextSnapshot !== null) {
        initialSnapshot = nextSnapshot;
      }
    }

    if (isBatchApplied(message) && message.ackClientActionID !== undefined && message.ackClientActionID !== null) {
      const pending = pendingDispatches.get(message.ackClientActionID);
      if (pending !== undefined) {
        pendingDispatches.delete(message.ackClientActionID);
        pending({ ok: true, clientActionID: message.ackClientActionID, batch: message });
      }
    } else if (isActionRejected(message)) {
      const pending = pendingDispatches.get(message.clientActionID);
      if (pending !== undefined) {
        pendingDispatches.delete(message.clientActionID);
        pending({
          ok: false,
          clientActionID: message.clientActionID,
          error: message.error,
          ...(message.details === undefined ? {} : { details: message.details }),
          ...(message.event === undefined ? {} : { event: message.event }),
          ...(message.reason === undefined ? {} : { reason: message.reason }),
          ...(message.revision === undefined ? {} : { revision: message.revision }),
        });
      }
    }

    currentState = {
      error: isActionRejected(message) ? message.error : null,
      lastAcknowledgedActionID: isBatchApplied(message) ? message.ackClientActionID ?? null : currentState.lastAcknowledgedActionID,
      lastBatch: isBatchApplied(message) ? message : null,
      lastEvent: message,
      snapshot: nextSnapshot ?? currentState.snapshot,
      status: currentState.status === "error" ? "error" : currentState.status,
    };
    notify();
  };

  const sendMessage = (message: ProtocolClientMessage) => {
    if (socket === null || socket.readyState !== OPEN) {
      throw new Error("Hosted client is not connected.");
    }

    socket.send(stringifyProtocolClientMessage(message));
  };

  const isActiveSocket = (candidate: HostedSocket, generation: number) => {
    return socket === candidate && generation === connectionGeneration;
  };

  return {
    async connect() {
      if (socket !== null && (socket.readyState === CONNECTING || socket.readyState === OPEN)) {
        return;
      }

      const generation = ++connectionGeneration;

      setState({
        error: null,
        lastAcknowledgedActionID: null,
        status: "authorizing",
      });

      let token: string;
      try {
        token = await options.getRoomToken();
      } catch (error) {
        if (generation !== connectionGeneration) {
          return;
        }

        setState({
          error: formatConnectionError(error),
          status: "error",
        });
        return;
      }

      if (generation !== connectionGeneration || socket !== null) {
        return;
      }

      const createSocketURL = options.createSocketURL ?? defaultSocketURL;
      const transport = options.transport ?? createDefaultTransport();
      const nextSocket = transport.createSocket(
        createSocketURL({
          playerID: options.playerID,
          roomID: options.roomID,
          token,
        }),
      );

      const handleOpen = () => {
        if (!isActiveSocket(nextSocket, generation)) {
          return;
        }

        setState({
          error: null,
          status: "connected",
        });

        this.requestSync();
      };

      const handleMessage = (event: HostedSocketEventMap["message"]) => {
        if (!isActiveSocket(nextSocket, generation)) {
          return;
        }

        if (isOutOfBandServerMessage(event.data)) {
          return;
        }

        let parsedMessage: ProtocolServerMessage<TPublicState, TResult>;
        try {
          parsedMessage = parseProtocolServerMessageText<TPublicState, TResult>(event.data);
        } catch (error) {
          setState({
            error: formatConnectionError(error),
            status: "error",
          });
          return;
        }

        updateFromMessage(parsedMessage);
      };

      const handleClose = (event: HostedSocketEventMap["close"]) => {
        if (!isActiveSocket(nextSocket, generation)) {
          return;
        }

        socket = null;
        rejectPending("disconnected", event.reason && event.reason.length > 0 ? event.reason : undefined);
        setState({
          error: event.reason && event.reason.length > 0 ? event.reason : null,
          status: "disconnected",
        });
      };

      const handleError = (event: HostedSocketEventMap["error"]) => {
        if (!isActiveSocket(nextSocket, generation)) {
          return;
        }

        const errorMessage = event.error instanceof Error ? event.error.message : "connection_error";
        rejectPending(errorMessage);
        setState({
          error: errorMessage,
          status: "error",
        });
      };

      setState({ status: "connecting" });

      nextSocket.addEventListener("open", handleOpen);
      nextSocket.addEventListener("message", handleMessage);
      nextSocket.addEventListener("close", handleClose);
      nextSocket.addEventListener("error", handleError);
      socket = nextSocket;
    },
    disconnect(code, reason) {
      connectionGeneration += 1;
      rejectPending("disconnected", reason);

      if (socket === null) {
        setState({
          status: "disconnected",
        });
        return;
      }

      const activeSocket = socket;
      socket = null;
      activeSocket.close(code, reason);
      setState({
        status: "disconnected",
      });
    },
    dispatchEvent(event, payload, dispatchOptions = {}) {
      const clientActionID = dispatchOptions.clientActionID ?? `client_${nextActionID++}`;
      const message: ClientAction = {
        type: "action",
        clientActionID,
        event,
        matchID: options.roomID,
        payload,
        playerID: options.playerID,
        ...(dispatchOptions.baseRevision === undefined ? {} : { baseRevision: dispatchOptions.baseRevision }),
      };

      return new Promise<HostedDispatchOutcome<TPublicState, TResult>>((resolve) => {
        pendingDispatches.set(clientActionID, resolve);
        try {
          sendMessage(message);
        } catch (error) {
          pendingDispatches.delete(clientActionID);
          const reason = error instanceof Error ? error.message : undefined;
          resolve({
            ok: false,
            clientActionID,
            error: "not_connected",
            ...(reason === undefined ? {} : { reason }),
          });
        }
      });
    },
    getState() {
      return currentState;
    },
    getBatchHistory() {
      return batchHistory;
    },
    getInitialSnapshot() {
      return initialSnapshot;
    },
    requestResync(sinceRevision) {
      const message: ResyncRequest = {
        type: "resync",
        matchID: options.roomID,
        playerID: options.playerID,
        sinceRevision: sinceRevision ?? currentState.snapshot?.revision ?? 0,
      };

      sendMessage(message);
    },
    requestSync() {
      const message: SyncRequest = {
        type: "sync",
        matchID: options.roomID,
        playerID: options.playerID,
      };

      sendMessage(message);
    },
    subscribe(listener) {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
  };
}

function selectSnapshot<TPublicState, TResult>(
  message: ProtocolServerMessage<TPublicState, TResult>,
): HostedSnapshot<TPublicState, TResult> | null {
  if (isBatchApplied(message)) {
    return message.snapshot;
  }

  if ("type" in message) {
    return null;
  }

  return message;
}

function isActionRejected<TPublicState, TResult>(
  message: ProtocolServerMessage<TPublicState, TResult>,
): message is Extract<ProtocolServerMessage<TPublicState, TResult>, { type: "action_rejected" }> {
  return "type" in message && message.type === "action_rejected";
}

function isBatchApplied<TPublicState, TResult>(
  message: ProtocolServerMessage<TPublicState, TResult>,
): message is BatchApplied<TPublicState, TResult> {
  return "type" in message && message.type === "batch_applied";
}

function defaultSocketURL(context: { roomID: MatchID; token: string }) {
  const url = new URL(`/rooms/${context.roomID}`, "ws://localhost");
  url.searchParams.set("token", context.token);
  return url.toString();
}

function createDefaultTransport(): HostedTransport {
  return {
    createSocket(url) {
      return new WebSocket(url);
    },
  };
}

function isOutOfBandServerMessage(data: string): boolean {
  try {
    const parsed = JSON.parse(data) as { type?: unknown } | null;
    return (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof parsed.type === "string" &&
      parsed.type.startsWith("openturn:")
    );
  } catch {
    return false;
  }
}

function formatConnectionError(error: unknown): ProtocolErrorCode | string {
  return error instanceof Error ? error.message : typeof error === "string" ? error : "connection_error";
}

export type { BatchApplied, MatchSnapshot, PlayerViewSnapshot, ProtocolValue };
