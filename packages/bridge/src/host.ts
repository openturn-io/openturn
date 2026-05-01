import {
  BridgeMessageSchema,
  encodeBridgeFragment,
  type BridgeInit,
  type BridgeMessage,
  type BridgeScope,
  type BridgeShellControl,
  type BridgeShellControlPhase,
} from "./schema";

export interface BridgeHostTokenContext {
  roomID: string;
  userID: string;
  scope: BridgeScope;
}

export interface BridgeHostTokenRefreshResult {
  token: string;
  tokenExpiresAt?: number;
}

export interface BridgeHostOptions {
  /** Base URL of the game bundle (iframe src without the fragment). */
  bundleURL: string;
  /** Init payload baked into the iframe URL fragment. */
  init: BridgeInit;
  /**
   * Called when the iframe requests a token refresh. Return null to refuse
   * (the iframe keeps the previous token). This is the single extension point
   * hosts use to plug in their auth backend.
   */
  refreshToken(
    ctx: BridgeHostTokenContext,
  ): Promise<BridgeHostTokenRefreshResult | null>;
  /**
   * Origin filter for incoming messages. Defaults to the bundle URL's origin.
   * Use `"*"` only for local development.
   */
  expectOrigin?: string;
}

export type BridgeHostEventMap = {
  ready: { origin: string };
  "lifecycle-close": Record<string, never>;
  "match-state-changed": { matchActive: boolean };
};
export type BridgeHostEvent = keyof BridgeHostEventMap;

export type BatchStreamStatus = "allowed" | "denied-by-game" | "no-source";

export interface BatchStreamPayload<TInitial = unknown, TBatch = unknown> {
  initialSnapshot: TInitial | null;
  lastBatch: TBatch | null;
}

export type BatchStreamListener<TInitial = unknown, TBatch = unknown> = (
  payload: BatchStreamPayload<TInitial, TBatch>,
) => void;

export interface BridgeHost {
  /** iframe src with the fragment baked in. Assign to `<iframe src>`. */
  readonly src: string;
  /**
   * Whether a match is currently active (past lobby, not ended). Defaults to
   * `init.scope === "game"` until the game sends its first match-state update.
   * Subscribe via `on("match-state-changed", ...)` to react to changes.
   */
  readonly matchActive: boolean;
  /**
   * Notify the game that a shell control was activated. Fired once with
   * `phase: "before"` immediately before the host runs the corresponding
   * adapter method, and once with `phase: "after"` afterwards. Games can
   * subscribe via the bridge event channel to react (e.g. clear local UI).
   */
  emitShellControl(control: BridgeShellControl, phase: BridgeShellControlPhase): void;
  /** Tell the game to pause / resume / close. */
  pause(): void;
  resume(): void;
  close(): void;
  on<K extends BridgeHostEvent>(
    event: K,
    listener: (e: BridgeHostEventMap[K]) => void,
  ): () => void;
  /**
   * Ask the game to start streaming its initial snapshot + batches. The
   * resolved status mirrors the game's response. Once allowed, subsequent
   * batches flow to listeners registered via `onBatch`.
   */
  requestBatchStream(timeoutMs?: number): Promise<BatchStreamStatus>;
  /** Ask the game to stop streaming. Safe to call if no stream is active. */
  stopBatchStream(): void;
  /** Subscribe to streamed batches (and replay the last-seen snapshot / batch). */
  onBatch<TInitial = unknown, TBatch = unknown>(
    listener: BatchStreamListener<TInitial, TBatch>,
  ): () => void;
  dispose(): void;
}

/**
 * Create a shell-side bridge host. Call this once per iframe. Returns a handle
 * with a stable `src` for the iframe and an API for shell-control notification
 * and lifecycle control. Internally listens on `window.message` for the bridge
 * protocol defined in `./schema`.
 */
export function createBridgeHost(options: BridgeHostOptions): BridgeHost {
  if (typeof window === "undefined") {
    throw new Error("createBridgeHost requires a browser window");
  }

  const src = buildIframeSrc(options.bundleURL, options.init);
  const expectOrigin = options.expectOrigin ?? originOf(options.bundleURL);

  const listeners: {
    [K in BridgeHostEvent]: Set<(e: BridgeHostEventMap[K]) => void>;
  } = {
    ready: new Set(),
    "lifecycle-close": new Set(),
    "match-state-changed": new Set(),
  };
  let matchActive = options.init.scope === "game";

  const pendingStreamRequests = new Map<
    string,
    { resolve: (status: BatchStreamStatus) => void; timeout: ReturnType<typeof setTimeout> }
  >();
  const batchListeners = new Set<BatchStreamListener>();
  let lastInitialSnapshot: unknown = null;
  let lastBatch: unknown = null;

  function emit<K extends BridgeHostEvent>(event: K, payload: BridgeHostEventMap[K]) {
    for (const fn of listeners[event]) {
      try {
        (fn as (e: BridgeHostEventMap[K]) => void)(payload);
      } catch {}
    }
  }

  function postToSource(
    source: MessageEventSource | null,
    origin: string,
    message: BridgeMessage,
  ) {
    if (source === null) return;
    const targetOrigin = expectOrigin === "*" ? (origin === "null" ? "*" : origin) : expectOrigin;
    try {
      (source as Window).postMessage(message, targetOrigin);
    } catch {}
  }

  let activeSource: MessageEventSource | null = null;
  let activeOrigin: string | null = null;

  function broadcastToGame(message: BridgeMessage) {
    postToSource(activeSource, activeOrigin ?? "*", message);
  }

  async function onMessage(event: MessageEvent) {
    if (expectOrigin !== "*" && event.origin !== expectOrigin && event.origin !== "null") {
      return;
    }
    const parsed = BridgeMessageSchema.safeParse(event.data);
    if (!parsed.success) return;
    const message = parsed.data;

    // Track the most recent iframe window so we can push lifecycle messages.
    if (event.source !== null) {
      activeSource = event.source;
      activeOrigin = event.origin;
    }

    switch (message.kind) {
      case "openturn:bridge:ready":
        emit("ready", { origin: event.origin });
        return;
      case "openturn:bridge:token-refresh-request": {
        const result = await options
          .refreshToken({
            roomID: message.roomID,
            userID: message.userID,
            scope: message.scope,
          })
          .catch(() => null);
        if (result === null) return;
        postToSource(event.source, event.origin, {
          kind: "openturn:bridge:token-refresh-response",
          requestID: message.requestID,
          token: result.token,
          ...(result.tokenExpiresAt === undefined
            ? {}
            : { tokenExpiresAt: result.tokenExpiresAt }),
        });
        return;
      }
      case "openturn:bridge:lifecycle-close":
        emit("lifecycle-close", {});
        return;
      case "openturn:bridge:batch-stream-response": {
        const pending = pendingStreamRequests.get(message.requestID);
        if (pending === undefined) return;
        pendingStreamRequests.delete(message.requestID);
        clearTimeout(pending.timeout);
        pending.resolve(message.status);
        return;
      }
      case "openturn:bridge:initial-snapshot":
        lastInitialSnapshot = message.snapshot;
        for (const listener of batchListeners) {
          try {
            listener({ initialSnapshot: message.snapshot, lastBatch: null });
          } catch {}
        }
        return;
      case "openturn:bridge:batch-applied":
        lastBatch = message.batch;
        for (const listener of batchListeners) {
          try {
            listener({ initialSnapshot: lastInitialSnapshot, lastBatch: message.batch });
          } catch {}
        }
        return;
      case "openturn:bridge:match-state":
        if (matchActive !== message.matchActive) {
          matchActive = message.matchActive;
          emit("match-state-changed", { matchActive });
        }
        return;
      default:
        return;
    }
  }

  window.addEventListener("message", onMessage);

  return {
    src,
    get matchActive() {
      return matchActive;
    },
    emitShellControl(control, phase) {
      broadcastToGame({
        kind: "openturn:bridge:shell-control",
        control,
        phase,
      });
    },
    pause() {
      broadcastToGame({ kind: "openturn:bridge:lifecycle-pause" });
    },
    resume() {
      broadcastToGame({ kind: "openturn:bridge:lifecycle-resume" });
    },
    close() {
      broadcastToGame({ kind: "openturn:bridge:lifecycle-close" });
    },
    on(event, listener) {
      const set = listeners[event] as Set<typeof listener>;
      set.add(listener);
      return () => set.delete(listener);
    },
    requestBatchStream(timeoutMs = 5_000): Promise<BatchStreamStatus> {
      if (activeSource === null) {
        return Promise.reject(new Error("bridge_not_ready"));
      }
      const requestID = generateRequestID();
      return new Promise<BatchStreamStatus>((resolve) => {
        const timeout = setTimeout(() => {
          pendingStreamRequests.delete(requestID);
          resolve("no-source");
        }, timeoutMs);
        pendingStreamRequests.set(requestID, { resolve, timeout });
        broadcastToGame({
          kind: "openturn:bridge:batch-stream-start",
          requestID,
        });
      });
    },
    stopBatchStream() {
      lastInitialSnapshot = null;
      lastBatch = null;
      if (activeSource === null) return;
      broadcastToGame({ kind: "openturn:bridge:batch-stream-stop" });
    },
    onBatch(listener) {
      batchListeners.add(listener as BatchStreamListener);
      if (lastInitialSnapshot !== null || lastBatch !== null) {
        try {
          (listener as BatchStreamListener)({
            initialSnapshot: lastInitialSnapshot,
            lastBatch,
          });
        } catch {}
      }
      return () => batchListeners.delete(listener as BatchStreamListener);
    },
    dispose() {
      window.removeEventListener("message", onMessage);
      for (const pending of pendingStreamRequests.values()) {
        clearTimeout(pending.timeout);
      }
      pendingStreamRequests.clear();
      batchListeners.clear();
    },
  };
}

function buildIframeSrc(bundleURL: string, init: BridgeInit): string {
  const url = new URL(bundleURL);
  url.hash = encodeBridgeFragment(init);
  return url.toString();
}

function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return "*";
  }
}

function generateRequestID(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `req_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}
