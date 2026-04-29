import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  LobbyRuntime,
  type LobbyApplyResult,
  type LobbyEnv,
  type LobbyStartAssignment,
} from "@openturn/server";
import type { AnyGame, GamePlayers, MatchInput } from "@openturn/core";
import type {
  LobbyClientMessage,
  LobbyRejectedMessage,
  LobbyStateMessage,
  LobbyTransitionToGameMessage,
} from "@openturn/protocol";

import { buildKnownBots, type BotRegistry } from "../registry";
import type { LobbyChannelHandle, LobbyChannelStatus } from "./lobby";

const LOCAL_ROOM_ID = "local-room";

export interface UseLocalLobbyChannelOptions<TGame extends AnyGame> {
  /** The game definition; used to derive `playerIDs` from `match.players`. */
  game: TGame;
  /** Match roster — `match.players` becomes `LobbyEnv.playerIDs`. */
  match: MatchInput<GamePlayers<TGame>>;
  /**
   * Identifier for the local user. There's only one human in single-device
   * play, so this can be any stable string (e.g. `"local-host"`).
   */
  hostUserID: string;
  hostUserName?: string;
  /**
   * Optional bot registry. When supplied, `lobby:state.availableBots` is
   * populated and the host can `assignBot` from the registry. Ignored at
   * `start()` time — the consumer is responsible for wiring bots via the
   * returned `transition.playerAssignments`.
   */
  registry?: BotRegistry<TGame>;
  /**
   * Optional minimum seated count for `start()` to succeed. Defaults to
   * `match.minPlayers` (if declared) or `match.players.length`.
   */
  minPlayers?: number;
  /**
   * Optional initial target capacity (host-controlled in production). For
   * single-device play the dev usually wants `match.players.length`; lower it
   * to test variable-player behavior without manually clicking the capacity
   * picker. Bounded by `[minPlayers, match.players.length]`.
   */
  initialTargetCapacity?: number;
  /**
   * Auto-seat the local user at this index when the channel mounts.
   * Defaults to `0`. Pass `null` to skip auto-seat (rare — useful when the
   * UI flow wants the user to pick explicitly).
   */
  autoSeatIndex?: number | null;
  /** Auto-mark the local user as ready on mount. Defaults to `true`. */
  autoReady?: boolean;
  /**
   * Called on `start()` success with the full seat→player map. The consumer
   * uses this to construct the actual `LocalGameSession` and attach bots.
   */
  onTransitionToGame?: (input: {
    roomID: string;
    assignments: ReadonlyArray<LobbyStartAssignment>;
  }) => void;
}

/**
 * In-memory `LobbyChannelHandle` backed by a synchronous `LobbyRuntime`.
 * Renders the same `<Lobby>` / `<LobbyWithBots>` UI as the hosted
 * (WebSocket-backed) variant, but never opens a socket — useful for
 * single-device local play, Storybook, and tests.
 *
 * On `start()` success the channel:
 *  1. Calls `onTransitionToGame` with the full assignments map.
 *  2. Emits a `transition` event to subscribers (matching the hosted
 *     channel's `LobbyTransitionToGameMessage` shape, with empty
 *     `roomToken`/`websocketURL` since there's no remote connection).
 */
export function useLocalLobbyChannel<TGame extends AnyGame>(
  options: UseLocalLobbyChannelOptions<TGame>,
): LobbyChannelHandle {
  const {
    game,
    match,
    hostUserID,
    hostUserName,
    registry,
    minPlayers,
    initialTargetCapacity,
    autoSeatIndex = 0,
    autoReady = true,
    onTransitionToGame,
  } = options;

  const runtimeRef = useRef<LobbyRuntime | null>(null);
  if (runtimeRef.current === null) {
    const maxPlayers = match.players.length;
    const gameMinPlayers = (game as { minPlayers?: number }).minPlayers;
    const effectiveMin = minPlayers ?? gameMinPlayers ?? maxPlayers;
    const env: LobbyEnv = {
      hostUserID,
      minPlayers: effectiveMin,
      maxPlayers,
      ...(initialTargetCapacity === undefined
        ? {}
        : { targetCapacity: initialTargetCapacity }),
      playerIDs: match.players,
      ...(registry === undefined ? {} : { knownBots: buildKnownBots(registry) }),
    };
    runtimeRef.current = new LobbyRuntime(env);
  }
  const runtime = runtimeRef.current;

  const onTransitionRef = useRef(onTransitionToGame);
  onTransitionRef.current = onTransitionToGame;

  const [state, setState] = useState<LobbyStateMessage | null>(null);
  const [lastRejection, setLastRejection] = useState<LobbyRejectedMessage | null>(null);
  const [transition, setTransition] = useState<LobbyTransitionToGameMessage | null>(null);
  const [status, setStatus] = useState<LobbyChannelStatus>("connected");

  const refresh = useCallback(() => {
    setState(runtime.buildStateMessage(LOCAL_ROOM_ID, new Set([hostUserID])));
  }, [runtime, hostUserID]);

  const handleResult = useCallback(
    (result: LobbyApplyResult, echoType: LobbyClientMessage["type"]) => {
      if (!result.ok) {
        setLastRejection({
          type: "lobby:rejected",
          reason: result.reason,
          echoType,
        });
        return;
      }
      setLastRejection(null);
      if (result.changed) refresh();
    },
    [refresh],
  );

  // Initial seat + ready + state snapshot. Runs once.
  useEffect(() => {
    if (autoSeatIndex !== null) {
      runtime.takeSeat(hostUserID, hostUserName ?? null, autoSeatIndex);
      if (autoReady) runtime.setReady(hostUserID, true);
    }
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return useMemo<LobbyChannelHandle>(
    () => ({
      status,
      error: null,
      state,
      lastRejection,
      transition,
      closedReason: null,
      takeSeat: (seatIndex) =>
        handleResult(
          runtime.takeSeat(hostUserID, hostUserName ?? null, seatIndex),
          "lobby:take_seat",
        ),
      leaveSeat: () => handleResult(runtime.leaveSeat(hostUserID), "lobby:leave_seat"),
      setReady: (ready) => handleResult(runtime.setReady(hostUserID, ready), "lobby:set_ready"),
      start: () => {
        const result = runtime.start(hostUserID);
        if (!result.ok) {
          setLastRejection({
            type: "lobby:rejected",
            reason: result.reason,
            echoType: "lobby:start",
          });
          return;
        }
        setLastRejection(null);
        const myAssignment = result.assignments.find(
          (a) => a.kind === "human" && a.userID === hostUserID,
        );
        const transitionMessage: LobbyTransitionToGameMessage = {
          type: "lobby:transition_to_game",
          roomID: LOCAL_ROOM_ID,
          playerID: myAssignment?.playerID ?? result.assignments[0]!.playerID,
          roomToken: "",
          tokenExpiresAt: 0,
          websocketURL: "",
          playerAssignments: result.assignments.map((a) =>
            a.kind === "bot"
              ? {
                  seatIndex: a.seatIndex,
                  playerID: a.playerID,
                  kind: "bot" as const,
                  botID: a.botID!,
                }
              : {
                  seatIndex: a.seatIndex,
                  playerID: a.playerID,
                  kind: "human" as const,
                },
          ),
        };
        setTransition(transitionMessage);
        setStatus("transitioning");
        refresh();
        onTransitionRef.current?.({
          roomID: LOCAL_ROOM_ID,
          assignments: result.assignments,
        });
      },
      close: () => handleResult(runtime.close(hostUserID), "lobby:close"),
      assignBot: (seatIndex, botID) =>
        handleResult(runtime.assignBot(hostUserID, seatIndex, botID), "lobby:assign_bot"),
      clearSeat: (seatIndex) =>
        handleResult(runtime.clearSeat(hostUserID, seatIndex), "lobby:clear_seat"),
      setTargetCapacity: (targetCapacity) =>
        handleResult(
          runtime.setTargetCapacity(hostUserID, targetCapacity),
          "lobby:set_target_capacity",
        ),
      disconnect: () => {
        setStatus("closed");
      },
    }),
    [
      handleResult,
      hostUserID,
      hostUserName,
      lastRejection,
      refresh,
      runtime,
      state,
      status,
      transition,
    ],
  );
}
