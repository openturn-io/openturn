import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  parseLobbyServerMessageText,
  stringifyLobbyClientMessage,
  type LobbyAvailableBot,
  type LobbyClientMessage,
  type LobbyPhase,
  type LobbyRejectedMessage,
  type LobbySeat,
  type LobbyServerMessage,
  type LobbyStateMessage,
  type LobbyTransitionToGameMessage,
} from "@openturn/protocol";

export type LobbyChannelStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "transitioning"
  | "closed"
  | "error";

export interface LobbyChannelHandle {
  status: LobbyChannelStatus;
  error: string | null;
  state: LobbyStateMessage | null;
  lastRejection: LobbyRejectedMessage | null;
  transition: LobbyTransitionToGameMessage | null;
  closedReason: "host_left" | "host_close" | "room_closed" | null;
  takeSeat: (seatIndex: number) => void;
  leaveSeat: () => void;
  setReady: (ready: boolean) => void;
  start: () => void;
  close: () => void;
  /** Host-only: assign a bot to a seat. Server validates host + botID. */
  assignBot: (seatIndex: number, botID: string) => void;
  /** Host-only: clear whatever (bot or human) currently holds the seat. */
  clearSeat: (seatIndex: number) => void;
  /**
   * Host-only: set the room's effective capacity within `[minPlayers,
   * maxPlayers]`. Lowering evicts seats whose `seatIndex >= targetCapacity`.
   */
  setTargetCapacity: (targetCapacity: number) => void;
  disconnect: () => void;
}

export interface LobbyChannelInput {
  roomID: string;
  userID: string;
  websocketURL: string;
  // Called on lobby:transition_to_game — consumers use this to open a fresh
  // game-scoped websocket with the newly-minted room token.
  onTransitionToGame?: (message: LobbyTransitionToGameMessage) => void;
}

const DEFAULT_CLOSED = null;

function buildSocketURL(baseURL: string, token: string): string {
  const url = new URL(baseURL);
  url.searchParams.set("token", token);
  return url.toString();
}

export function useLobbyChannel(
  input: LobbyChannelInput | null,
  token: string | null,
): LobbyChannelHandle {
  const [status, setStatus] = useState<LobbyChannelStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<LobbyStateMessage | null>(null);
  const [lastRejection, setLastRejection] = useState<LobbyRejectedMessage | null>(null);
  const [transition, setTransition] = useState<LobbyTransitionToGameMessage | null>(null);
  const [closedReason, setClosedReason] = useState<
    "host_left" | "host_close" | "room_closed" | null
  >(DEFAULT_CLOSED);

  const socketRef = useRef<WebSocket | null>(null);
  const transitionCbRef = useRef<LobbyChannelInput["onTransitionToGame"]>(
    input?.onTransitionToGame ?? null,
  );
  transitionCbRef.current = input?.onTransitionToGame ?? null;

  useEffect(() => {
    if (input === null || token === null) {
      return;
    }

    setStatus("connecting");
    setError(null);
    setState(null);
    setLastRejection(null);
    setTransition(null);
    setClosedReason(null);

    const url = buildSocketURL(input.websocketURL, token);
    const socket = new WebSocket(url);
    socketRef.current = socket;

    socket.addEventListener("open", () => {
      setStatus("connected");
    });

    socket.addEventListener("message", (event) => {
      const raw = typeof event.data === "string" ? event.data : "";
      let message: LobbyServerMessage;
      try {
        message = parseLobbyServerMessageText(raw);
      } catch {
        return;
      }

      switch (message.type) {
        case "lobby:state":
          setState(message);
          return;
        case "lobby:rejected":
          setLastRejection(message);
          return;
        case "lobby:transition_to_game":
          setTransition(message);
          setStatus("transitioning");
          transitionCbRef.current?.(message);
          return;
        case "lobby:closed":
          setClosedReason(message.reason);
          setStatus("closed");
          return;
      }
    });

    socket.addEventListener("close", () => {
      setStatus((previous) =>
        previous === "transitioning" || previous === "closed" ? previous : "closed",
      );
    });

    socket.addEventListener("error", () => {
      setStatus((previous) => (previous === "transitioning" ? previous : "error"));
      setError("lobby_socket_error");
    });

    return () => {
      try {
        socket.close();
      } catch {}
      socketRef.current = null;
    };
  }, [input, token]);

  const send = useCallback((message: LobbyClientMessage) => {
    const socket = socketRef.current;
    if (socket === null || socket.readyState !== WebSocket.OPEN) return;
    try {
      socket.send(stringifyLobbyClientMessage(message));
    } catch {}
  }, []);

  const disconnect = useCallback(() => {
    const socket = socketRef.current;
    if (socket !== null) {
      try {
        socket.close();
      } catch {}
    }
  }, []);

  return useMemo<LobbyChannelHandle>(
    () => ({
      status,
      error,
      state,
      lastRejection,
      transition,
      closedReason,
      takeSeat: (seatIndex) => send({ type: "lobby:take_seat", seatIndex }),
      leaveSeat: () => send({ type: "lobby:leave_seat" }),
      setReady: (ready) => send({ type: "lobby:set_ready", ready }),
      start: () => send({ type: "lobby:start" }),
      close: () => send({ type: "lobby:close" }),
      assignBot: (seatIndex, botID) => send({ type: "lobby:assign_bot", seatIndex, botID }),
      clearSeat: (seatIndex) => send({ type: "lobby:clear_seat", seatIndex }),
      setTargetCapacity: (targetCapacity) =>
        send({ type: "lobby:set_target_capacity", targetCapacity }),
      disconnect,
    }),
    [closedReason, disconnect, error, lastRejection, send, state, status, transition],
  );
}

export interface LobbyView {
  phase: LobbyPhase;
  hostUserID: string;
  /** Mutable: host-chosen capacity in `[minPlayers, maxPlayers]`. */
  targetCapacity: number;
  minPlayers: number;
  maxPlayers: number;
  seats: readonly LobbySeat[];
  canStart: boolean;
  mySeatIndex: number | null;
  myReady: boolean;
  seatedCount: number;
  isHost: boolean;
  /** Catalog of bots the host may assign to seats. Empty when no registry. */
  availableBots: readonly LobbyAvailableBot[];
  status: LobbyChannelStatus;
  error: string | null;
  lastRejection: LobbyRejectedMessage | null;
  closedReason: "host_left" | "host_close" | "room_closed" | null;
  takeSeat: (seatIndex: number) => void;
  leaveSeat: () => void;
  setReady: (ready: boolean) => void;
  start: () => void;
  close: () => void;
  assignBot: (seatIndex: number, botID: string) => void;
  clearSeat: (seatIndex: number) => void;
  setTargetCapacity: (targetCapacity: number) => void;
}

export function buildLobbyView(input: {
  channel: LobbyChannelHandle;
  userID: string;
  /** Pre-state fallback for `targetCapacity`. Typically the manifest's `maxPlayers`. */
  capacityFallback: number;
  minPlayersFallback: number;
  /** Pre-state fallback for `maxPlayers`. Defaults to `capacityFallback`. */
  maxPlayersFallback?: number;
  hostUserIDFallback: string;
}): LobbyView {
  const state = input.channel.state;
  const phase = state?.phase ?? "lobby";
  const hostUserID = state?.hostUserID ?? input.hostUserIDFallback;
  const targetCapacity = state?.targetCapacity ?? input.capacityFallback;
  const minPlayers = state?.minPlayers ?? input.minPlayersFallback;
  const maxPlayers =
    state?.maxPlayers ?? input.maxPlayersFallback ?? input.capacityFallback;

  const seats = state?.seats ?? emptySeats(targetCapacity);
  const mine = seats.find(
    (seat) => seat.kind === "human" && seat.userID === input.userID,
  ) ?? null;
  const myHumanSeat = mine?.kind === "human" ? mine : null;
  const seatedCount = seats.reduce(
    (total, seat) => (seat.kind === "open" ? total : total + 1),
    0,
  );
  const isHost = input.userID === hostUserID;

  return {
    phase,
    hostUserID,
    targetCapacity,
    minPlayers,
    maxPlayers,
    seats,
    canStart: state?.canStart ?? false,
    mySeatIndex: myHumanSeat?.seatIndex ?? null,
    myReady: myHumanSeat?.ready ?? false,
    seatedCount,
    isHost,
    availableBots: state?.availableBots ?? [],
    status: input.channel.status,
    error: input.channel.error,
    lastRejection: input.channel.lastRejection,
    closedReason: input.channel.closedReason,
    takeSeat: input.channel.takeSeat,
    leaveSeat: input.channel.leaveSeat,
    setReady: input.channel.setReady,
    start: input.channel.start,
    close: input.channel.close,
    assignBot: input.channel.assignBot,
    clearSeat: input.channel.clearSeat,
    setTargetCapacity: input.channel.setTargetCapacity,
  };
}

function emptySeats(capacity: number): readonly LobbySeat[] {
  const out: LobbySeat[] = [];
  for (let i = 0; i < capacity; i += 1) {
    out.push({ kind: "open", seatIndex: i });
  }
  return out;
}

export interface LobbyProps {
  lobby: LobbyView;
  title?: string;
  className?: string;
  renderSeat?: (props: LobbySeatButtonProps) => ReactNode;
}

export interface LobbySeatButtonProps {
  seat: LobbySeat;
  isMine: boolean;
  label: string;
  disabled: boolean;
  onClick: () => void;
}

function defaultSeatLabel(seat: LobbySeat, index: number): string {
  switch (seat.kind) {
    case "open":
      return `Seat ${index + 1} · open`;
    case "human":
      return seat.userName ?? `Player ${seat.userID.slice(0, 6)}`;
    case "bot":
      return `🤖 ${seat.label}`;
  }
}

function seatInitials(seat: LobbySeat, index: number): string {
  if (seat.kind === "open") return String(index + 1);
  if (seat.kind === "bot") return "🤖";
  const source = seat.userName ?? seat.userID;
  const trimmed = source.trim();
  if (trimmed.length === 0) return String(index + 1);
  const parts = trimmed.split(/\s+/).slice(0, 2);
  const initials = parts.map((part) => part[0] ?? "").join("");
  return initials.toUpperCase() || String(index + 1);
}

type SeatTone = "open" | "mine" | "taken" | "bot";

const SEAT_TONE_CLASS: Record<SeatTone, string> = {
  open: "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:-translate-y-0.5 hover:shadow-md",
  mine: "border-slate-900 bg-slate-900 text-slate-50 shadow-sm",
  taken: "border-slate-200 bg-slate-50 text-slate-600",
  bot: "border-indigo-200 bg-indigo-50 text-indigo-900",
};

const SEAT_AVATAR_TONE_CLASS: Record<SeatTone, string> = {
  open: "border border-dashed border-slate-300 bg-slate-100 text-slate-400",
  mine: "bg-slate-50 text-slate-900",
  taken: "bg-slate-200 text-slate-700",
  bot: "bg-indigo-100 text-indigo-900",
};

function DefaultSeat(props: LobbySeatButtonProps & { isHost?: boolean }): ReactNode {
  const { seat, isMine, label, disabled, onClick } = props;
  const tone: SeatTone =
    seat.kind === "open"
      ? "open"
      : seat.kind === "bot"
        ? "bot"
        : isMine
          ? "mine"
          : "taken";
  const initials = seatInitials(seat, seat.seatIndex);
  const showHost = props.isHost === true && seat.kind === "human";
  const showReady = seat.kind === "human" && seat.ready;
  const showDisconnected = seat.kind === "human" && !seat.connected;
  const connectedDataAttr = seat.kind === "human" ? seat.connected : seat.kind === "bot";

  // Compact vertical card so each seat fits comfortably around the round
  // table at typical capacities (2-8). Width caps via the slot wrapper.
  const baseClass =
    "group/seat relative flex w-full flex-col items-center gap-1.5 rounded-xl border p-2 text-center transition duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-slate-400 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0 disabled:hover:shadow-none";

  return (
    <button
      type="button"
      aria-label={label}
      data-seat-index={seat.seatIndex}
      data-seat-kind={seat.kind}
      data-tone={tone}
      data-connected={connectedDataAttr}
      disabled={disabled}
      onClick={onClick}
      className={`openturn-lobby-seat ${baseClass} ${SEAT_TONE_CLASS[tone]}`}
    >
      <span
        aria-hidden
        className={`openturn-lobby-seat__avatar inline-flex h-11 w-11 flex-none items-center justify-center rounded-full text-sm font-semibold ${SEAT_AVATAR_TONE_CLASS[tone]}`}
      >
        {initials}
      </span>
      <span className="openturn-lobby-seat__label block w-full truncate px-1 text-xs font-medium leading-tight">
        {label}
      </span>
      {showHost || showReady || showDisconnected ? (
        <span className="openturn-lobby-seat__meta flex flex-wrap items-center justify-center gap-1">
          {showHost ? (
            <span
              className={
                tone === "mine"
                  ? "rounded-full bg-slate-50/15 px-1.5 py-0.5 text-[10px] font-medium text-slate-50"
                  : "rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px] font-medium text-slate-700"
              }
            >
              Host
            </span>
          ) : null}
          {showReady ? (
            <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
              Ready
            </span>
          ) : null}
          {showDisconnected ? (
            <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
              Off
            </span>
          ) : null}
        </span>
      ) : null}
    </button>
  );
}

// Defaults are applied when the consumer does not pass a className. When they
// do, they take full ownership of sizing and chrome — we still apply the
// minimum layout bones so the lobby keeps its column rhythm.
const DEFAULT_CONTAINER_CHROME =
  "w-full max-w-[560px] rounded-2xl border border-slate-200 bg-white p-6 shadow-sm";
const CONTAINER_LAYOUT = "openturn-lobby flex flex-col gap-5 text-slate-900";

const STATUS_DOT_CLASS: Record<LobbyChannelStatus, string> = {
  idle: "bg-slate-300",
  connecting: "bg-amber-400 animate-pulse",
  connected: "bg-emerald-500",
  transitioning: "bg-sky-500 animate-pulse",
  closed: "bg-slate-400",
  error: "bg-red-500",
};

export function Lobby(props: LobbyProps): ReactNode {
  const { lobby, title } = props;

  const startDisabled =
    !lobby.isHost || !lobby.canStart || lobby.phase !== "lobby" || lobby.status !== "connected";
  const readyDisabled = lobby.mySeatIndex === null || lobby.phase !== "lobby";

  const containerClass =
    props.className === undefined
      ? `${CONTAINER_LAYOUT} ${DEFAULT_CONTAINER_CHROME}`
      : `${CONTAINER_LAYOUT} ${props.className}`;

  return (
    <div className={containerClass}>
      <header className="openturn-lobby__header flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <h2 className="openturn-lobby__title m-0 text-xl font-semibold tracking-tight">
            {title ?? "Lobby"}
          </h2>
          <span
            aria-label={`Lobby ${lobby.status}`}
            className="inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-500"
          >
            <span
              aria-hidden
              className={`inline-block h-2 w-2 rounded-full ${STATUS_DOT_CLASS[lobby.status]}`}
            />
            {lobby.status}
          </span>
        </div>
        <p
          className="openturn-lobby__status m-0 text-sm text-slate-600"
          aria-live="polite"
        >
          {describeLobbyStatus(lobby)}
        </p>
      </header>

      <RoundTable
        lobby={lobby}
        renderSeat={props.renderSeat ?? null}
      />

      {lobby.minPlayers < lobby.maxPlayers && lobby.isHost ? (
        <CapacityPicker lobby={lobby} />
      ) : null}

      <footer className="openturn-lobby__footer flex flex-wrap items-center gap-3">
        <label
          className={`openturn-lobby__ready inline-flex select-none items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 transition hover:border-slate-300 ${
            readyDisabled ? "cursor-not-allowed opacity-60 hover:border-slate-200" : "cursor-pointer"
          }`}
        >
          <input
            type="checkbox"
            checked={lobby.myReady}
            disabled={readyDisabled}
            onChange={(event) => lobby.setReady(event.currentTarget.checked)}
            className="h-4 w-4 cursor-pointer accent-slate-900 disabled:cursor-not-allowed"
          />
          <span>Ready</span>
        </label>

        {lobby.isHost ? (
          <button
            type="button"
            className="openturn-lobby__start ml-auto inline-flex items-center justify-center rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-slate-400 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500 disabled:shadow-none"
            disabled={startDisabled}
            onClick={() => lobby.start()}
          >
            Start game
          </button>
        ) : null}

        {lobby.isHost ? (
          <button
            type="button"
            className="openturn-lobby__close inline-flex items-center justify-center rounded-md px-2 py-1 text-xs font-medium text-slate-500 transition hover:text-red-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-red-300 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:no-underline"
            disabled={lobby.phase !== "lobby"}
            onClick={() => lobby.close()}
          >
            Close room
          </button>
        ) : null}

      </footer>

      {lobby.lastRejection !== null ? (
        <div
          role="alert"
          className="openturn-lobby__rejection rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {describeRejection(lobby.lastRejection)}
        </div>
      ) : null}
    </div>
  );
}

function CapacityPicker({ lobby }: { lobby: LobbyView }): ReactNode {
  // Disabled outside the lobby phase or while reconnecting; lowering the
  // target below the current seated count is allowed (extra seated players
  // get evicted server-side and re-seated by clicking again).
  const disabled = lobby.phase !== "lobby" || lobby.status !== "connected";
  const decrease = () => {
    if (lobby.targetCapacity > lobby.minPlayers) {
      lobby.setTargetCapacity(lobby.targetCapacity - 1);
    }
  };
  const increase = () => {
    if (lobby.targetCapacity < lobby.maxPlayers) {
      lobby.setTargetCapacity(lobby.targetCapacity + 1);
    }
  };
  return (
    <div
      className="openturn-lobby__capacity flex items-center justify-center gap-2 text-xs text-slate-600"
      aria-label="Room capacity"
    >
      <span className="uppercase tracking-wide text-[10px] text-slate-500">Seats</span>
      <button
        type="button"
        aria-label="Remove a seat"
        disabled={disabled || lobby.targetCapacity <= lobby.minPlayers}
        onClick={decrease}
        className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-700 transition hover:border-slate-300 disabled:cursor-not-allowed disabled:opacity-40"
      >
        −
      </button>
      <span className="min-w-[2.5rem] text-center font-medium text-slate-900">
        {lobby.targetCapacity}
        <span className="text-slate-400"> / {lobby.maxPlayers}</span>
      </span>
      <button
        type="button"
        aria-label="Add a seat"
        disabled={disabled || lobby.targetCapacity >= lobby.maxPlayers}
        onClick={increase}
        className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-700 transition hover:border-slate-300 disabled:cursor-not-allowed disabled:opacity-40"
      >
        +
      </button>
    </div>
  );
}

// Seats sit on a circle whose radius is a percentage of the square table
// container. Seat 0 anchors at 12 o'clock; remaining seats fan out clockwise.
// This matches typical game UIs (top of table = "first" position) and gives
// future turn-order indicators a natural rotational frame: a needle in the
// center pointing to the active seat is just `rotate(angle)`.
const SEAT_RADIUS_PERCENT = 44;
const SEAT_TOP_ANGLE_DEG = -90;

function seatPolarPosition(seatIndex: number, capacity: number): {
  leftPercent: number;
  topPercent: number;
} {
  const angleDeg = SEAT_TOP_ANGLE_DEG + (360 * seatIndex) / Math.max(capacity, 1);
  const angleRad = (angleDeg * Math.PI) / 180;
  return {
    leftPercent: 50 + SEAT_RADIUS_PERCENT * Math.cos(angleRad),
    topPercent: 50 + SEAT_RADIUS_PERCENT * Math.sin(angleRad),
  };
}

interface RoundTableProps {
  lobby: LobbyView;
  renderSeat: ((props: LobbySeatButtonProps) => ReactNode) | null;
}

function RoundTable({ lobby, renderSeat }: RoundTableProps): ReactNode {
  return (
    <div
      className="openturn-lobby__table relative mx-auto w-full max-w-[360px] pt-10 pb-16"
      role="radiogroup"
      aria-label="Pick a seat at the round table"
    >
      <div className="relative w-full pb-[100%]">
        <div className="openturn-lobby__table-surface absolute inset-[18%] rounded-full border border-slate-200 bg-gradient-to-br from-slate-50 to-white shadow-inner">
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5 px-4 text-center">
            <span className="text-xl font-semibold tracking-tight text-slate-900">
              {lobby.seatedCount}
              <span className="text-sm font-normal text-slate-400"> / {lobby.targetCapacity}</span>
            </span>
            <span className="text-[10px] uppercase tracking-wide text-slate-500">
              {lobby.minPlayers < lobby.maxPlayers
                ? `seated · ${lobby.minPlayers}–${lobby.maxPlayers}`
                : lobby.minPlayers < lobby.targetCapacity
                  ? `seated · min ${lobby.minPlayers}`
                  : "seated"}
            </span>
          </div>
        </div>

        {lobby.seats.map((seat) => {
          const isMine = seat.kind === "human" && lobby.mySeatIndex === seat.seatIndex;
          const isOpen = seat.kind === "open";
          const disabled =
            lobby.phase !== "lobby"
            || lobby.status !== "connected"
            || (!isOpen && !isMine);
          const label = defaultSeatLabel(seat, seat.seatIndex);
          const onClick = () => {
            if (isMine) {
              lobby.leaveSeat();
            } else if (isOpen) {
              lobby.takeSeat(seat.seatIndex);
            }
            // Bot/other-human seats: default click is a no-op. The
            // <LobbyWithBots> wrapper provides host-only assign/clear via a
            // dropdown that replaces this default button entirely.
          };
          const isHost = seat.kind === "human" && seat.userID === lobby.hostUserID;
          const seatProps: LobbySeatButtonProps = { seat, isMine, label, disabled, onClick };
          const { leftPercent, topPercent } = seatPolarPosition(seat.seatIndex, lobby.targetCapacity);

          return (
            <div
              key={seat.seatIndex}
              className="openturn-lobby__seat-slot absolute w-[28%] min-w-[84px] -translate-x-1/2 -translate-y-1/2"
              data-seat-index={seat.seatIndex}
              style={{
                left: `${leftPercent}%`,
                top: `${topPercent}%`,
              }}
            >
              {renderSeat !== null ? (
                renderSeat(seatProps)
              ) : (
                <DefaultSeat {...seatProps} isHost={isHost} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function describeLobbyStatus(lobby: LobbyView): string {
  if (lobby.closedReason === "host_left") return "The host left the room.";
  if (lobby.closedReason === "host_close") return "The host closed the room.";
  if (lobby.closedReason === "room_closed") return "The room is closed.";
  if (lobby.status === "connecting") return "Connecting to the lobby…";
  if (lobby.status === "error") return lobby.error ?? "Lobby connection error.";
  if (lobby.phase === "starting") return "Starting the game…";
  if (lobby.phase === "active") return "Game in progress.";
  if (lobby.phase === "lobby") {
    if (lobby.isHost && lobby.canStart) return "All ready — you can start the game.";
    if (lobby.isHost) return "Waiting for everyone to ready up.";
    if (lobby.mySeatIndex === null) return "Pick a seat around the round table.";
    return lobby.myReady ? "You are ready. Waiting for the host." : "Tap Ready when you're set.";
  }
  return "";
}

function describeRejection(rejection: LobbyRejectedMessage): string {
  switch (rejection.reason) {
    case "seat_taken":
      return "That seat is already taken.";
    case "seat_out_of_range":
      return "That seat doesn't exist for this game.";
    case "not_seated":
      return "You need to pick a seat first.";
    case "already_seated":
      return "You are already seated.";
    case "not_host":
      return "Only the host can do that.";
    case "not_ready":
      return "Everyone seated must be ready before the game can start.";
    case "below_min_players":
      return "Not enough players seated yet.";
    case "bad_phase":
      return "The room is no longer accepting changes.";
    case "room_closed":
      return "The room is closed.";
    case "seat_has_bot":
      return "That seat is held by a bot. The host must clear it first.";
    case "seat_has_human":
      return "That seat is held by a player. The host must clear it before assigning a bot.";
    case "unknown_bot":
      return "That bot isn't registered for this game.";
    case "target_below_min":
      return "Capacity can't go below the game's minimum players.";
    case "target_above_max":
      return "Capacity can't exceed the game's maximum players.";
    case "bad_target":
      return "That capacity isn't valid.";
    case "unknown":
      return rejection.message ?? "The lobby rejected your request.";
  }
}
