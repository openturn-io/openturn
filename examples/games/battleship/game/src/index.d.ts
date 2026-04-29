import { type PlayerRecord } from "@openturn/core";
declare const PLAYERS: readonly ["0", "1"];
export type BattleshipPlayerID = (typeof PLAYERS)[number];
export declare const BOARD_SIZE = 10;
export type ShipID = "carrier" | "battleship" | "cruiser" | "submarine" | "destroyer";
export declare const SHIP_IDS: readonly ShipID[];
export declare const SHIP_LENGTHS: Readonly<Record<ShipID, number>>;
export declare const SHIP_NAMES: Readonly<Record<ShipID, string>>;
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
export type FleetMap = {
    [K in ShipID]?: FleetEntry;
};
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
export declare const battleshipMatch: import("@openturn/core").MatchInput<readonly ["0", "1"], import("@openturn/core").ReplayValue>;
export declare const battleship: import("@openturn/core").GameDefinition<import("@openturn/gamekit").GamekitState<BattleshipState>, {
    ready: undefined;
    placeShip: PlaceShipArgs;
    unplaceShip: UnplaceShipArgs;
    fire: FireArgs;
}, import("@openturn/gamekit").GamekitResultState, readonly ["0", "1"], "__gamekit_finished" | "planning" | "battle", BattleshipPublicView, BattleshipPlayerView, import("@openturn/core").ReplayValue, readonly import("@openturn/core").GameTransitionConfig<import("@openturn/gamekit").GamekitState<BattleshipState>, {
    ready: undefined;
    placeShip: PlaceShipArgs;
    unplaceShip: UnplaceShipArgs;
    fire: FireArgs;
}, import("@openturn/gamekit").GamekitResultState, "__gamekit_finished" | "planning" | "battle", readonly ["0", "1"], import("@openturn/core").ReplayValue>[]>;
export declare function opponentOf(id: BattleshipPlayerID): BattleshipPlayerID;
export declare function createEmptyBoard(): BoardCell[][];
export declare function shipFootprint(shipID: ShipID, row: number, col: number, orientation: Orientation): Coord[] | null;
export declare function canPlaceShip(board: readonly (readonly BoardCell[])[], shipID: ShipID, row: number, col: number, orientation: Orientation): boolean;
export {};
