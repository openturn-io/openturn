import { defineMatch } from "@openturn/core";
import { defineGame, turn } from "@openturn/gamekit";
const PLAYERS = ["0", "1"];
export const BOARD_SIZE = 10;
export const SHIP_IDS = [
    "carrier",
    "battleship",
    "cruiser",
    "submarine",
    "destroyer",
];
export const SHIP_LENGTHS = {
    carrier: 5,
    battleship: 4,
    cruiser: 3,
    submarine: 3,
    destroyer: 2,
};
export const SHIP_NAMES = {
    carrier: "Carrier",
    battleship: "Battleship",
    cruiser: "Cruiser",
    submarine: "Submarine",
    destroyer: "Destroyer",
};
export const battleshipMatch = defineMatch({
    players: PLAYERS,
});
export const battleship = defineGame(battleshipMatch, {
    initialPhase: "planning",
    turn: turn.roundRobin(),
    setup: () => ({
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
        placeShip: move({
            phases: ["planning"],
            run({ G, args, move: m, player }) {
                const me = G.players[player.id];
                if (me.ready) {
                    return m.invalid("already_ready");
                }
                if (me.fleet[args.shipID] !== undefined) {
                    return m.invalid("ship_already_placed", { shipID: args.shipID });
                }
                const placement = tryPlaceShip(me.board, args.shipID, args.row, args.col, args.orientation);
                if (placement === null) {
                    return m.invalid("invalid_placement", {
                        shipID: args.shipID,
                        row: args.row,
                        col: args.col,
                        orientation: args.orientation,
                    });
                }
                const nextMe = {
                    ...me,
                    board: placement.board,
                    fleet: { ...me.fleet, [args.shipID]: placement.entry },
                    shotsReceived: [...me.shotsReceived],
                };
                return m.stay({
                    players: setPlayer(G.players, player.id, nextMe),
                });
            },
        }),
        unplaceShip: move({
            phases: ["planning"],
            run({ G, args, move: m, player }) {
                const me = G.players[player.id];
                if (me.ready) {
                    return m.invalid("already_ready");
                }
                const entry = me.fleet[args.shipID];
                if (entry === undefined) {
                    return m.invalid("ship_not_placed", { shipID: args.shipID });
                }
                const board = removeShipFromBoard(me.board, entry);
                const nextFleet = { ...me.fleet };
                delete nextFleet[args.shipID];
                const nextMe = {
                    ...me,
                    board,
                    fleet: nextFleet,
                    shotsReceived: [...me.shotsReceived],
                };
                return m.stay({
                    players: setPlayer(G.players, player.id, nextMe),
                });
            },
        }),
        ready: move({
            phases: ["planning"],
            run({ G, move: m, player }) {
                const me = G.players[player.id];
                if (me.ready) {
                    return m.invalid("already_ready");
                }
                const placedCount = SHIP_IDS.filter((id) => me.fleet[id] !== undefined).length;
                if (placedCount !== SHIP_IDS.length) {
                    return m.invalid("fleet_incomplete", { placed: placedCount, required: SHIP_IDS.length });
                }
                const nextMe = {
                    ...me,
                    ready: true,
                    shotsReceived: [...me.shotsReceived],
                };
                const players = setPlayer(G.players, player.id, nextMe);
                if (players["0"].ready && players["1"].ready) {
                    return m.goto("battle", { players });
                }
                return m.stay({ players });
            },
        }),
        fire: move({
            phases: ["battle"],
            run({ G, args, move: m, player, turn: t }) {
                if (player.id !== t.currentPlayer) {
                    return m.invalid("not_your_turn");
                }
                if (!isInBounds(args.row, args.col)) {
                    return m.invalid("out_of_bounds", { row: args.row, col: args.col });
                }
                const attackerID = player.id;
                const opponentID = opponentOf(attackerID);
                const opponent = G.players[opponentID];
                const alreadyFired = opponent.shotsReceived.some((s) => s.at.row === args.row && s.at.col === args.col);
                if (alreadyFired) {
                    return m.invalid("already_fired", { row: args.row, col: args.col });
                }
                const outcome = applyShot(opponent.board, opponent.fleet, attackerID, args);
                const nextOpponent = {
                    board: outcome.board,
                    fleet: outcome.fleet,
                    ready: opponent.ready,
                    shotsReceived: [...opponent.shotsReceived, outcome.shot],
                };
                const players = setPlayer(G.players, opponentID, nextOpponent);
                const patch = {
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
        player: ({ G, turn: t, phase }, player) => computePlayerView(G, t.currentPlayer, phase, player.id),
        public: ({ G, turn: t, phase }) => computePublicView(G, t.currentPlayer, phase),
    },
});
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
export function opponentOf(id) {
    return id === "0" ? "1" : "0";
}
function freshPlayerData() {
    return {
        board: createEmptyBoard(),
        fleet: {},
        ready: false,
        shotsReceived: [],
    };
}
export function createEmptyBoard() {
    return Array.from({ length: BOARD_SIZE }, () => Array.from({ length: BOARD_SIZE }, () => ({ ship: null })));
}
function isInBounds(row, col) {
    return row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE;
}
export function shipFootprint(shipID, row, col, orientation) {
    const length = SHIP_LENGTHS[shipID];
    const cells = [];
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
export function canPlaceShip(board, shipID, row, col, orientation) {
    const footprint = shipFootprint(shipID, row, col, orientation);
    if (footprint === null)
        return false;
    for (const { row: r, col: c } of footprint) {
        if (board[r]?.[c]?.ship != null) {
            return false;
        }
    }
    return true;
}
function tryPlaceShip(board, shipID, row, col, orientation) {
    const footprint = shipFootprint(shipID, row, col, orientation);
    if (footprint === null)
        return null;
    for (const { row: r, col: c } of footprint) {
        if (board[r]?.[c]?.ship != null) {
            return null;
        }
    }
    const next = board.map((r) => r.map((cell) => ({ ship: cell.ship })));
    for (const { row: r, col: c } of footprint) {
        next[r][c].ship = shipID;
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
function removeShipFromBoard(board, entry) {
    const next = board.map((r) => r.map((cell) => ({ ship: cell.ship })));
    for (const { row, col } of entry.cells) {
        if (next[row]?.[col] !== undefined) {
            next[row][col].ship = null;
        }
    }
    return next;
}
function applyShot(board, fleet, attacker, args) {
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
    const nextEntry = {
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
function isFleetSunk(fleet) {
    return SHIP_IDS.every((id) => {
        const entry = fleet[id];
        return entry !== undefined && entry.hits >= entry.length;
    });
}
function countRemaining(data) {
    let remaining = 0;
    for (const id of SHIP_IDS) {
        const entry = data.fleet[id];
        if (entry !== undefined && entry.hits < entry.length) {
            remaining += 1;
        }
    }
    return remaining;
}
function sunkShipIDs(data) {
    const sunk = [];
    for (const id of SHIP_IDS) {
        const entry = data.fleet[id];
        if (entry !== undefined && entry.hits >= entry.length) {
            sunk.push(id);
        }
    }
    return sunk;
}
function setPlayer(players, id, next) {
    return {
        ...players,
        [id]: next,
    };
}
function normalizePhase(phase) {
    if (phase === "planning" || phase === "battle") {
        return phase;
    }
    return "gameOver";
}
function computePlayerView(G, currentPlayer, phase, myID) {
    const phaseName = normalizePhase(phase);
    const me = G.players[myID];
    const opponentID = opponentOf(myID);
    const opponent = G.players[opponentID];
    const myShotsAtOpponent = opponent.shotsReceived
        .filter((s) => s.by === myID)
        .map((s) => ({
        by: s.by,
        at: { row: s.at.row, col: s.at.col },
        result: s.result,
        sunkShipID: s.sunkShipID,
    }));
    const opponentFleetSunk = [];
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
function computePublicView(G, currentPlayer, phase) {
    const phaseName = normalizePhase(phase);
    const shotsByPlayer = {
        "0": G.players["1"].shotsReceived.filter((s) => s.by === "0"),
        "1": G.players["0"].shotsReceived.filter((s) => s.by === "1"),
    };
    const fleetStatus = {
        "0": { remaining: countRemaining(G.players["0"]), sunk: sunkShipIDs(G.players["0"]) },
        "1": { remaining: countRemaining(G.players["1"]), sunk: sunkShipIDs(G.players["1"]) },
    };
    const sunkRevealedByPlayer = {
        "0": sunkShipIDs(G.players["0"]).map((id) => ({
            shipID: id,
            cells: G.players["0"].fleet[id].cells.map((c) => ({ row: c.row, col: c.col })),
        })),
        "1": sunkShipIDs(G.players["1"]).map((id) => ({
            shipID: id,
            cells: G.players["1"].fleet[id].cells.map((c) => ({ row: c.row, col: c.col })),
        })),
    };
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
function resolveWinner(G, phase) {
    if (phase !== "gameOver")
        return null;
    if (isFleetSunk(G.players["1"].fleet))
        return "0";
    if (isFleetSunk(G.players["0"].fleet))
        return "1";
    return null;
}
