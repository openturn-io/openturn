import type { HostedConnectionDescriptor } from "@openturn/client";

import {
  BridgeMessageSchema,
  BridgeUnavailableError,
  readBridgeFragmentFromLocation,
  type BridgeInit,
  type BridgeMessage,
  type BridgeShellControl,
  type BridgeShellControlPhase,
} from "./schema";

export type BridgeLifecycleEvent = "pause" | "resume" | "close";
export interface BridgeLifecycle {
  on(event: BridgeLifecycleEvent, listener: () => void): () => void;
}

export interface BridgeShellControlEvent {
  control: BridgeShellControl;
  phase: BridgeShellControlPhase;
}

export interface BridgeShellControlChannel {
  /**
   * Subscribe to shell-control activations from the host. Each click fires
   * `phase: "before"` followed by `phase: "after"` once the adapter call
   * settles. Use this to clear local UI on `reset` / `return-to-lobby`, etc.
   */
  on(listener: (event: BridgeShellControlEvent) => void): () => void;
}

export interface BatchSourceHandle<TInitial = unknown, TBatch = unknown> {
  getInitialSnapshot(): TInitial;
  subscribe(listener: (batch: TBatch) => void): () => void;
}

export interface GameBridge {
  /** The static init payload decoded from the URL fragment. Read roomID,
   * userID, scope, etc. via `bridge.init.*`. */
  readonly init: BridgeInit;
  /** Live room token — reflects the latest refresh. Use `refreshToken()` to
   * force a new one bypassing the skew window. */
  readonly token: string;
  readonly connection: HostedConnectionDescriptor | null;
  readonly lifecycle: BridgeLifecycle;
  readonly shellControl: BridgeShellControlChannel;
  /** Force-refresh the room token now, bypassing the skew window. */
  refreshToken(): Promise<string>;
  /** Alias of `refreshToken` used by transport clients that want a fresh token on demand. */
  getRoomToken(): Promise<string>;
  /**
   * Register a source of initial snapshot + ongoing batches so the host can
   * request a live stream (used by the shell-owned inspector). The most recent
   * registration wins; passing null clears the source.
   */
  registerBatchSource(source: BatchSourceHandle | null): void;
  /**
   * Author-side opt-out: when set to false, host-initiated stream requests
   * return "denied-by-game". Default true.
   */
  allowBatchStreaming(allow: boolean): void;
  /**
   * Announce whether a match is currently active (i.e., past lobby, not ended).
   * The shell uses this to enable/disable match-only controls such as Reset.
   * Safe to call repeatedly; duplicate values are coalesced.
   */
  setMatchActive(active: boolean): void;
  dispose(): void;
}

export interface CreateGameBridgeOptions {
  /** Override how to read the init payload. Defaults to fragment decode. */
  readInit?: () => BridgeInit | null;
  /** postMessage target. Defaults to `window.parent`. */
  parent?: Pick<Window, "postMessage"> | null;
  /** Seconds before token expiry at which to auto-refresh. Default 15s. */
  refreshSkewSeconds?: number;
}

export function createGameBridge(
  options: CreateGameBridgeOptions = {},
): GameBridge {
  const initOrNull = (options.readInit ?? readBridgeFragmentFromLocation)();
  if (initOrNull === null) throw new BridgeUnavailableError();
  const init: BridgeInit = initOrNull;

  const refreshSkewMs = (options.refreshSkewSeconds ?? 15) * 1_000;
  const parent =
    options.parent === undefined ? resolveDefaultParent() : options.parent;
  const parentOrigin = init.parentOrigin ?? "*";

  let currentToken = init.token;
  let currentExpiresAt = init.tokenExpiresAt ?? 0;

  const listeners = new Map<BridgeLifecycleEvent, Set<() => void>>();
  const shellControlListeners = new Set<(event: BridgeShellControlEvent) => void>();

  const disposables: Array<() => void> = [];

  let batchSource: BatchSourceHandle | null = null;
  let batchStreamAllowed = true;
  let activeBatchUnsubscribe: (() => void) | null = null;
  let matchActive = init.scope === "game";

  function stopBatchStream() {
    if (activeBatchUnsubscribe !== null) {
      try {
        activeBatchUnsubscribe();
      } catch {}
      activeBatchUnsubscribe = null;
    }
  }

  async function refreshToken(force = false): Promise<string> {
    const hasExpiry = currentExpiresAt > 0;
    const needsRefresh =
      force ||
      !hasExpiry ||
      Date.now() + refreshSkewMs >= currentExpiresAt * 1_000;
    if (!needsRefresh) return currentToken;
    if (parent === null) return currentToken;

    const requestID = generateRequestID();
    const response = await sendRequest(
      parent,
      parentOrigin,
      {
        kind: "openturn:bridge:token-refresh-request",
        requestID,
        roomID: init.roomID,
        userID: init.userID,
        scope: init.scope,
      },
      "openturn:bridge:token-refresh-response",
      (m) => (m.kind === "openturn:bridge:token-refresh-response" && m.requestID === requestID ? m : null),
    );

    if (response !== null && response.kind === "openturn:bridge:token-refresh-response") {
      currentToken = response.token;
      currentExpiresAt = response.tokenExpiresAt ?? 0;
    }
    return currentToken;
  }

  const connection: HostedConnectionDescriptor | null =
    init.scope === "game" && typeof init.playerID === "string"
      ? {
          roomID: init.roomID,
          playerID: init.playerID,
          getRoomToken: () => refreshToken(false),
          createSocketURL({ token }) {
            return buildWebsocketURL(init.websocketURL, token);
          },
        }
      : null;

  function emitLifecycle(event: BridgeLifecycleEvent) {
    const set = listeners.get(event);
    if (set === undefined) return;
    for (const fn of set) {
      try {
        fn();
      } catch {}
    }
  }

  // Listen for host → game messages (lifecycle + shell-control + batch stream).
  if (typeof window !== "undefined") {
    const onMessage = (event: MessageEvent) => {
      const parsed = BridgeMessageSchema.safeParse(event.data);
      if (!parsed.success) return;
      const message = parsed.data;
      switch (message.kind) {
        case "openturn:bridge:lifecycle-pause":
          emitLifecycle("pause");
          break;
        case "openturn:bridge:lifecycle-resume":
          emitLifecycle("resume");
          break;
        case "openturn:bridge:lifecycle-close":
          emitLifecycle("close");
          break;
        case "openturn:bridge:batch-stream-start": {
          if (!batchStreamAllowed) {
            postTo(parent, parentOrigin, {
              kind: "openturn:bridge:batch-stream-response",
              requestID: message.requestID,
              status: "denied-by-game",
            });
            return;
          }
          if (batchSource === null) {
            postTo(parent, parentOrigin, {
              kind: "openturn:bridge:batch-stream-response",
              requestID: message.requestID,
              status: "no-source",
            });
            return;
          }
          stopBatchStream();
          const source = batchSource;
          postTo(parent, parentOrigin, {
            kind: "openturn:bridge:batch-stream-response",
            requestID: message.requestID,
            status: "allowed",
          });
          try {
            const snapshot = source.getInitialSnapshot();
            postTo(parent, parentOrigin, {
              kind: "openturn:bridge:initial-snapshot",
              snapshot,
            });
          } catch {}
          activeBatchUnsubscribe = source.subscribe((batch) => {
            postTo(parent, parentOrigin, {
              kind: "openturn:bridge:batch-applied",
              batch,
            });
          });
          break;
        }
        case "openturn:bridge:batch-stream-stop":
          stopBatchStream();
          break;
        case "openturn:bridge:shell-control": {
          const event: BridgeShellControlEvent = {
            control: message.control,
            phase: message.phase,
          };
          for (const listener of shellControlListeners) {
            try {
              listener(event);
            } catch {}
          }
          break;
        }
        default:
          break;
      }
    };
    window.addEventListener("message", onMessage);
    disposables.push(() => window.removeEventListener("message", onMessage));
  }

  // Announce ready after setup. Also publish the initial match-active state so
  // the host can configure match-only controls before the game's first update.
  postTo(parent, parentOrigin, { kind: "openturn:bridge:ready" });
  postTo(parent, parentOrigin, {
    kind: "openturn:bridge:match-state",
    matchActive,
  });

  const lifecycle: BridgeLifecycle = {
    on(event, listener) {
      let set = listeners.get(event);
      if (set === undefined) {
        set = new Set();
        listeners.set(event, set);
      }
      set.add(listener);
      return () => set?.delete(listener);
    },
  };

  const shellControl: BridgeShellControlChannel = {
    on(listener) {
      shellControlListeners.add(listener);
      return () => shellControlListeners.delete(listener);
    },
  };

  return {
    init,
    get token() {
      return currentToken;
    },
    connection,
    lifecycle,
    shellControl,
    refreshToken: () => refreshToken(true),
    getRoomToken: () => refreshToken(false),
    registerBatchSource(source) {
      batchSource = source;
      if (source === null) {
        stopBatchStream();
      }
    },
    allowBatchStreaming(allow) {
      batchStreamAllowed = allow;
      if (!allow) {
        stopBatchStream();
      }
    },
    setMatchActive(active) {
      if (matchActive === active) return;
      matchActive = active;
      postTo(parent, parentOrigin, {
        kind: "openturn:bridge:match-state",
        matchActive: active,
      });
    },
    dispose() {
      stopBatchStream();
      shellControlListeners.clear();
      for (const fn of disposables.splice(0, disposables.length)) {
        try {
          fn();
        } catch {}
      }
    },
  };
}

function resolveDefaultParent(): Pick<Window, "postMessage"> | null {
  if (typeof window === "undefined") return null;
  if (window.parent === window) return null;
  return window.parent;
}

function buildWebsocketURL(baseURL: string, token: string): string {
  const url = new URL(baseURL);
  url.searchParams.set("token", token);
  return url.toString();
}

function generateRequestID(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `req_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

function postTo(
  target: Pick<Window, "postMessage"> | null,
  targetOrigin: string,
  message: BridgeMessage,
): void {
  if (target === null) return;
  try {
    target.postMessage(message, targetOrigin);
  } catch {}
}

async function sendRequest(
  target: Pick<Window, "postMessage">,
  targetOrigin: string,
  message: BridgeMessage,
  _responseKind: BridgeMessage["kind"],
  match: (m: BridgeMessage) => BridgeMessage | null,
  timeoutMs = 5_000,
): Promise<BridgeMessage | null> {
  if (typeof window === "undefined") return null;
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      window.removeEventListener("message", onMessage);
      resolve(null);
    }, timeoutMs);
    function onMessage(event: MessageEvent) {
      const parsed = BridgeMessageSchema.safeParse(event.data);
      if (!parsed.success) return;
      const matched = match(parsed.data);
      if (matched === null) return;
      clearTimeout(timeout);
      window.removeEventListener("message", onMessage);
      resolve(matched);
    }
    window.addEventListener("message", onMessage);
    try {
      target.postMessage(message, targetOrigin);
    } catch {
      clearTimeout(timeout);
      window.removeEventListener("message", onMessage);
      resolve(null);
    }
  });
}
