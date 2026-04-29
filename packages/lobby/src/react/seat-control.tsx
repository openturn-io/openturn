import { useId, useState, type ReactNode } from "react";

import type { LobbyAvailableBot, LobbySeat } from "@openturn/protocol";

export interface LobbySeatControlProps {
  seat: LobbySeat;
  isMine: boolean;
  isHost: boolean;
  /**
   * `true` when the lobby is currently accepting structural changes
   * (`phase === "lobby" && status === "connected"`). Disables every action.
   */
  enabled: boolean;
  availableBots: ReadonlyArray<LobbyAvailableBot>;
  onTakeSeat: () => void;
  onLeaveSeat: () => void;
  /** Host-only. */
  onAssignBot: (botID: string) => void;
  /** Host-only. */
  onClearSeat: () => void;
}

const CONTROL_BASE =
  "openturn-lobby-seat__control group/seat relative flex w-full flex-col items-center gap-1.5 rounded-xl border p-2 text-center transition duration-150 ease-out";
const CONTROL_DISABLED = " cursor-not-allowed opacity-60";

const TONE: Record<"open" | "mine" | "taken" | "bot", string> = {
  open: " border-slate-200 bg-white text-slate-700 hover:border-slate-300",
  mine: " border-slate-900 bg-slate-900 text-slate-50 shadow-sm",
  taken: " border-slate-200 bg-slate-50 text-slate-600",
  bot: " border-indigo-200 bg-indigo-50 text-indigo-900",
};

const AVATAR_TONE: Record<"open" | "mine" | "taken" | "bot", string> = {
  open: "border border-dashed border-slate-300 bg-slate-100 text-slate-400",
  mine: "bg-slate-50 text-slate-900",
  taken: "bg-slate-200 text-slate-700",
  bot: "bg-indigo-100 text-indigo-900",
};

/**
 * Bot-aware per-seat control. Renders a button (open/mine/taken seats) or a
 * compact card with host actions (bot seats; host viewers see a dropdown to
 * pick a bot from `availableBots`, plus a Clear button for occupied seats).
 *
 * This is the default `renderSeat` for `<LobbyWithBots>`. Apps that want
 * full custom seat chrome can pass their own `renderSeat` to plain `<Lobby>`
 * and call out to whatever shape they prefer.
 */
export function LobbySeatControl(props: LobbySeatControlProps): ReactNode {
  const { seat, isMine, isHost, enabled, availableBots } = props;
  const seatNumber = seat.seatIndex + 1;

  if (seat.kind === "open") {
    if (isHost) {
      return (
        <OpenSeatHostMenu
          seatIndex={seat.seatIndex}
          enabled={enabled}
          availableBots={availableBots}
          onTakeSeat={props.onTakeSeat}
          onAssignBot={props.onAssignBot}
        />
      );
    }
    return (
      <button
        type="button"
        aria-label={`Take seat ${seatNumber}`}
        data-seat-index={seat.seatIndex}
        data-seat-kind="open"
        disabled={!enabled}
        onClick={props.onTakeSeat}
        className={`${CONTROL_BASE}${enabled ? "" : CONTROL_DISABLED}${TONE.open}`}
      >
        <Avatar tone="open">{seatNumber}</Avatar>
        <Label>Take seat</Label>
      </button>
    );
  }

  if (seat.kind === "bot") {
    return (
      <div
        data-seat-index={seat.seatIndex}
        data-seat-kind="bot"
        className={`${CONTROL_BASE}${TONE.bot}`}
      >
        <Avatar tone="bot">🤖</Avatar>
        <Label>Bot · {seat.label}</Label>
        {isHost ? (
          <button
            type="button"
            aria-label={`Clear bot from seat ${seatNumber}`}
            disabled={!enabled}
            onClick={props.onClearSeat}
            className="openturn-lobby-seat__clear text-[10px] font-medium uppercase tracking-wide text-indigo-700 underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:opacity-50"
          >
            ✕ Clear
          </button>
        ) : null}
      </div>
    );
  }

  // Human seat
  const tone = isMine ? "mine" : "taken";
  return (
    <div
      data-seat-index={seat.seatIndex}
      data-seat-kind="human"
      data-tone={tone}
      className={`${CONTROL_BASE}${TONE[tone]}`}
    >
      <Avatar tone={tone}>{humanInitials(seat)}</Avatar>
      <Label>{seat.userName ?? `Player ${seat.userID.slice(0, 6)}`}</Label>
      {isMine ? (
        <button
          type="button"
          aria-label="Leave seat"
          disabled={!enabled}
          onClick={props.onLeaveSeat}
          className="openturn-lobby-seat__leave text-[10px] font-medium uppercase tracking-wide text-slate-50/80 underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:opacity-50"
        >
          Leave
        </button>
      ) : isHost ? (
        <button
          type="button"
          aria-label={`Kick player from seat ${seatNumber}`}
          disabled={!enabled}
          onClick={props.onClearSeat}
          className="openturn-lobby-seat__kick text-[10px] font-medium uppercase tracking-wide text-slate-500 underline-offset-2 hover:text-red-600 hover:underline disabled:cursor-not-allowed disabled:opacity-50"
        >
          ✕ Kick
        </button>
      ) : null}
    </div>
  );
}

function OpenSeatHostMenu(props: {
  seatIndex: number;
  enabled: boolean;
  availableBots: ReadonlyArray<LobbyAvailableBot>;
  onTakeSeat: () => void;
  onAssignBot: (botID: string) => void;
}): ReactNode {
  const { seatIndex, enabled, availableBots, onTakeSeat, onAssignBot } = props;
  const [open, setOpen] = useState(false);
  const seatNumber = seatIndex + 1;
  const labelID = useId();

  return (
    <div
      data-seat-index={seatIndex}
      data-seat-kind="open"
      className={`${CONTROL_BASE}${enabled ? "" : CONTROL_DISABLED}${TONE.open}`}
    >
      <Avatar tone="open">{seatNumber}</Avatar>
      <Label id={labelID}>Open seat</Label>
      <div className="openturn-lobby-seat__host-actions flex flex-col items-stretch gap-1 w-full">
        <button
          type="button"
          aria-label={`Take seat ${seatNumber}`}
          disabled={!enabled}
          onClick={onTakeSeat}
          className="openturn-lobby-seat__take w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:border-slate-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Take seat
        </button>
        {availableBots.length > 0 ? (
          <div className="openturn-lobby-seat__bot-menu relative w-full">
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={open}
              aria-controls={`${labelID}-bots`}
              disabled={!enabled}
              onClick={() => setOpen((current) => !current)}
              className="w-full rounded-md border border-indigo-300 bg-indigo-50 px-2 py-1 text-[11px] font-medium text-indigo-900 hover:border-indigo-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {open ? "Cancel" : "Assign bot ▾"}
            </button>
            {open ? (
              <ul
                id={`${labelID}-bots`}
                role="menu"
                aria-labelledby={labelID}
                className="openturn-lobby-seat__bot-options absolute left-0 right-0 z-10 mt-1 flex flex-col gap-px overflow-hidden rounded-md border border-indigo-200 bg-white shadow-lg"
              >
                {availableBots.map((bot) => (
                  <li key={bot.botID} role="none">
                    <button
                      type="button"
                      role="menuitem"
                      data-bot-id={bot.botID}
                      onClick={() => {
                        setOpen(false);
                        onAssignBot(bot.botID);
                      }}
                      className="openturn-lobby-seat__bot-option flex w-full flex-col items-start gap-0 px-2 py-1 text-left text-[11px] hover:bg-indigo-50"
                    >
                      <span className="font-medium text-indigo-900">{bot.label}</span>
                      {bot.difficulty !== undefined ? (
                        <span className="text-[10px] uppercase tracking-wide text-indigo-500">
                          {bot.difficulty}
                        </span>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Avatar({ tone, children }: { tone: keyof typeof AVATAR_TONE; children: ReactNode }) {
  return (
    <span
      aria-hidden
      className={`openturn-lobby-seat__avatar inline-flex h-11 w-11 flex-none items-center justify-center rounded-full text-sm font-semibold ${AVATAR_TONE[tone]}`}
    >
      {children}
    </span>
  );
}

function Label({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <span
      id={id}
      className="openturn-lobby-seat__label block w-full truncate px-1 text-xs font-medium leading-tight"
    >
      {children}
    </span>
  );
}

function humanInitials(seat: Extract<LobbySeat, { kind: "human" }>): string {
  const source = seat.userName ?? seat.userID;
  const trimmed = source.trim();
  if (trimmed.length === 0) return String(seat.seatIndex + 1);
  const parts = trimmed.split(/\s+/).slice(0, 2);
  const initials = parts.map((part) => part[0] ?? "").join("");
  return initials.toUpperCase() || String(seat.seatIndex + 1);
}
