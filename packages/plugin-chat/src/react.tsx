import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type JSX,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";

import {
  CHAT_PLUGIN_ID,
  MAX_DISPLAY_NAME_LENGTH,
  MAX_MESSAGE_LENGTH,
  type ChatMessage,
  type ChatSendArgs,
  type ChatSlice,
} from "./index";

/**
 * Match-shape we accept from `useMatch().state` (or `useRoom().game`). Kept
 * structural so we don't depend on `@openturn/react` at type level. Only the
 * `chat__send` dispatcher is constrained — sibling host dispatchers are
 * allowed to take their own argument shapes (`unknown` here so we don't force
 * every other dispatch to accept a chat payload).
 */
export interface ChatHostMatch {
  snapshot: { G?: { plugins?: { chat?: ChatSlice } } | null } | null;
  dispatch: { chat__send?: (payload: ChatSendArgs) => Promise<unknown> | unknown }
    & Record<string, ((payload: never) => Promise<unknown> | unknown) | undefined>;
  playerID?: string | null;
}

export interface ChatHostRoom {
  userID?: string | null;
  userName?: string | null;
  game?: ChatHostMatch | null;
}

export interface ChatBubbleProps {
  /**
   * The hosted room handle. Pass `useRoom()` from `@openturn/react`. When the
   * room is in the lobby phase or before the match has started, the bubble
   * renders nothing — chat lives on the game `G` and only exists once the
   * match is live.
   */
  room: ChatHostRoom;
  /**
   * Optional override for the local user's display name. Defaults to
   * `room.userName` (or `Player {playerID}` when that is missing).
   */
  displayName?: string | null;
  /**
   * Where to render the floating bubble. Defaults to `document.body` so it
   * escapes whatever container it's mounted under.
   */
  portalContainer?: HTMLElement | null;
}

const COLORS = {
  bubbleBg: "#0f172a",
  bubbleText: "#f8fafc",
  panelBg: "#ffffff",
  panelBorder: "#e2e8f0",
  panelShadow: "0 24px 48px rgba(15, 23, 42, 0.18)",
  selfBubble: "#0f172a",
  selfText: "#f8fafc",
  otherBubble: "#f1f5f9",
  otherText: "#0f172a",
  meta: "#64748b",
  badgeBg: "#ef4444",
  badgeText: "#ffffff",
} as const;

const Z_INDEX_BASE = 2147483000;

export function ChatBubble({ room, displayName, portalContainer }: ChatBubbleProps): JSX.Element | null {
  const match = room.game ?? null;
  const playerID = match?.playerID ?? null;
  const messages = readChatMessages(match);

  const [isOpen, setIsOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [seenCount, setSeenCount] = useState(messages.length);
  const [sending, setSending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [container, setContainer] = useState<HTMLElement | null>(null);

  // Resolve the portal container on the client only. Avoids touching `document`
  // during SSR / non-DOM render passes (the host shell may render once on the
  // server before hydrating).
  useLayoutEffect(() => {
    if (portalContainer !== undefined && portalContainer !== null) {
      setContainer(portalContainer);
      return;
    }
    if (typeof document === "undefined") return;
    setContainer(document.body);
  }, [portalContainer]);

  // Mark messages as seen whenever the panel is open and new ones arrive. When
  // closed, the unread badge ticks up.
  useEffect(() => {
    if (isOpen) {
      setSeenCount(messages.length);
    }
  }, [isOpen, messages.length]);

  // Auto-scroll to the newest message when the panel is open.
  useLayoutEffect(() => {
    if (!isOpen) return;
    const list = listRef.current;
    if (list === null) return;
    list.scrollTop = list.scrollHeight;
  }, [isOpen, messages.length]);

  // Focus the input on open.
  useEffect(() => {
    if (!isOpen) return;
    inputRef.current?.focus();
  }, [isOpen]);

  const resolvedDisplayName = useMemo(() => {
    const candidate = displayName ?? room.userName ?? null;
    const trimmed = candidate?.trim() ?? "";
    if (trimmed.length > 0 && !isGenericDisplayName(trimmed)) {
      return trimmed.slice(0, MAX_DISPLAY_NAME_LENGTH);
    }
    if (room.userID !== null && room.userID !== undefined && room.userID.length > 0) {
      return `Player ${room.userID.slice(0, 6)}`.slice(0, MAX_DISPLAY_NAME_LENGTH);
    }
    return playerID === null ? "Spectator" : `Player ${playerID}`;
  }, [displayName, room.userName, room.userID, playerID]);

  const sendDispatch = match?.dispatch.chat__send;
  const canSend = !sending
    && playerID !== null
    && draft.trim().length > 0
    && typeof sendDispatch === "function";

  const send = useCallback(async () => {
    if (!canSend || typeof sendDispatch !== "function") return;
    const text = draft.trim().slice(0, MAX_MESSAGE_LENGTH);
    if (text.length === 0) return;

    setSending(true);
    setErrorMessage(null);
    try {
      const outcome = await sendDispatch({ text, displayName: resolvedDisplayName });
      // The hosted dispatch returns `{ ok: false, error, ... }` on rejection.
      if (typeof outcome === "object" && outcome !== null && "ok" in outcome && (outcome as { ok: boolean }).ok === false) {
        const error = (outcome as { error?: string }).error ?? "send_failed";
        setErrorMessage(humanizeChatError(error));
        return;
      }
      setDraft("");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "send_failed");
    } finally {
      setSending(false);
    }
  }, [canSend, draft, sendDispatch, resolvedDisplayName]);

  const onInputKeyDown = useCallback((event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setIsOpen(false);
      return;
    }
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void send();
    }
  }, [send]);

  if (match === null || match.snapshot === null || container === null) {
    return null;
  }

  const unread = Math.max(0, messages.length - seenCount);

  const node = (
    <div style={rootStyle}>
      {isOpen ? (
        <div role="dialog" aria-label="Chat" style={panelStyle}>
          <div style={panelHeaderStyle}>
            <strong style={{ fontSize: "0.95rem" }}>Chat</strong>
            <button
              type="button"
              aria-label="Close chat"
              onClick={() => setIsOpen(false)}
              style={iconButtonStyle}
            >
              ×
            </button>
          </div>
          <div ref={listRef} style={messageListStyle}>
            {messages.length === 0 ? (
              <p style={emptyStyle}>No messages yet — say hi.</p>
            ) : (
              messages.map((message, index) => (
                <ChatRow
                  key={index}
                  message={message}
                  isSelf={message.authorPlayerID === playerID}
                />
              ))
            )}
          </div>
          {/* Intentionally not a `<form>`: hosts often embed games in iframes
              with sandbox flags that omit `allow-forms`, which would block
              real form submission entirely. We send via button click + Enter
              keydown so the chat works regardless of the host sandbox. */}
          <div style={composerStyle}>
            <input
              ref={inputRef}
              aria-label="Message"
              maxLength={MAX_MESSAGE_LENGTH}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={onInputKeyDown}
              placeholder={playerID === null ? "Spectators can't chat" : "Message…"}
              style={inputStyle}
              disabled={playerID === null}
              value={draft}
            />
            <button
              aria-label="Send message"
              disabled={!canSend}
              onClick={() => { void send(); }}
              style={canSend ? sendButtonActiveStyle : sendButtonDisabledStyle}
              type="button"
            >
              Send
            </button>
          </div>
          {errorMessage !== null ? (
            <p role="alert" style={errorStyle}>{errorMessage}</p>
          ) : null}
        </div>
      ) : null}
      <button
        aria-label={isOpen ? "Close chat" : `Open chat${unread > 0 ? ` (${unread} new)` : ""}`}
        onClick={() => setIsOpen((prev) => !prev)}
        style={bubbleStyle}
        type="button"
      >
        <span aria-hidden="true">💬</span>
        {unread > 0 && !isOpen ? (
          <span aria-hidden="true" style={badgeStyle}>{unread > 99 ? "99+" : String(unread)}</span>
        ) : null}
      </button>
    </div>
  );

  return createPortal(node, container);
}

function ChatRow({ message, isSelf }: { message: ChatMessage; isSelf: boolean }) {
  return (
    <div style={isSelf ? rowSelfStyle : rowOtherStyle}>
      {!isSelf ? <span style={authorStyle}>{message.authorDisplayName}</span> : null}
      <span style={isSelf ? bubbleSelfStyle : bubbleOtherStyle}>{message.text}</span>
    </div>
  );
}

function readChatMessages(match: ChatHostMatch | null): readonly ChatMessage[] {
  const slice = match?.snapshot?.G?.plugins?.[CHAT_PLUGIN_ID];
  if (slice === undefined || slice === null) return EMPTY_MESSAGES;
  return slice.messages ?? EMPTY_MESSAGES;
}

const EMPTY_MESSAGES: readonly ChatMessage[] = Object.freeze([]);

function isGenericDisplayName(value: string): boolean {
  return value.toLowerCase() === "anonymous";
}

function humanizeChatError(code: string): string {
  if (code === "empty_message") return "Type a message first.";
  if (code === "inactive_player") return "You can't send messages right now.";
  if (code === "not_connected") return "Disconnected from the room.";
  return "Couldn't send that message.";
}

// ---------------------------------------------------------------------------
// Inline styles — keeps the package free of CSS plumbing so any host app can
// drop in `<ChatBubble />` without configuring Tailwind, css modules, etc.
// ---------------------------------------------------------------------------

const rootStyle: CSSProperties = {
  position: "fixed",
  bottom: 24,
  right: 24,
  zIndex: Z_INDEX_BASE,
  display: "flex",
  flexDirection: "column",
  alignItems: "flex-end",
  gap: 12,
  fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  // The portal mounts on `document.body`, so host stylesheets that target
  // `body > div { width: 100%; height: 100% }` (a common reset in Tailwind
  // setups) would otherwise stretch this root across the viewport and push
  // the bubble out of the bottom-right corner.
  width: "auto",
  height: "auto",
  minHeight: 0,
  maxWidth: "calc(100vw - 48px)",
};

const bubbleStyle: CSSProperties = {
  position: "relative",
  width: 56,
  height: 56,
  borderRadius: 28,
  border: "none",
  background: COLORS.bubbleBg,
  color: COLORS.bubbleText,
  fontSize: 24,
  cursor: "pointer",
  boxShadow: "0 12px 24px rgba(15, 23, 42, 0.2)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const badgeStyle: CSSProperties = {
  position: "absolute",
  top: -4,
  right: -4,
  minWidth: 22,
  height: 22,
  borderRadius: 11,
  background: COLORS.badgeBg,
  color: COLORS.badgeText,
  fontSize: 12,
  fontWeight: 600,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "0 6px",
  boxShadow: "0 2px 6px rgba(239, 68, 68, 0.4)",
};

const panelStyle: CSSProperties = {
  width: 320,
  maxHeight: 480,
  background: COLORS.panelBg,
  border: `1px solid ${COLORS.panelBorder}`,
  borderRadius: 16,
  boxShadow: COLORS.panelShadow,
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
};

const panelHeaderStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "12px 16px",
  borderBottom: `1px solid ${COLORS.panelBorder}`,
};

const iconButtonStyle: CSSProperties = {
  border: "none",
  background: "transparent",
  fontSize: 22,
  lineHeight: 1,
  cursor: "pointer",
  color: COLORS.meta,
  padding: 0,
};

const messageListStyle: CSSProperties = {
  flex: 1,
  overflowY: "auto",
  padding: 12,
  display: "flex",
  flexDirection: "column",
  gap: 8,
  minHeight: 200,
  maxHeight: 320,
};

const emptyStyle: CSSProperties = {
  color: COLORS.meta,
  fontSize: 13,
  textAlign: "center",
  margin: "auto 0",
};

const rowBaseStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  maxWidth: "85%",
  gap: 2,
};

const rowSelfStyle: CSSProperties = { ...rowBaseStyle, alignSelf: "flex-end", alignItems: "flex-end" };
const rowOtherStyle: CSSProperties = { ...rowBaseStyle, alignSelf: "flex-start", alignItems: "flex-start" };

const authorStyle: CSSProperties = {
  fontSize: 11,
  color: COLORS.meta,
  fontWeight: 600,
  letterSpacing: 0.2,
  paddingLeft: 4,
};

const bubbleBaseStyle: CSSProperties = {
  padding: "8px 12px",
  borderRadius: 14,
  fontSize: 14,
  lineHeight: 1.4,
  wordBreak: "break-word",
};

const bubbleSelfStyle: CSSProperties = {
  ...bubbleBaseStyle,
  background: COLORS.selfBubble,
  color: COLORS.selfText,
  borderBottomRightRadius: 4,
};

const bubbleOtherStyle: CSSProperties = {
  ...bubbleBaseStyle,
  background: COLORS.otherBubble,
  color: COLORS.otherText,
  borderBottomLeftRadius: 4,
};

const composerStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: 12,
  borderTop: `1px solid ${COLORS.panelBorder}`,
};

const inputStyle: CSSProperties = {
  flex: 1,
  border: `1px solid ${COLORS.panelBorder}`,
  borderRadius: 999,
  padding: "8px 12px",
  fontSize: 14,
  outline: "none",
};

const sendButtonBaseStyle: CSSProperties = {
  border: "none",
  borderRadius: 999,
  padding: "8px 14px",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
};

const sendButtonActiveStyle: CSSProperties = {
  ...sendButtonBaseStyle,
  background: COLORS.bubbleBg,
  color: COLORS.bubbleText,
};

const sendButtonDisabledStyle: CSSProperties = {
  ...sendButtonBaseStyle,
  background: COLORS.otherBubble,
  color: COLORS.meta,
  cursor: "not-allowed",
};

const errorStyle: CSSProperties = {
  margin: 0,
  padding: "0 12px 10px",
  color: "#b91c1c",
  fontSize: 12,
};
