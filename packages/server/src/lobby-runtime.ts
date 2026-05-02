import type {
  LobbyAvailableBot,
  LobbyClientMessage,
  LobbyDifficulty,
  LobbyPhase,
  LobbyRejectionReason,
  LobbySeat,
  LobbyStateMessage,
} from "@openturn/protocol";

export interface LobbyEnv {
  hostUserID: string;
  /** Lower bound for `start()`; baked from manifest. Static. */
  minPlayers: number;
  /** Upper bound on `targetCapacity`; equals `playerIDs.length`. Static. */
  maxPlayers: number;
  /**
   * Effective seat count for this room. Defaults to `maxPlayers` when the
   * caller doesn't pass one (matches pre-variable-capacity behavior). Host
   * mutates this via `setTargetCapacity` within `[minPlayers, maxPlayers]`.
   */
  targetCapacity?: number;
  // Canonical player IDs keyed by seat index. Length === maxPlayers.
  // The running game sees `match.players` filtered to the seated subset.
  playerIDs: readonly string[];
  /**
   * Optional registry mirror used to validate `lobby:assign_bot` botIDs and
   * to populate `lobby:state.availableBots`. Pass an empty map to disable
   * bot assignment in this room (assign requests will reject `unknown_bot`).
   * The runtime never invokes the bots themselves — that is the supervisor's
   * job once the lobby transitions to game.
   */
  knownBots?: ReadonlyMap<string, LobbyAvailableBotInfo>;
  /**
   * When true, `start()` rejects with `no_humans_seated` if every seated
   * player is a bot. Hosted (cloud) deployments enable this so randos can't
   * spawn pure-bot rooms; local CLI dev leaves it off so authors can dry-run
   * bot-vs-bot matches.
   */
  requireHumanSeat?: boolean;
}

export interface LobbyAvailableBotInfo {
  label: string;
  description?: string;
  difficulty?: LobbyDifficulty;
}

export type SeatRecord =
  | {
      kind: "human";
      seatIndex: number;
      userID: string;
      userName: string | null;
      ready: boolean;
    }
  | {
      kind: "bot";
      seatIndex: number;
      botID: string;
      label: string;
    };

export interface LobbyPersistedState {
  mode: LobbyPhase;
  seats: readonly SeatRecord[];
  userToPlayer: Readonly<Record<string, string>>;
  /** Effective capacity at persistence time. Restored on rehydrate. */
  targetCapacity?: number;
}

export type LobbyApplyResult =
  | { ok: true; changed: boolean }
  | { ok: false; reason: LobbyRejectionReason };

export interface LobbyStartAssignment {
  seatIndex: number;
  playerID: string;
  kind: "human" | "bot";
  /** Present for human seats only. */
  userID: string | null;
  /** Present for bot seats only. */
  botID: string | null;
}

export type LobbyStartResult =
  | { ok: true; assignments: readonly LobbyStartAssignment[] }
  | { ok: false; reason: LobbyRejectionReason };

export interface LobbyDropUserResult {
  changed: boolean;
  shouldCloseRoom: boolean;
}

/**
 * Pure state machine for the pre-game lobby. The DO (Cloudflare) and the CLI
 * local dev server both wrap an instance with their own WS/presence plumbing;
 * this class intentionally has no knowledge of sockets or persistence.
 *
 * Critical invariant: mutation methods must not await between reading and
 * writing seat state. Callers (both hosts) rely on their runtime's single-
 * threaded event loop to serialize concurrent messages.
 */
export class LobbyRuntime {
  readonly env: LobbyEnv;
  #mode: LobbyPhase;
  #seats: Map<number, SeatRecord>;
  #userToPlayer: Map<string, string>;
  #targetCapacity: number;

  constructor(env: LobbyEnv, persisted?: LobbyPersistedState) {
    this.env = env;
    const initialTarget = clampTargetCapacity(
      persisted?.targetCapacity ?? env.targetCapacity ?? env.maxPlayers,
      env.minPlayers,
      env.maxPlayers,
    );
    this.#targetCapacity = initialTarget;
    if (persisted === undefined) {
      this.#mode = "lobby";
      this.#seats = new Map();
      this.#userToPlayer = new Map();
      return;
    }
    this.#mode = persisted.mode;
    this.#seats = new Map(persisted.seats.map((seat) => [seat.seatIndex, { ...seat }]));
    this.#userToPlayer = new Map(Object.entries(persisted.userToPlayer));
  }

  get mode(): LobbyPhase {
    return this.#mode;
  }

  get seats(): readonly SeatRecord[] {
    return [...this.#seats.values()].sort((a, b) => a.seatIndex - b.seatIndex);
  }

  get targetCapacity(): number {
    return this.#targetCapacity;
  }

  playerIDFor(userID: string): string | null {
    return this.#userToPlayer.get(userID) ?? null;
  }

  seatIndexFor(userID: string): number | null {
    for (const seat of this.#seats.values()) {
      if (seat.kind === "human" && seat.userID === userID) return seat.seatIndex;
    }
    return null;
  }

  toPersisted(): LobbyPersistedState {
    return {
      mode: this.#mode,
      seats: [...this.#seats.values()].sort((a, b) => a.seatIndex - b.seatIndex),
      userToPlayer: Object.fromEntries(this.#userToPlayer),
      targetCapacity: this.#targetCapacity,
    };
  }

  // A freshly-cold-started runtime restores from storage, but because the
  // product rule is "disconnect frees seat immediately", all previously-held
  // human seats are invalidated if the transport lost its sockets. Bot seats
  // are unaffected (no socket to lose). Callers pass the currently-connected
  // users; everyone human else is kicked.
  pruneToConnected(connectedUserIDs: ReadonlySet<string>): boolean {
    if (this.#mode !== "lobby" && this.#mode !== "starting") return false;
    let changed = false;
    for (const [seatIndex, seat] of this.#seats) {
      if (seat.kind === "human" && !connectedUserIDs.has(seat.userID)) {
        this.#seats.delete(seatIndex);
        changed = true;
      }
    }
    return changed;
  }

  apply(
    userID: string,
    userName: string | null,
    message: LobbyClientMessage,
  ): LobbyApplyResult {
    // lobby:close is allowed from any non-closed mode; other messages require
    // the lobby mode.
    if (message.type !== "lobby:close" && this.#mode !== "lobby") {
      return {
        ok: false,
        reason: this.#mode === "closed" ? "room_closed" : "bad_phase",
      };
    }

    switch (message.type) {
      case "lobby:take_seat":
        return this.takeSeat(userID, userName, message.seatIndex);
      case "lobby:leave_seat":
        return this.leaveSeat(userID);
      case "lobby:set_ready":
        return this.setReady(userID, message.ready);
      case "lobby:start":
        // Start is validated via `start()` below; this path should not be used
        // because start returns assignments the caller needs. Callers must
        // invoke start() directly.
        return { ok: false, reason: "bad_phase" };
      case "lobby:close":
        return this.close(userID);
      case "lobby:assign_bot":
        return this.assignBot(userID, message.seatIndex, message.botID);
      case "lobby:clear_seat":
        return this.clearSeat(userID, message.seatIndex);
      case "lobby:set_target_capacity":
        return this.setTargetCapacity(userID, message.targetCapacity);
    }
  }

  takeSeat(userID: string, userName: string | null, seatIndex: number): LobbyApplyResult {
    if (!Number.isInteger(seatIndex) || seatIndex < 0 || seatIndex >= this.#targetCapacity) {
      return { ok: false, reason: "seat_out_of_range" };
    }
    const target = this.#seats.get(seatIndex);
    if (target !== undefined) {
      if (target.kind === "bot") {
        return { ok: false, reason: "seat_has_bot" };
      }
      if (target.userID !== userID) {
        return { ok: false, reason: "seat_taken" };
      }
    }

    // Free any other seat this user held (free-switching semantics).
    let changed = false;
    for (const [currentSeat, seat] of this.#seats) {
      if (seat.kind === "human" && seat.userID === userID && currentSeat !== seatIndex) {
        this.#seats.delete(currentSeat);
        changed = true;
      }
    }

    const existing = this.#seats.get(seatIndex);
    if (
      existing === undefined
      || existing.kind !== "human"
      || existing.userName !== userName
    ) {
      this.#seats.set(seatIndex, {
        kind: "human",
        seatIndex,
        userID,
        userName,
        ready: existing?.kind === "human" ? existing.ready : false,
      });
      changed = true;
    }
    return { ok: true, changed };
  }

  leaveSeat(userID: string): LobbyApplyResult {
    for (const [seatIndex, seat] of this.#seats) {
      if (seat.kind === "human" && seat.userID === userID) {
        this.#seats.delete(seatIndex);
        return { ok: true, changed: true };
      }
    }
    return { ok: false, reason: "not_seated" };
  }

  setReady(userID: string, ready: boolean): LobbyApplyResult {
    for (const seat of this.#seats.values()) {
      if (seat.kind === "human" && seat.userID === userID) {
        if (seat.ready === ready) return { ok: true, changed: false };
        seat.ready = ready;
        return { ok: true, changed: true };
      }
    }
    return { ok: false, reason: "not_seated" };
  }

  /**
   * Host-only. Replace whatever's at `seatIndex` with a bot from the
   * registry. Rejects `seat_has_human` if a human currently holds the seat
   * (host must `clearSeat` first — explicit avoids accidental kicks).
   */
  assignBot(hostUserID: string, seatIndex: number, botID: string): LobbyApplyResult {
    if (hostUserID !== this.env.hostUserID) {
      return { ok: false, reason: "not_host" };
    }
    if (!Number.isInteger(seatIndex) || seatIndex < 0 || seatIndex >= this.#targetCapacity) {
      return { ok: false, reason: "seat_out_of_range" };
    }
    const info = this.env.knownBots?.get(botID);
    if (info === undefined) {
      return { ok: false, reason: "unknown_bot" };
    }
    const existing = this.#seats.get(seatIndex);
    if (existing !== undefined && existing.kind === "human") {
      return { ok: false, reason: "seat_has_human" };
    }
    if (
      existing !== undefined
      && existing.kind === "bot"
      && existing.botID === botID
      && existing.label === info.label
    ) {
      return { ok: true, changed: false };
    }
    this.#seats.set(seatIndex, {
      kind: "bot",
      seatIndex,
      botID,
      label: info.label,
    });
    return { ok: true, changed: true };
  }

  /** Host-only. Clears whatever (bot or human) currently occupies the seat. */
  clearSeat(hostUserID: string, seatIndex: number): LobbyApplyResult {
    if (hostUserID !== this.env.hostUserID) {
      return { ok: false, reason: "not_host" };
    }
    if (!Number.isInteger(seatIndex) || seatIndex < 0 || seatIndex >= this.#targetCapacity) {
      return { ok: false, reason: "seat_out_of_range" };
    }
    if (!this.#seats.has(seatIndex)) {
      return { ok: true, changed: false };
    }
    this.#seats.delete(seatIndex);
    return { ok: true, changed: true };
  }

  /**
   * Host-only. Set the effective `targetCapacity`. Lowering capacity evicts
   * any seat whose `seatIndex >= targetCapacity` (humans become unseated;
   * bots are removed). Raising capacity simply opens new empty seats.
   * Allowed only in the `lobby` phase.
   */
  setTargetCapacity(hostUserID: string, targetCapacity: number): LobbyApplyResult {
    if (hostUserID !== this.env.hostUserID) {
      return { ok: false, reason: "not_host" };
    }
    if (this.#mode !== "lobby") {
      return {
        ok: false,
        reason: this.#mode === "closed" ? "room_closed" : "bad_phase",
      };
    }
    if (!Number.isInteger(targetCapacity)) {
      return { ok: false, reason: "bad_target" };
    }
    if (targetCapacity < this.env.minPlayers) {
      return { ok: false, reason: "target_below_min" };
    }
    if (targetCapacity > this.env.maxPlayers) {
      return { ok: false, reason: "target_above_max" };
    }
    if (targetCapacity === this.#targetCapacity) {
      return { ok: true, changed: false };
    }
    let changed = true;
    if (targetCapacity < this.#targetCapacity) {
      // Evict seats outside the new range.
      for (const [seatIndex] of this.#seats) {
        if (seatIndex >= targetCapacity) this.#seats.delete(seatIndex);
      }
    }
    this.#targetCapacity = targetCapacity;
    return { ok: true, changed };
  }

  start(hostUserID: string): LobbyStartResult {
    if (hostUserID !== this.env.hostUserID) {
      return { ok: false, reason: "not_host" };
    }
    if (this.#mode !== "lobby") {
      return {
        ok: false,
        reason: this.#mode === "closed" ? "room_closed" : "bad_phase",
      };
    }

    const seated = [...this.#seats.values()].sort((a, b) => a.seatIndex - b.seatIndex);
    if (seated.length < this.env.minPlayers) {
      return { ok: false, reason: "below_min_players" };
    }
    if (this.env.requireHumanSeat === true) {
      const hasHuman = seated.some((seat) => seat.kind === "human");
      if (!hasHuman) {
        return { ok: false, reason: "no_humans_seated" };
      }
    }
    // Bot seats are implicitly ready; only humans need to opt in.
    const humansNotReady = seated.some(
      (seat) => seat.kind === "human" && !seat.ready,
    );
    if (humansNotReady) {
      return { ok: false, reason: "not_ready" };
    }

    const assignments: LobbyStartAssignment[] = [];
    for (const seat of seated) {
      const playerID = this.env.playerIDs[seat.seatIndex];
      if (playerID === undefined) {
        return { ok: false, reason: "seat_out_of_range" };
      }
      if (seat.kind === "human") {
        assignments.push({
          seatIndex: seat.seatIndex,
          playerID,
          kind: "human",
          userID: seat.userID,
          botID: null,
        });
      } else {
        assignments.push({
          seatIndex: seat.seatIndex,
          playerID,
          kind: "bot",
          userID: null,
          botID: seat.botID,
        });
      }
    }

    this.#mode = "active";
    this.#userToPlayer = new Map(
      assignments
        .filter((a): a is LobbyStartAssignment & { userID: string } => a.userID !== null)
        .map((a) => [a.userID, a.playerID]),
    );
    return { ok: true, assignments };
  }

  close(hostUserID: string): LobbyApplyResult {
    if (hostUserID !== this.env.hostUserID) {
      return { ok: false, reason: "not_host" };
    }
    if (this.#mode === "closed") return { ok: true, changed: false };
    this.#mode = "closed";
    return { ok: true, changed: true };
  }

  // Removes a human user from every seat they occupy (e.g. on WS disconnect).
  // Bot seats are unaffected. Also flips the lobby to "closed" if the
  // disappearing user is the host and the room is still in the lobby phase.
  dropUser(userID: string): LobbyDropUserResult {
    if (this.#mode !== "lobby" && this.#mode !== "starting") {
      return { changed: false, shouldCloseRoom: false };
    }
    if (userID === this.env.hostUserID) {
      this.#mode = "closed";
      return { changed: true, shouldCloseRoom: true };
    }
    let changed = false;
    for (const [seatIndex, seat] of this.#seats) {
      if (seat.kind === "human" && seat.userID === userID) {
        this.#seats.delete(seatIndex);
        changed = true;
      }
    }
    return { changed, shouldCloseRoom: false };
  }

  buildStateMessage(
    roomID: string,
    connectedUserIDs: ReadonlySet<string>,
  ): LobbyStateMessage {
    const seats = buildSeatArray(this.#targetCapacity, this.#seats, connectedUserIDs);
    const seatedCount = seats.reduce(
      (total, seat) => (seat.kind === "open" ? total : total + 1),
      0,
    );
    // Bot seats are always ready; only check humans.
    const allReady = seats.every(
      (seat) => seat.kind !== "human" || seat.ready,
    );
    const canStart =
      this.#mode === "lobby" && seatedCount >= this.env.minPlayers && allReady;

    return {
      type: "lobby:state",
      roomID,
      phase: this.#mode,
      hostUserID: this.env.hostUserID,
      seats,
      minPlayers: this.env.minPlayers,
      maxPlayers: this.env.maxPlayers,
      targetCapacity: this.#targetCapacity,
      canStart,
      availableBots: buildAvailableBots(this.env.knownBots),
    };
  }
}

function clampTargetCapacity(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return max;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function buildSeatArray(
  capacity: number,
  seats: ReadonlyMap<number, SeatRecord>,
  connectedUserIDs: ReadonlySet<string>,
): LobbySeat[] {
  const out: LobbySeat[] = [];
  for (let i = 0; i < capacity; i += 1) {
    const seat = seats.get(i);
    if (seat === undefined) {
      out.push({ kind: "open", seatIndex: i });
      continue;
    }
    if (seat.kind === "human") {
      out.push({
        kind: "human",
        seatIndex: i,
        userID: seat.userID,
        userName: seat.userName,
        ready: seat.ready,
        connected: connectedUserIDs.has(seat.userID),
      });
    } else {
      out.push({
        kind: "bot",
        seatIndex: i,
        botID: seat.botID,
        label: seat.label,
      });
    }
  }
  return out;
}

function buildAvailableBots(
  knownBots: ReadonlyMap<string, LobbyAvailableBotInfo> | undefined,
): readonly LobbyAvailableBot[] {
  if (knownBots === undefined || knownBots.size === 0) return [];
  const out: LobbyAvailableBot[] = [];
  for (const [botID, info] of knownBots) {
    out.push({
      botID,
      label: info.label,
      ...(info.description === undefined ? {} : { description: info.description }),
      ...(info.difficulty === undefined ? {} : { difficulty: info.difficulty }),
    });
  }
  return out;
}
