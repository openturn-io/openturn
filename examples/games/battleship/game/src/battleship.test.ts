import { describe, expect, test } from "bun:test";

import { createLocalSession } from "@openturn/core";

import {
  battleship,
  BOARD_SIZE,
  SHIP_IDS,
  SHIP_LENGTHS,
  type BattleshipPlayerID,
  type BattleshipPlayerView,
  type Orientation,
  type ShipID,
} from "./index";

const battleshipMatch = { players: battleship.playerIDs };

type Session = ReturnType<typeof createLocalSession<typeof battleship>>;

interface Placement {
  shipID: ShipID;
  row: number;
  col: number;
  orientation: Orientation;
}

const STANDARD_LAYOUT_0: readonly Placement[] = [
  { shipID: "carrier", row: 0, col: 0, orientation: "horizontal" },
  { shipID: "battleship", row: 1, col: 0, orientation: "horizontal" },
  { shipID: "cruiser", row: 2, col: 0, orientation: "horizontal" },
  { shipID: "submarine", row: 3, col: 0, orientation: "horizontal" },
  { shipID: "destroyer", row: 4, col: 0, orientation: "horizontal" },
];

const STANDARD_LAYOUT_1: readonly Placement[] = [
  { shipID: "carrier", row: 0, col: 0, orientation: "vertical" },
  { shipID: "battleship", row: 0, col: 1, orientation: "vertical" },
  { shipID: "cruiser", row: 0, col: 2, orientation: "vertical" },
  { shipID: "submarine", row: 0, col: 3, orientation: "vertical" },
  { shipID: "destroyer", row: 0, col: 4, orientation: "vertical" },
];

function fresh(): Session {
  return createLocalSession(battleship, { match: battleshipMatch });
}

function placeAll(session: Session, player: BattleshipPlayerID, layout: readonly Placement[]) {
  for (const placement of layout) {
    const result = session.applyEvent(player, "placeShip", placement);
    if (!result.ok) {
      throw new Error(`placeShip failed for ${player} ${placement.shipID}: ${JSON.stringify(result)}`);
    }
  }
}

function playerView(session: Session, id: BattleshipPlayerID): BattleshipPlayerView {
  return session.getPlayerView(id) as BattleshipPlayerView;
}

describe("battleship gamekit example", () => {
  test("starts in planning with both players active", () => {
    const session = fresh();
    const state = session.getState();
    expect(state.position.name).toBe("planning");
    expect([...state.derived.activePlayers].sort()).toEqual(["0", "1"]);
  });

  test("rejects out-of-bounds placement", () => {
    const session = fresh();
    const result = session.applyEvent("0", "placeShip", {
      shipID: "carrier",
      row: 9,
      col: 7,
      orientation: "horizontal",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("invalid_placement");
    }
  });

  test("rejects overlapping placement", () => {
    const session = fresh();
    session.applyEvent("0", "placeShip", {
      shipID: "carrier",
      row: 0,
      col: 0,
      orientation: "horizontal",
    });
    const overlap = session.applyEvent("0", "placeShip", {
      shipID: "battleship",
      row: 0,
      col: 2,
      orientation: "horizontal",
    });
    expect(overlap.ok).toBe(false);
    if (!overlap.ok) {
      expect(overlap.reason).toBe("invalid_placement");
    }
  });

  test("rejects placing the same ship twice", () => {
    const session = fresh();
    session.applyEvent("0", "placeShip", {
      shipID: "destroyer",
      row: 0,
      col: 0,
      orientation: "horizontal",
    });
    const duplicate = session.applyEvent("0", "placeShip", {
      shipID: "destroyer",
      row: 5,
      col: 5,
      orientation: "horizontal",
    });
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) {
      expect(duplicate.reason).toBe("ship_already_placed");
    }
  });

  test("unplaceShip frees the board cells", () => {
    const session = fresh();
    session.applyEvent("0", "placeShip", {
      shipID: "destroyer",
      row: 0,
      col: 0,
      orientation: "horizontal",
    });
    const view = playerView(session, "0");
    expect(view.myFleet.destroyer).toBeDefined();
    expect(view.myBoard[0]![0]!.ship).toBe("destroyer");

    session.applyEvent("0", "unplaceShip", { shipID: "destroyer" });
    const after = playerView(session, "0");
    expect(after.myFleet.destroyer).toBeUndefined();
    expect(after.myBoard[0]![0]!.ship).toBeNull();
  });

  test("ready is rejected until the full fleet is placed", () => {
    const session = fresh();
    const incomplete = session.applyEvent("0", "ready", undefined);
    expect(incomplete.ok).toBe(false);
    if (!incomplete.ok) {
      expect(incomplete.reason).toBe("fleet_incomplete");
    }

    placeAll(session, "0", STANDARD_LAYOUT_0);
    const ok = session.applyEvent("0", "ready", undefined);
    expect(ok.ok).toBe(true);
  });

  test("firing is rejected during planning", () => {
    const session = fresh();
    const rejected = session.applyEvent("0", "fire", { row: 0, col: 0 });
    expect(rejected.ok).toBe(false);
  });

  test("both players ready transitions into battle with player 0 to fire", () => {
    const session = fresh();
    placeAll(session, "0", STANDARD_LAYOUT_0);
    placeAll(session, "1", STANDARD_LAYOUT_1);
    session.applyEvent("0", "ready", undefined);
    session.applyEvent("1", "ready", undefined);

    const state = session.getState();
    expect(state.position.name).toBe("battle");
    expect(state.derived.activePlayers).toEqual(["0"]);
  });

  test("fire with miss advances the turn", () => {
    const session = fresh();
    placeAll(session, "0", STANDARD_LAYOUT_0);
    placeAll(session, "1", STANDARD_LAYOUT_1);
    session.applyEvent("0", "ready", undefined);
    session.applyEvent("1", "ready", undefined);

    // Player 1's ships are in cols 0-4 rows 0-4; firing at (9,9) is a miss.
    const result = session.applyEvent("0", "fire", { row: 9, col: 9 });
    expect(result.ok).toBe(true);

    const view = playerView(session, "0");
    expect(view.myShotsAtOpponent).toHaveLength(1);
    expect(view.myShotsAtOpponent[0]!.result).toBe("miss");

    const state = session.getState();
    expect(state.derived.activePlayers).toEqual(["1"]);
  });

  test("firing twice at the same cell is rejected", () => {
    const session = fresh();
    placeAll(session, "0", STANDARD_LAYOUT_0);
    placeAll(session, "1", STANDARD_LAYOUT_1);
    session.applyEvent("0", "ready", undefined);
    session.applyEvent("1", "ready", undefined);
    session.applyEvent("0", "fire", { row: 9, col: 9 });
    session.applyEvent("1", "fire", { row: 9, col: 9 });
    const duplicate = session.applyEvent("0", "fire", { row: 9, col: 9 });
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) {
      expect(duplicate.reason).toBe("already_fired");
    }
  });

  test("player view hides the opponent's ship positions", () => {
    const session = fresh();
    placeAll(session, "0", STANDARD_LAYOUT_0);
    placeAll(session, "1", STANDARD_LAYOUT_1);
    session.applyEvent("0", "ready", undefined);
    session.applyEvent("1", "ready", undefined);

    const view = playerView(session, "0");
    const serialized = JSON.stringify(view);
    // No opponent ship cell data should appear in the player view until sunk.
    expect(view.opponentFleetSunk).toEqual([]);
    expect(serialized).not.toContain("\"opponentBoard\"");
    // myBoard belongs to the viewer only.
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        const cell = view.myBoard[r]![c]!;
        if (cell.ship !== null) {
          const entry = view.myFleet[cell.ship];
          expect(entry).toBeDefined();
        }
      }
    }
  });

  test("sinking an opponent ship reports sunk and reveals its cells", () => {
    const session = fresh();
    placeAll(session, "0", STANDARD_LAYOUT_0);
    placeAll(session, "1", STANDARD_LAYOUT_1);
    session.applyEvent("0", "ready", undefined);
    session.applyEvent("1", "ready", undefined);

    const destroyerLen = SHIP_LENGTHS.destroyer;
    // Player 1 placed destroyer vertically at col 4, rows 0..destroyerLen-1.
    for (let i = 0; i < destroyerLen; i++) {
      const hit = session.applyEvent("0", "fire", { row: i, col: 4 });
      expect(hit.ok).toBe(true);
      if (i < destroyerLen - 1) {
        // Player 1 uses a wasted shot in a safe corner so the turn returns to player 0.
        const waste = session.applyEvent("1", "fire", { row: 9, col: 9 - i });
        expect(waste.ok).toBe(true);
      }
    }

    const view = playerView(session, "0");
    const sunk = view.opponentFleetSunk.find((s) => s.shipID === "destroyer");
    expect(sunk).toBeDefined();
    expect(sunk!.cells.length).toBe(destroyerLen);
    const last = view.myShotsAtOpponent[view.myShotsAtOpponent.length - 1]!;
    expect(last.result).toBe("sunk");
    expect(last.sunkShipID).toBe("destroyer");
  });

  test("sinking the entire opponent fleet ends the game", () => {
    const session = fresh();
    placeAll(session, "0", STANDARD_LAYOUT_0);
    placeAll(session, "1", STANDARD_LAYOUT_1);
    session.applyEvent("0", "ready", undefined);
    session.applyEvent("1", "ready", undefined);

    // Flatten every opponent ship cell so player 0 can fire in order.
    const targets: { row: number; col: number }[] = [];
    for (const ship of SHIP_IDS) {
      const view = playerView(session, "1");
      const entry = view.myFleet[ship]!;
      for (const cell of entry.cells) {
        targets.push({ row: cell.row, col: cell.col });
      }
    }

    let wasteIndex = 0;
    for (const target of targets) {
      const result = session.applyEvent("0", "fire", target);
      expect(result.ok).toBe(true);
      const state = session.getState();
      if (state.meta.result !== null) {
        break;
      }
      // Wastes a turn for player 1 on a known-empty cell on player 0's board.
      const row = 5 + Math.floor(wasteIndex / 5);
      const col = 5 + (wasteIndex % 5);
      wasteIndex += 1;
      const waste = session.applyEvent("1", "fire", { row, col });
      expect(waste.ok).toBe(true);
    }

    const state = session.getState();
    expect(state.meta.result).toEqual({ winner: "0" });
    expect(state.position.name).toBe("__gamekit_finished");
  });
});
