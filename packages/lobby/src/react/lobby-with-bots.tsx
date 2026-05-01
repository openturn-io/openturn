import { useCallback, type ReactNode } from "react";

import {
  LobbyShell,
  type LobbyProps,
  type LobbySeatButtonProps,
  type LobbyView,
} from "./lobby";
import { LobbySeatControl } from "./seat-control";

export interface LobbyWithBotsProps extends LobbyProps {}

/**
 * Bot-aware lobby. Renders the standard `<Lobby>` round table but replaces
 * the per-seat button with a `<LobbySeatControl>` that surfaces:
 *
 * - "Take seat" + "Assign bot ▾" dropdown on open seats (host viewers only).
 * - "🤖 Bot · {label}" chip with "✕ Clear" (host viewers only).
 * - "Player {name}" chip with "Leave" (your own seat) or "✕ Kick" (host).
 *
 * The bot catalog comes from `lobby.availableBots`, which the server
 * populates from `LobbyEnv.knownBots` (mirroring the game's bot registry).
 *
 * Apps that want to keep the legacy round-table button (no bots) can use
 * plain `<Lobby>` from `@openturn/lobby/react`.
 */
export function LobbyWithBots(props: LobbyWithBotsProps): ReactNode {
  const { lobby } = props;
  const enabled = lobby.phase === "lobby" && lobby.status === "connected";

  const renderSeat = useCallback(
    (seatProps: LobbySeatButtonProps) =>
      renderBotAwareSeat(seatProps, lobby, enabled),
    [lobby, enabled],
  );

  return <LobbyShell {...props} renderSeat={renderSeat} />;
}

function renderBotAwareSeat(
  seatProps: LobbySeatButtonProps,
  lobby: LobbyView,
  enabled: boolean,
): ReactNode {
  const { seat, isMine } = seatProps;
  return (
    <LobbySeatControl
      seat={seat}
      isMine={isMine}
      isHost={lobby.isHost}
      enabled={enabled}
      availableBots={lobby.availableBots}
      onTakeSeat={() => lobby.takeSeat(seat.seatIndex)}
      onLeaveSeat={() => lobby.leaveSeat()}
      onAssignBot={(botID) => lobby.assignBot(seat.seatIndex, botID)}
      onClearSeat={() => lobby.clearSeat(seat.seatIndex)}
    />
  );
}
