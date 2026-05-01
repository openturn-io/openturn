import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type ReactNode,
} from "react";
import { Toaster, toast } from "sonner";

import { createBridgeHost, type BridgeHost } from "./host";
import { PlayShell } from "./shell";
import {
  describeRoomStatus,
  extractRoomID,
  snapshotToBridgeInit,
  type PlayRoomResult,
  type PlayRoomSnapshot,
  type PlayRoomVisibility,
  type PlayShellAdapter,
  type PresenceSnapshot,
  type PublicRoomSummary,
} from "./play-types";

const PUBLIC_ROOMS_REFRESH_MS = 15_000;
const PRESENCE_POLL_MS = 3_000;

export interface PlayPageClassNames {
  root?: string;
  lobbyMain?: string;
  inRoomRoot?: string;
  shell?: string;
  shellToolbar?: string;
  card?: string;
  errorCard?: string;
  primaryButton?: string;
  outlineButton?: string;
}

export interface PlayPageProps {
  adapter: PlayShellAdapter;
  initialRoomID?: string | null;
  /** Optional content rendered above the lobby/in-room views (e.g. site header). */
  chrome?: ReactNode;
  /** Override class names so each shell can re-skin to its design tokens. */
  classes?: PlayPageClassNames;
}

type LobbyCard = "create" | "join" | "save";

type CardState =
  | { kind: "idle" }
  | { kind: "loading"; card: LobbyCard }
  | { kind: "error"; card: LobbyCard; message: string };

export function PlayPage({ adapter, initialRoomID, chrome, classes }: PlayPageProps) {
  const [snapshot, setSnapshot] = useState<PlayRoomSnapshot | null>(null);
  const [cardState, setCardState] = useState<CardState>({ kind: "idle" });
  const isLoading = cardState.kind === "loading";

  const performAction = useCallback(
    async (card: LobbyCard, thunk: () => Promise<PlayRoomResult>) => {
      setCardState({ kind: "loading", card });
      try {
        const result = await thunk();
        if (result.status !== "ok") {
          setCardState({
            kind: "error",
            card,
            message: result.reason ?? describeRoomStatus(result.status),
          });
          return;
        }
        setSnapshot(result.snapshot);
        adapter.writeRoomIDToLocation?.(result.snapshot.roomID);
        setCardState({ kind: "idle" });
      } catch (caught) {
        setCardState({
          kind: "error",
          card,
          message: caught instanceof Error ? caught.message : "unknown_error",
        });
      }
    },
    [adapter],
  );

  // Auto-join from initialRoomID once.
  const autoJoinRoomID = initialRoomID ?? null;
  useEffect(() => {
    if (autoJoinRoomID === null) return;
    if (snapshot !== null) return;
    if (cardState.kind === "loading") return;
    void performAction("join", () => adapter.joinRoom(autoJoinRoomID));
  }, [autoJoinRoomID, snapshot, cardState.kind, adapter, performAction]);

  if (snapshot !== null) {
    return (
      <div className={classes?.inRoomRoot ?? "flex h-dvh flex-col bg-white text-slate-900"}>
        {chrome}
        <RoomView snapshot={snapshot} adapter={adapter} classes={classes} />
      </div>
    );
  }

  return (
    <div className={classes?.root ?? "flex min-h-dvh flex-col bg-white text-slate-900"}>
      {chrome}
      <LobbyView
        adapter={adapter}
        cardState={cardState}
        isLoading={isLoading}
        performAction={performAction}
        onError={(card, message) => setCardState({ kind: "error", card, message })}
        classes={classes}
      />
    </div>
  );
}

function LobbyView({
  adapter,
  cardState,
  isLoading,
  performAction,
  onError,
  classes,
}: {
  adapter: PlayShellAdapter;
  cardState: CardState;
  isLoading: boolean;
  performAction: (card: LobbyCard, thunk: () => Promise<PlayRoomResult>) => Promise<void>;
  onError: (card: LobbyCard, message: string) => void;
  classes: PlayPageClassNames | undefined;
}) {
  const meta = adapter.meta;
  const createError = cardState.kind === "error" && cardState.card === "create" ? cardState.message : null;
  const joinError = cardState.kind === "error" && cardState.card === "join" ? cardState.message : null;
  const saveError = cardState.kind === "error" && cardState.card === "save" ? cardState.message : null;
  const createLoading = cardState.kind === "loading" && cardState.card === "create";

  if (meta.multiplayer === null) {
    return (
      <main className={classes?.lobbyMain ?? "mx-auto w-full max-w-3xl px-6 py-16"}>
        <div className={cardClass(classes)}>
          <h1 className="text-xl font-semibold tracking-tight">{meta.gameName}</h1>
          <p className="mt-2 text-sm text-slate-500">
            This deployment is marked multiplayer but is missing multiplayer metadata.
          </p>
        </div>
      </main>
    );
  }

  const { minPlayers, maxPlayers } = meta.multiplayer;
  const playerCountLabel =
    minPlayers < maxPlayers ? `${minPlayers}–${maxPlayers}-player` : `${maxPlayers}-player`;

  return (
    <main className={classes?.lobbyMain ?? "mx-auto w-full max-w-5xl px-6 py-10"}>
      <header className="mb-8 flex flex-col gap-2">
        <span className="text-xs uppercase tracking-wider text-slate-500">Multiplayer lobby</span>
        <h1 className="text-3xl font-semibold tracking-tight">{meta.gameName}</h1>
        <p className="text-sm text-slate-500">
          {playerCountLabel} game
          {meta.user?.name !== undefined ? (
            <>
              {" "}· signed in as <span className="font-medium text-slate-900">{meta.user.name}</span>
            </>
          ) : null}
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-12">
        <div className={`lg:col-span-7 ${cardClass(classes, createError !== null)}`}>
          <h2 className="text-base font-semibold">Create a new room</h2>
          <p className="mt-1 text-sm text-slate-500">
            Spins up a fresh room and gives you an invite link to share.
          </p>
          <div className="mt-4 flex flex-col gap-2">
            <button
              type="button"
              disabled={isLoading}
              onClick={() => void performAction("create", () => adapter.createRoom())}
              className={primaryButtonClass(classes)}
            >
              {createLoading ? "Creating room..." : "Create room"}
            </button>
            {createError !== null ? (
              <p className="m-0 text-xs text-red-600">{createError}.</p>
            ) : null}
          </div>
        </div>

        <div className="flex flex-col gap-4 lg:col-span-5">
          <div className={cardClass(classes, joinError !== null)}>
            <h2 className="text-base font-semibold">Join with invite</h2>
            <p className="mt-1 text-sm text-slate-500">Paste an invite link a host shared with you.</p>
            <div className="mt-3">
              <JoinRoomForm
                disabled={isLoading}
                onJoin={(roomID) => void performAction("join", () => adapter.joinRoom(roomID))}
                classes={classes}
              />
              {joinError !== null ? (
                <p className="mt-2 text-xs text-red-600">{joinError}.</p>
              ) : null}
            </div>
          </div>

          {adapter.createRoomFromSave !== undefined ? (
            <div className={cardClass(classes, saveError !== null)}>
              <h2 className="text-base font-semibold">Start from save</h2>
              <p className="mt-1 text-sm text-slate-500">
                Upload a <span className="font-mono">.otsave</span> file you (or another player) downloaded earlier.
              </p>
              <div className="mt-3">
                <SaveUploadForm
                  disabled={isLoading}
                  onUpload={async (bytes) => {
                    await performAction("save", async () => {
                      if (adapter.createRoomFromSave === undefined) {
                        return { status: "rejected", reason: "save upload not supported" };
                      }
                      return adapter.createRoomFromSave(bytes);
                    });
                  }}
                  onError={(message) => onError("save", message)}
                />
                {saveError !== null ? (
                  <p className="mt-2 text-xs text-red-600">{saveError}.</p>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {adapter.listPublicRooms !== undefined ? (
        <PublicRoomsSection
          listPublicRooms={adapter.listPublicRooms}
          disabled={isLoading}
          onJoin={(roomID) => void performAction("join", () => adapter.joinRoom(roomID))}
          classes={classes}
        />
      ) : null}
    </main>
  );
}

function PublicRoomsSection({
  listPublicRooms,
  disabled,
  onJoin,
  classes,
}: {
  listPublicRooms: () => Promise<readonly PublicRoomSummary[]>;
  disabled: boolean;
  onJoin: (roomID: string) => void;
  classes: PlayPageClassNames | undefined;
}) {
  const [rooms, setRooms] = useState<readonly PublicRoomSummary[] | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const fetchRooms = async () => {
      try {
        const result = await listPublicRooms();
        if (!active) return;
        setRooms(result);
        setLoaded(true);
      } catch {
        if (!active) return;
        setLoaded(true);
      }
      if (!active) return;
      timeout = setTimeout(() => void fetchRooms(), PUBLIC_ROOMS_REFRESH_MS);
    };
    void fetchRooms();
    return () => {
      active = false;
      if (timeout !== null) clearTimeout(timeout);
    };
  }, [listPublicRooms]);

  return (
    <section className="mt-10 flex flex-col gap-3">
      <header className="flex items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold tracking-tight">Open public rooms</h2>
        <span className="text-xs text-slate-500">
          {loaded && rooms !== null ? `${rooms.length} open` : "Loading..."}
        </span>
      </header>
      {rooms !== null && rooms.length === 0 ? (
        <div className={cardClass(classes)}>
          <p className="py-6 text-center text-sm text-slate-500">
            No public rooms yet — create one above and toggle it Public to invite drop-ins.
          </p>
        </div>
      ) : null}
      {rooms !== null && rooms.length > 0 ? (
        <div className={`overflow-hidden p-0 ${cardClass(classes)}`}>
          <ul className="divide-y divide-slate-200">
            {rooms.map((room) => (
              <li key={room.roomID} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700">
                      {room.status === "active" ? "In game" : "In lobby"}
                    </span>
                    <span className="truncate font-mono text-xs text-slate-500">{room.roomID}</span>
                  </div>
                </div>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onJoin(room.roomID)}
                  className={outlineButtonClass(classes)}
                >
                  Join
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

export function JoinRoomForm({
  disabled,
  onJoin,
  classes,
}: {
  disabled: boolean;
  onJoin: (roomID: string) => void;
  classes?: PlayPageClassNames | undefined;
}) {
  const [value, setValue] = useState("");
  const extracted = extractRoomID(value);

  return (
    <form
      className="flex flex-col gap-1.5"
      onSubmit={(event) => {
        event.preventDefault();
        if (extracted !== null) onJoin(extracted);
      }}
    >
      <div className="flex gap-2">
        <input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="Paste invite link or room ID"
          className="flex-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-400"
        />
        <button
          type="submit"
          disabled={disabled || extracted === null}
          className={outlineButtonClass(classes)}
        >
          Join
        </button>
      </div>
      {extracted !== null && extracted !== value.trim() ? (
        <p className="text-xs text-slate-500">
          Will join <span className="font-mono text-slate-900">{extracted}</span>
        </p>
      ) : null}
    </form>
  );
}

export function SaveUploadForm({
  disabled,
  onUpload,
  onError,
}: {
  disabled: boolean;
  onUpload: (bytes: Uint8Array) => Promise<void>;
  onError: (message: string) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [pending, setPending] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);

  async function handleFile(file: File) {
    setUploading(true);
    setPending(file);
    try {
      const buffer = await file.arrayBuffer();
      await onUpload(new Uint8Array(buffer));
    } catch (error) {
      onError(error instanceof Error ? error.message : "upload failed");
      setPending(null);
    } finally {
      setUploading(false);
    }
  }

  const inputDisabled = disabled || uploading;

  return (
    <div className="flex flex-col gap-2">
      <label
        onDragOver={(event: DragEvent<HTMLLabelElement>) => {
          if (inputDisabled) return;
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event: DragEvent<HTMLLabelElement>) => {
          if (inputDisabled) return;
          event.preventDefault();
          setDragging(false);
          const file = event.dataTransfer.files?.[0];
          if (file !== undefined) void handleFile(file);
        }}
        className={joinClasses(
          "relative flex flex-col items-center justify-center gap-1 rounded-md border border-dashed border-slate-300 px-4 py-6 text-center text-xs text-slate-500 transition-colors",
          inputDisabled ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:border-slate-500 hover:bg-slate-50",
          dragging ? "border-slate-900 bg-slate-50 text-slate-900" : "",
        )}
      >
        <span className="font-medium text-slate-900">
          {uploading ? "Uploading…" : "Drop .otsave here or click to browse"}
        </span>
        <span>Saves are pinned to this deployment's version.</span>
        <input
          type="file"
          accept=".otsave,application/octet-stream"
          disabled={inputDisabled}
          onChange={(event: ChangeEvent<HTMLInputElement>) => {
            const file = event.target.files?.[0];
            if (file !== undefined) void handleFile(file);
          }}
          className="absolute inset-0 cursor-pointer opacity-0 disabled:cursor-not-allowed"
        />
      </label>
      {pending !== null ? (
        <div className="flex items-center justify-between gap-2 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs">
          <span className="min-w-0 truncate">
            <span className="font-medium text-slate-900">{pending.name}</span>
            <span className="ml-1.5 text-slate-500">
              · {formatBytes(pending.size)}
              {uploading ? " · uploading…" : ""}
            </span>
          </span>
          {!uploading ? (
            <button
              type="button"
              onClick={() => setPending(null)}
              className="text-slate-500 transition-colors hover:text-slate-900"
            >
              Remove
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function RoomView({
  snapshot,
  adapter,
  classes,
}: {
  snapshot: PlayRoomSnapshot;
  adapter: PlayShellAdapter;
  classes: PlayPageClassNames | undefined;
}) {
  const host = useBridgeHost(snapshot, adapter);
  const matchActive = useBridgeMatchActive(host, snapshot.scope === "game");

  const [visibility, setVisibility] = useState<PlayRoomVisibility | undefined>(snapshot.visibility);
  const [visibilityPending, setVisibilityPending] = useState(false);
  useEffect(() => setVisibility(snapshot.visibility), [snapshot.roomID, snapshot.visibility]);

  const inviteURL = useMemo(() => adapter.inviteURL(snapshot.roomID), [adapter, snapshot.roomID]);

  const [presence, setPresence] = useState<PresenceSnapshot | null>(null);
  useEffect(() => {
    if (adapter.pollPresence === undefined) return;
    const poll = adapter.pollPresence;
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    const tick = async () => {
      try {
        const next = await poll(snapshot.roomID, controller.signal);
        if (next !== null && !controller.signal.aborted) setPresence(next);
      } catch {}
      if (stopped) return;
      timeout = setTimeout(() => void tick(), PRESENCE_POLL_MS);
    };
    void tick();
    return () => {
      stopped = true;
      controller.abort();
      if (timeout !== null) clearTimeout(timeout);
    };
  }, [adapter, snapshot.roomID]);

  async function changeVisibility(next: PlayRoomVisibility) {
    if (adapter.setVisibility === undefined) return;
    if (next === visibility || visibilityPending) return;
    const previous = visibility;
    setVisibility(next);
    setVisibilityPending(true);
    try {
      const result = await adapter.setVisibility(snapshot.roomID, next);
      if (result.status !== "ok") setVisibility(previous);
    } catch {
      setVisibility(previous);
    } finally {
      setVisibilityPending(false);
    }
  }

  async function copyInvite() {
    try {
      if (
        typeof navigator === "undefined" ||
        navigator.clipboard?.writeText === undefined
      ) {
        throw new Error("Clipboard unavailable");
      }
      await navigator.clipboard.writeText(inviteURL);
      toast.success("Copied Invite URL Successfully");
    } catch {
      toast.error("Could Not Copy Invite URL");
    }
  }

  async function handleSave() {
    if (adapter.saveCurrentRoom === undefined) return;
    try {
      const result = await adapter.saveCurrentRoom(snapshot.roomID);
      if (result.status !== "ok") {
        window.alert(`Save failed: ${result.reason ?? result.status}`);
        return;
      }
      const href = result.downloadURL ?? bytesToObjectURL(result.bytes);
      if (href === null) return;
      const a = document.createElement("a");
      a.href = href;
      a.download = `${result.saveID}.otsave`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      if (result.bytes !== undefined && result.downloadURL === undefined) {
        setTimeout(() => URL.revokeObjectURL(href), 30_000);
      }
    } catch (caught) {
      window.alert(`Save failed: ${caught instanceof Error ? caught.message : String(caught)}`);
    }
  }

  function handleLoad() {
    const createRoomFromSave = adapter.createRoomFromSave;
    if (createRoomFromSave === undefined) return;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".otsave,application/octet-stream";
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (file === undefined) return;
      try {
        const buffer = await file.arrayBuffer();
        const result = await createRoomFromSave(new Uint8Array(buffer));
        if (result.status !== "ok") {
          window.alert(`Load failed: ${result.reason ?? result.status}`);
          return;
        }
        adapter.writeRoomIDToLocation?.(result.snapshot.roomID);
        window.location.reload();
      } catch (caught) {
        window.alert(`Load failed: ${caught instanceof Error ? caught.message : String(caught)}`);
      }
    });
    input.click();
  }

  async function handleReset() {
    if (adapter.resetRoom === undefined) return;
    if (!window.confirm("Reset match to start? Players will be reconnected.")) return;
    const result = await adapter.resetRoom(snapshot.roomID);
    if (result.status !== "ok") {
      window.alert(`Reset failed: ${result.reason ?? result.status}`);
      return;
    }
    window.location.reload();
  }

  async function handleReturnToLobby() {
    if (adapter.returnToLobby === undefined) return;
    if (!window.confirm("End the match and return to lobby?")) return;
    const result = await adapter.returnToLobby(snapshot.roomID);
    if (result.status !== "ok") {
      window.alert(`Return-to-lobby failed: ${result.reason ?? result.status}`);
      return;
    }
    window.location.reload();
  }

  const toolbarLead = (
    <RoomToolbarLead
      snapshot={snapshot}
      visibility={visibility}
      visibilityPending={visibilityPending}
      onChangeVisibility={adapter.setVisibility !== undefined ? changeVisibility : undefined}
      onCopyInvite={copyInvite}
      presence={presence}
    />
  );

  const toolbarTrail = (
    <RoomToolbarActions
      adapter={adapter}
      matchActive={matchActive}
      onSave={handleSave}
      onLoad={handleLoad}
      onReset={handleReset}
      onReturnToLobby={handleReturnToLobby}
    />
  );

  if (host === null) return null;

  return (
    <>
      <PlayShell
        host={host}
        gameName={adapter.meta.gameName}
        toolbarLead={toolbarLead}
        toolbarTrail={toolbarTrail}
        {...(classes?.shell !== undefined ? { className: classes.shell } : {})}
        {...(classes?.shellToolbar !== undefined ? { toolbarClassName: classes.shellToolbar } : {})}
      />
      <Toaster position="top-right" />
    </>
  );
}

function RoomToolbarLead({
  snapshot,
  visibility,
  visibilityPending,
  onChangeVisibility,
  onCopyInvite,
  presence,
}: {
  snapshot: PlayRoomSnapshot;
  visibility: PlayRoomVisibility | undefined;
  visibilityPending: boolean;
  onChangeVisibility: ((next: PlayRoomVisibility) => void) | undefined;
  onCopyInvite: () => void;
  presence: PresenceSnapshot | null;
}) {
  return (
    <>
      <span>
        · room <span className="font-mono text-slate-900">{snapshot.roomID}</span>
      </span>
      <span>· {snapshot.isHost ? "you are host" : "guest"}</span>
      {visibility !== undefined && onChangeVisibility !== undefined && snapshot.isHost ? (
        <VisibilityToggle value={visibility} pending={visibilityPending} onChange={onChangeVisibility} />
      ) : visibility !== undefined ? (
        <span
          className="ml-1 rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-500"
          aria-label={`room is ${visibility}`}
        >
          {visibility === "public" ? "Public" : "Private"}
        </span>
      ) : null}
      <button
        type="button"
        className="ml-1 rounded-md border border-slate-200 px-2 py-1 text-xs hover:bg-slate-50"
        onClick={onCopyInvite}
      >
        Copy Invite
      </button>
      {presence !== null ? <PlayerSeats presence={presence} /> : null}
    </>
  );
}

function RoomToolbarActions({
  adapter,
  matchActive,
  onSave,
  onLoad,
  onReset,
  onReturnToLobby,
}: {
  adapter: PlayShellAdapter;
  matchActive: boolean;
  onSave: () => void;
  onLoad: () => void;
  onReset: () => void;
  onReturnToLobby: () => void;
}) {
  return (
    <>
      {adapter.saveCurrentRoom !== undefined ? (
        <ToolbarButton onClick={onSave}>Save</ToolbarButton>
      ) : null}
      {adapter.createRoomFromSave !== undefined ? (
        <ToolbarButton onClick={onLoad}>Load</ToolbarButton>
      ) : null}
      {adapter.resetRoom !== undefined ? (
        <ToolbarButton onClick={onReset} disabled={!matchActive}>
          Reset
        </ToolbarButton>
      ) : null}
      {adapter.returnToLobby !== undefined ? (
        <ToolbarButton onClick={onReturnToLobby} disabled={!matchActive}>
          Back to lobby
        </ToolbarButton>
      ) : null}
    </>
  );
}

function ToolbarButton({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="ml-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </button>
  );
}

export function VisibilityToggle({
  value,
  pending,
  onChange,
}: {
  value: PlayRoomVisibility;
  pending: boolean;
  onChange: (next: PlayRoomVisibility) => void;
}) {
  return (
    <span
      role="group"
      aria-label="Room visibility"
      className="ml-1 inline-flex overflow-hidden rounded-md border border-slate-200 text-xs"
    >
      {(["private", "public"] as const).map((option) => {
        const active = option === value;
        return (
          <button
            key={option}
            type="button"
            disabled={pending}
            aria-pressed={active}
            onClick={() => onChange(option)}
            className={
              active
                ? "bg-slate-900 px-2 py-1 text-white"
                : "px-2 py-1 text-slate-500 hover:bg-slate-100"
            }
          >
            {option === "public" ? "Public" : "Private"}
          </button>
        );
      })}
    </span>
  );
}

export function PlayerSeats({ presence }: { presence: PresenceSnapshot }) {
  if (presence.seats.length === 0) return null;
  return (
    <div className="ml-0 flex min-w-0 basis-full flex-wrap items-center gap-1.5 sm:ml-2 sm:basis-80 sm:grow">
      {presence.seats.map((seat) => {
        const state =
          seat.userID === null ? "open" : seat.connected ? "connected" : "disconnected";
        const tone =
          state === "connected"
            ? "bg-emerald-50 border-emerald-200 text-emerald-700"
            : state === "disconnected"
            ? "bg-red-50 border-red-200 text-red-700"
            : "bg-white border-slate-200 text-slate-400 italic";
        const dotTone =
          state === "open"
            ? "border border-dashed border-current"
            : "bg-current";
        const name =
          seat.userID === null
            ? `Seat ${seat.seatIndex + 1} · open`
            : seat.userName ?? `Player ${seat.userID.slice(0, 6)}`;
        return (
          <span
            key={seat.seatIndex}
            className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11px] ${tone}`}
            data-state={state}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${dotTone}`} />
            <span>{name}</span>
            {seat.userID !== null && seat.ready && presence.phase === "lobby" ? (
              <span className="text-emerald-600">✓</span>
            ) : null}
            {seat.userID !== null && !seat.connected && presence.phase === "active" ? (
              <span className="text-[10px] text-red-700">(disconnected)</span>
            ) : null}
          </span>
        );
      })}
    </div>
  );
}

export function useBridgeHost(
  snapshot: PlayRoomSnapshot,
  adapter: PlayShellAdapter,
): BridgeHost | null {
  const [host, setHost] = useState<BridgeHost | null>(null);
  const adapterRef = useRef(adapter);
  useEffect(() => {
    adapterRef.current = adapter;
  }, [adapter]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const next = createBridgeHost({
      bundleURL: snapshot.bundleURL,
      init: adapterRef.current.toBridgeInit(snapshot),
      refreshToken: (ctx) => adapterRef.current.refreshToken(ctx),
    });
    setHost(next);
    return () => {
      next.dispose();
      setHost(null);
    };
  }, [snapshot]);

  return host;
}

export function useBridgeMatchActive(host: BridgeHost | null, defaultActive: boolean): boolean {
  const [active, setActive] = useState(defaultActive);
  const lastHost = useRef<BridgeHost | null>(null);

  useEffect(() => {
    if (host === null) {
      lastHost.current = null;
      return;
    }
    setActive(host.matchActive);
    lastHost.current = host;
    return host.on("match-state-changed", ({ matchActive }) => setActive(matchActive));
  }, [host]);

  return active;
}

// ── helpers ────────────────────────────────────────────────────────────────

function cardClass(classes: PlayPageClassNames | undefined, hasError = false): string {
  if (classes?.card !== undefined || classes?.errorCard !== undefined) {
    return joinClasses(classes.card, hasError ? classes.errorCard : undefined);
  }
  return joinClasses(
    "rounded-lg border border-slate-200 bg-white p-5 shadow-sm",
    hasError ? "ring-1 ring-red-300" : "",
  );
}

function primaryButtonClass(classes: PlayPageClassNames | undefined): string {
  return classes?.primaryButton ??
    "inline-flex w-full items-center justify-center gap-1 rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50";
}

function outlineButtonClass(classes: PlayPageClassNames | undefined): string {
  return classes?.outlineButton ??
    "inline-flex items-center justify-center gap-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-900 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";
}

function joinClasses(...parts: ReadonlyArray<string | undefined>): string {
  return parts.filter((part): part is string => part !== undefined && part.length > 0).join(" ");
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}

function bytesToObjectURL(bytes: Uint8Array | undefined): string | null {
  if (bytes === undefined) return null;
  const blob = new Blob([new Uint8Array(bytes)], { type: "application/octet-stream" });
  return URL.createObjectURL(blob);
}
