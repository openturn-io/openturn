import type { PlayerRecord } from "@openturn/core";
import { defineGame, turn } from "@openturn/gamekit";

const PLAYERS = ["0", "1"] as const;
export type BattleshipPlayerID = (typeof PLAYERS)[number];

export const BOARD_SIZE = 10;

export type ShipID = "carrier" | "battleship" | "cruiser" | "submarine" | "destroyer";

export const SHIP_IDS: readonly ShipID[] = [
  "carrier",
  "battleship",
  "cruiser",
  "submarine",
  "destroyer",
];

export const SHIP_LENGTHS: Readonly<Record<ShipID, number>> = {
  carrier: 5,
  battleship: 4,
  cruiser: 3,
  submarine: 3,
  destroyer: 2,
};

export const SHIP_NAMES: Readonly<Record<ShipID, string>> = {
  carrier: "Carrier",
  battleship: "Battleship",
  cruiser: "Cruiser",
  submarine: "Submarine",
  destroyer: "Destroyer",
};

export type Orientation = "horizontal" | "vertical";
export type ShotResult = "miss" | "hit" | "sunk";

export interface Coord {
  row: number;
  col: number;
}

export interface Shot {
  by: BattleshipPlayerID;
  at: Coord;
  result: ShotResult;
  sunkShipID: ShipID | null;
}

export interface BoardCell {
  ship: ShipID | null;
}

export interface FleetEntry {
  length: number;
  cells: readonly Coord[];
  hits: number;
}

export type FleetMap = { [K in ShipID]?: FleetEntry };

export interface PlayerGameData {
  board: readonly (readonly BoardCell[])[];
  fleet: FleetMap;
  ready: boolean;
  shotsReceived: readonly Shot[];
}

export type BattleshipPhase = "planning" | "battle" | "gameOver";

export interface BattleshipState {
  players: PlayerRecord<typeof PLAYERS, PlayerGameData>;
  lastShot: Shot | null;
}

export interface PlaceShipArgs {
  shipID: ShipID;
  row: number;
  col: number;
  orientation: Orientation;
}

export interface UnplaceShipArgs {
  shipID: ShipID;
}

export interface FireArgs {
  row: number;
  col: number;
}

export interface SunkShipReveal {
  shipID: ShipID;
  cells: readonly Coord[];
}

export interface BattleshipPlayerView {
  phase: BattleshipPhase;
  currentTurn: BattleshipPlayerID | null;
  winner: BattleshipPlayerID | null;
  myPlayerID: BattleshipPlayerID;
  opponentID: BattleshipPlayerID;
  myBoard: readonly (readonly BoardCell[])[];
  myFleet: FleetMap;
  myReady: boolean;
  opponentReady: boolean;
  opponentShotsAtMe: readonly Shot[];
  myShotsAtOpponent: readonly Shot[];
  opponentFleetSunk: readonly SunkShipReveal[];
  myShipsRemaining: number;
  opponentShipsRemaining: number;
  lastShot: Shot | null;
}

export interface PublicFleetStatus {
  remaining: number;
  sunk: readonly ShipID[];
}

export interface BattleshipPublicView {
  phase: BattleshipPhase;
  currentTurn: BattleshipPlayerID | null;
  winner: BattleshipPlayerID | null;
  shotsByPlayer: PlayerRecord<typeof PLAYERS, readonly Shot[]>;
  fleetStatus: PlayerRecord<typeof PLAYERS, PublicFleetStatus>;
  sunkRevealedByPlayer: PlayerRecord<typeof PLAYERS, readonly SunkShipReveal[]>;
  readyStatus: PlayerRecord<typeof PLAYERS, boolean>;
  lastShot: Shot | null;
}

export const battleship = defineGame({
  playerIDs: PLAYERS,
  initialPhase: "planning",
  turn: turn.roundRobin(),

  setup: (): BattleshipState => ({
    players: {
      "0": freshPlayerData(),
      "1": freshPlayerData(),
    },
    lastShot: null,
  }),

  phases: {
    planning: {
      label: "Place your fleet",
      activePlayers: ({ G }) => PLAYERS.filter((p) => !G.players[p].ready),
    },
    battle: {
      label: ({ turn: t }) => `Admiral ${t.currentPlayer} to fire`,
    },
  },

  moves: ({ move }) => ({
    placeShip: move<PlaceShipArgs>({
      phases: ["planning"],
      run({ G, args, move: m, player }) {
        const me = G.players[player.id as BattleshipPlayerID];
        if (me.ready) {
          return m.invalid("already_ready");
        }
        if (me.fleet[args.shipID] !== undefined) {
          return m.invalid("ship_already_placed", { shipID: args.shipID });
        }
        const placement = tryPlaceShip(me.board as BoardCell[][], args.shipID, args.row, args.col, args.orientation);
        if (placement === null) {
          return m.invalid("invalid_placement", {
            shipID: args.shipID,
            row: args.row,
            col: args.col,
            orientation: args.orientation,
          });
        }
        const nextMe: PlayerGameData = {
          ...me,
          board: placement.board,
          fleet: { ...me.fleet, [args.shipID]: placement.entry },
          shotsReceived: [...me.shotsReceived],
        };
        return m.stay({
          players: setPlayer(G.players, player.id as BattleshipPlayerID, nextMe),
        });
      },
    }),

    unplaceShip: move<UnplaceShipArgs>({
      phases: ["planning"],
      run({ G, args, move: m, player }) {
        const me = G.players[player.id as BattleshipPlayerID];
        if (me.ready) {
          return m.invalid("already_ready");
        }
        const entry = me.fleet[args.shipID];
        if (entry === undefined) {
          return m.invalid("ship_not_placed", { shipID: args.shipID });
        }
        const board = removeShipFromBoard(me.board as BoardCell[][], entry);
        const nextFleet = { ...me.fleet };
        delete nextFleet[args.shipID];
        const nextMe: PlayerGameData = {
          ...me,
          board,
          fleet: nextFleet,
          shotsReceived: [...me.shotsReceived],
        };
        return m.stay({
          players: setPlayer(G.players, player.id as BattleshipPlayerID, nextMe),
        });
      },
    }),

    ready: move<undefined>({
      phases: ["planning"],
      run({ G, move: m, player }) {
        const me = G.players[player.id as BattleshipPlayerID];
        if (me.ready) {
          return m.invalid("already_ready");
        }
        const placedCount = SHIP_IDS.filter((id) => me.fleet[id] !== undefined).length;
        if (placedCount !== SHIP_IDS.length) {
          return m.invalid("fleet_incomplete", { placed: placedCount, required: SHIP_IDS.length });
        }
        const nextMe: PlayerGameData = {
          ...me,
          ready: true,
          shotsReceived: [...me.shotsReceived],
        };
        const players = setPlayer(G.players, player.id as BattleshipPlayerID, nextMe);
        if (players["0"].ready && players["1"].ready) {
          return m.goto("battle", { players });
        }
        return m.stay({ players });
      },
    }),

    fire: move<FireArgs>({
      phases: ["battle"],
      run({ G, args, move: m, player, turn: t }) {
        if (player.id !== t.currentPlayer) {
          return m.invalid("not_your_turn");
        }
        if (!isInBounds(args.row, args.col)) {
          return m.invalid("out_of_bounds", { row: args.row, col: args.col });
        }
        const attackerID = player.id as BattleshipPlayerID;
        const opponentID = opponentOf(attackerID);
        const opponent = G.players[opponentID];
        const alreadyFired = opponent.shotsReceived.some(
          (s) => s.at.row === args.row && s.at.col === args.col,
        );
        if (alreadyFired) {
          return m.invalid("already_fired", { row: args.row, col: args.col });
        }
        const outcome = applyShot(
          opponent.board as BoardCell[][],
          opponent.fleet,
          attackerID,
          args,
        );
        const nextOpponent: PlayerGameData = {
          board: outcome.board,
          fleet: outcome.fleet,
          ready: opponent.ready,
          shotsReceived: [...opponent.shotsReceived, outcome.shot],
        };
        const players = setPlayer(G.players, opponentID, nextOpponent);
        const patch: Partial<BattleshipState> = {
          players,
          lastShot: outcome.shot,
        };
        if (isFleetSunk(nextOpponent.fleet)) {
          return m.finish({ winner: attackerID }, patch);
        }
        return m.endTurn(patch);
      },
    }),
  }),

  views: {
    player: ({ G, turn: t, phase }, player): BattleshipPlayerView =>
      computePlayerView(G as BattleshipState, t.currentPlayer as BattleshipPlayerID, phase as BattleshipPhase, player.id as BattleshipPlayerID),
    public: ({ G, turn: t, phase }): BattleshipPublicView =>
      computePublicView(G as BattleshipState, t.currentPlayer as BattleshipPlayerID, phase as BattleshipPhase),
  },
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function opponentOf(id: BattleshipPlayerID): BattleshipPlayerID {
  return id === "0" ? "1" : "0";
}

function freshPlayerData(): PlayerGameData {
  return {
    board: createEmptyBoard(),
    fleet: {},
    ready: false,
    shotsReceived: [],
  };
}

export function createEmptyBoard(): BoardCell[][] {
  return Array.from({ length: BOARD_SIZE }, () =>
    Array.from({ length: BOARD_SIZE }, () => ({ ship: null as ShipID | null })),
  );
}

function isInBounds(row: number, col: number): boolean {
  return row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE;
}

export function shipFootprint(
  shipID: ShipID,
  row: number,
  col: number,
  orientation: Orientation,
): Coord[] | null {
  const length = SHIP_LENGTHS[shipID];
  const cells: Coord[] = [];
  for (let i = 0; i < length; i++) {
    const r = orientation === "vertical" ? row + i : row;
    const c = orientation === "horizontal" ? col + i : col;
    if (!isInBounds(r, c)) {
      return null;
    }
    cells.push({ row: r, col: c });
  }
  return cells;
}

export function canPlaceShip(
  board: readonly (readonly BoardCell[])[],
  shipID: ShipID,
  row: number,
  col: number,
  orientation: Orientation,
): boolean {
  const footprint = shipFootprint(shipID, row, col, orientation);
  if (footprint === null) return false;
  for (const { row: r, col: c } of footprint) {
    if (board[r]?.[c]?.ship != null) {
      return false;
    }
  }
  return true;
}

function tryPlaceShip(
  board: readonly (readonly BoardCell[])[],
  shipID: ShipID,
  row: number,
  col: number,
  orientation: Orientation,
): { board: BoardCell[][]; entry: FleetEntry } | null {
  const footprint = shipFootprint(shipID, row, col, orientation);
  if (footprint === null) return null;
  for (const { row: r, col: c } of footprint) {
    if (board[r]?.[c]?.ship != null) {
      return null;
    }
  }
  const next = board.map((r) => r.map((cell) => ({ ship: cell.ship })));
  for (const { row: r, col: c } of footprint) {
    next[r]![c]!.ship = shipID;
  }
  return {
    board: next,
    entry: {
      length: SHIP_LENGTHS[shipID],
      cells: footprint,
      hits: 0,
    },
  };
}

function removeShipFromBoard(
  board: readonly (readonly BoardCell[])[],
  entry: FleetEntry,
): BoardCell[][] {
  const next = board.map((r) => r.map((cell) => ({ ship: cell.ship })));
  for (const { row, col } of entry.cells) {
    if (next[row]?.[col] !== undefined) {
      next[row]![col]!.ship = null;
    }
  }
  return next;
}

function applyShot(
  board: readonly (readonly BoardCell[])[],
  fleet: { [K in ShipID]?: FleetEntry },
  attacker: BattleshipPlayerID,
  args: FireArgs,
): { board: BoardCell[][]; fleet: { [K in ShipID]?: FleetEntry }; shot: Shot } {
  const nextBoard = board.map((r) => r.map((cell) => ({ ship: cell.ship })));
  const targetShip = nextBoard[args.row]?.[args.col]?.ship ?? null;
  if (targetShip === null) {
    return {
      board: nextBoard,
      fleet,
      shot: {
        by: attacker,
        at: { row: args.row, col: args.col },
        result: "miss",
        sunkShipID: null,
      },
    };
  }

  const prevEntry = fleet[targetShip];
  if (prevEntry === undefined) {
    return {
      board: nextBoard,
      fleet,
      shot: {
        by: attacker,
        at: { row: args.row, col: args.col },
        result: "miss",
        sunkShipID: null,
      },
    };
  }
  const nextEntry: FleetEntry = {
    length: prevEntry.length,
    cells: prevEntry.cells.map((c) => ({ row: c.row, col: c.col })),
    hits: prevEntry.hits + 1,
  };
  const nextFleet = { ...fleet, [targetShip]: nextEntry };
  const isSunk = nextEntry.hits >= nextEntry.length;
  return {
    board: nextBoard,
    fleet: nextFleet,
    shot: {
      by: attacker,
      at: { row: args.row, col: args.col },
      result: isSunk ? "sunk" : "hit",
      sunkShipID: isSunk ? targetShip : null,
    },
  };
}

function isFleetSunk(fleet: { [K in ShipID]?: FleetEntry }): boolean {
  return SHIP_IDS.every((id) => {
    const entry = fleet[id];
    return entry !== undefined && entry.hits >= entry.length;
  });
}

function countRemaining(data: PlayerGameData): number {
  let remaining = 0;
  for (const id of SHIP_IDS) {
    const entry = data.fleet[id];
    if (entry !== undefined && entry.hits < entry.length) {
      remaining += 1;
    }
  }
  return remaining;
}

function sunkShipIDs(data: PlayerGameData): ShipID[] {
  const sunk: ShipID[] = [];
  for (const id of SHIP_IDS) {
    const entry = data.fleet[id];
    if (entry !== undefined && entry.hits >= entry.length) {
      sunk.push(id);
    }
  }
  return sunk;
}

function setPlayer(
  players: PlayerRecord<typeof PLAYERS, PlayerGameData>,
  id: BattleshipPlayerID,
  next: PlayerGameData,
): PlayerRecord<typeof PLAYERS, PlayerGameData> {
  return {
    ...players,
    [id]: next,
  };
}

function normalizePhase(phase: string): BattleshipPhase {
  if (phase === "planning" || phase === "battle") {
    return phase;
  }
  return "gameOver";
}

function computePlayerView(
  G: BattleshipState,
  currentPlayer: BattleshipPlayerID,
  phase: BattleshipPhase | string,
  myID: BattleshipPlayerID,
): BattleshipPlayerView {
  const phaseName = normalizePhase(phase);
  const me = G.players[myID];
  const opponentID = opponentOf(myID);
  const opponent = G.players[opponentID];
  const myShotsAtOpponent: Shot[] = opponent.shotsReceived
    .filter((s) => s.by === myID)
    .map((s) => ({
      by: s.by,
      at: { row: s.at.row, col: s.at.col },
      result: s.result,
      sunkShipID: s.sunkShipID,
    }));
  const opponentFleetSunk: SunkShipReveal[] = [];
  for (const id of SHIP_IDS) {
    const entry = opponent.fleet[id];
    if (entry !== undefined && entry.hits >= entry.length) {
      opponentFleetSunk.push({
        shipID: id,
        cells: entry.cells.map((c) => ({ row: c.row, col: c.col })),
      });
    }
  }
  const winner = resolveWinner(G, phaseName);
  return {
    phase: phaseName,
    currentTurn: phaseName === "battle" ? currentPlayer : null,
    winner,
    myPlayerID: myID,
    opponentID,
    myBoard: me.board,
    myFleet: me.fleet,
    myReady: me.ready,
    opponentReady: opponent.ready,
    opponentShotsAtMe: me.shotsReceived,
    myShotsAtOpponent,
    opponentFleetSunk,
    myShipsRemaining: countRemaining(me),
    opponentShipsRemaining: countRemaining(opponent),
    lastShot: G.lastShot,
  };
}

function computePublicView(
  G: BattleshipState,
  currentPlayer: BattleshipPlayerID,
  phase: BattleshipPhase | string,
): BattleshipPublicView {
  const phaseName = normalizePhase(phase);
  const shotsByPlayer = {
    "0": G.players["1"].shotsReceived.filter((s) => s.by === "0"),
    "1": G.players["0"].shotsReceived.filter((s) => s.by === "1"),
  } as PlayerRecord<typeof PLAYERS, readonly Shot[]>;
  const fleetStatus = {
    "0": { remaining: countRemaining(G.players["0"]), sunk: sunkShipIDs(G.players["0"]) },
    "1": { remaining: countRemaining(G.players["1"]), sunk: sunkShipIDs(G.players["1"]) },
  } as PlayerRecord<typeof PLAYERS, PublicFleetStatus>;
  const sunkRevealedByPlayer = {
    "0": sunkShipIDs(G.players["0"]).map((id) => ({
      shipID: id,
      cells: G.players["0"].fleet[id]!.cells.map((c) => ({ row: c.row, col: c.col })),
    })),
    "1": sunkShipIDs(G.players["1"]).map((id) => ({
      shipID: id,
      cells: G.players["1"].fleet[id]!.cells.map((c) => ({ row: c.row, col: c.col })),
    })),
  } as PlayerRecord<typeof PLAYERS, readonly SunkShipReveal[]>;
  return {
    phase: phaseName,
    currentTurn: phaseName === "battle" ? currentPlayer : null,
    winner: resolveWinner(G, phaseName),
    shotsByPlayer,
    fleetStatus,
    sunkRevealedByPlayer,
    readyStatus: { "0": G.players["0"].ready, "1": G.players["1"].ready },
    lastShot: G.lastShot,
  };
}

function resolveWinner(G: BattleshipState, phase: BattleshipPhase): BattleshipPlayerID | null {
  if (phase !== "gameOver") return null;
  if (isFleetSunk(G.players["1"].fleet)) return "0";
  if (isFleetSunk(G.players["0"].fleet)) return "1";
  return null;
}
