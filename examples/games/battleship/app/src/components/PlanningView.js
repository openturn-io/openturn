import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import * as React from "react";
import { BOARD_SIZE, canPlaceShip, shipFootprint, SHIP_IDS, SHIP_LENGTHS, } from "@openturn/example-battleship-game";
import { AnchorIcon, CheckmarkCircle02Icon, SparklesIcon } from "@hugeicons/core-free-icons";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Icon } from "./ui/icon";
import { BoardGrid } from "./BoardGrid";
import { useDragShip } from "./hooks/useDragShip";
import { ShipTray } from "./ShipTray";
import { cn } from "../lib/utils";
export function PlanningView({ view, canPlace, onPlaceShip, onUnplaceShip, onReady, }) {
    const drag = useDragShip();
    const [selected, setSelected] = React.useState(null);
    const [hover, setHover] = React.useState(null);
    const activeShip = drag.current ?? selected;
    const activeOrientation = activeShip?.orientation ?? "horizontal";
    // Keyboard rotate also flips the "selected" (click-placement) state.
    React.useEffect(() => {
        if (selected === null)
            return;
        const handler = (event) => {
            if (event.key === "r" || event.key === "R") {
                event.preventDefault();
                setSelected((state) => state === null
                    ? state
                    : { ...state, orientation: state.orientation === "horizontal" ? "vertical" : "horizontal" });
            }
            else if (event.key === "Escape") {
                setSelected(null);
            }
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [selected]);
    const overlay = React.useMemo(() => {
        if (activeShip === null || hover === null)
            return null;
        const footprint = shipFootprint(activeShip.shipID, hover.row, hover.col, activeShip.orientation);
        if (footprint === null)
            return null;
        const valid = canPlaceShip(view.myBoard, activeShip.shipID, hover.row, hover.col, activeShip.orientation);
        return { cells: footprint, tone: (valid ? "ghost" : "ghost-bad") };
    }, [activeShip, hover, view.myBoard]);
    const myRenderCell = React.useCallback((coord) => renderOwnPlanningCell(view.myBoard, coord, view.opponentShotsAtMe), [view.myBoard, view.opponentShotsAtMe]);
    const handleDrop = (coord) => {
        if (activeShip === null)
            return;
        if (!canPlaceShip(view.myBoard, activeShip.shipID, coord.row, coord.col, activeShip.orientation)) {
            return;
        }
        onPlaceShip({ shipID: activeShip.shipID, row: coord.row, col: coord.col, orientation: activeShip.orientation });
        setSelected(null);
        drag.endDrag();
    };
    const handleCellClick = (coord) => {
        if (!canPlace)
            return;
        if (selected === null && drag.current === null)
            return;
        handleDrop(coord);
    };
    const handleRotate = () => {
        drag.rotate();
        setSelected((state) => state === null
            ? state
            : { ...state, orientation: state.orientation === "horizontal" ? "vertical" : "horizontal" });
    };
    const handleSelect = (shipID) => {
        if (shipID === null) {
            setSelected(null);
            return;
        }
        setSelected({ shipID, orientation: activeOrientation });
    };
    const handleRandomize = () => {
        if (!canPlace)
            return;
        const working = view.myBoard.map((row) => row.map((cell) => ({ ship: cell.ship })));
        const placed = [];
        for (const shipID of SHIP_IDS) {
            if (view.myFleet[shipID] !== undefined)
                continue;
            let attempt = 0;
            while (attempt < 200) {
                const orientation = Math.random() < 0.5 ? "horizontal" : "vertical";
                const row = Math.floor(Math.random() * BOARD_SIZE);
                const col = Math.floor(Math.random() * BOARD_SIZE);
                if (canPlaceShip(working, shipID, row, col, orientation)) {
                    const footprint = shipFootprint(shipID, row, col, orientation);
                    for (const { row: r, col: c } of footprint) {
                        working[r][c].ship = shipID;
                    }
                    placed.push({ shipID, row, col, orientation });
                    break;
                }
                attempt += 1;
            }
        }
        for (const entry of placed) {
            onPlaceShip(entry);
        }
    };
    const placedCount = SHIP_IDS.filter((id) => view.myFleet[id] !== undefined).length;
    const fleetComplete = placedCount === SHIP_IDS.length;
    const myLabel = view.myPlayerID === "0" ? "Admiral 1" : "Admiral 2";
    const opponentLabel = view.opponentID === "0" ? "Admiral 1" : "Admiral 2";
    return (_jsxs("section", { className: "flex h-full min-h-0 w-full flex-col gap-2", children: [_jsxs("header", { className: "flex flex-wrap items-baseline justify-between gap-2", children: [_jsxs("div", { children: [_jsx("p", { className: "m-0 text-[0.7rem] font-medium uppercase tracking-[0.22em] text-slate-500", children: "Planning phase" }), _jsxs("h2", { className: "m-0 font-display text-xl tracking-tight text-slate-950", children: ["Deploy your fleet, ", myLabel.toLowerCase()] })] }), _jsxs("div", { className: "flex items-center gap-2", children: [_jsxs(Badge, { variant: view.myReady ? "success" : "outline", children: [_jsx(Icon, { icon: CheckmarkCircle02Icon, size: 14 }), "You \u2014 ", view.myReady ? "ready" : `${placedCount}/${SHIP_IDS.length} placed`] }), _jsxs(Badge, { variant: view.opponentReady ? "success" : "outline", children: [_jsx(Icon, { icon: AnchorIcon, size: 14 }), opponentLabel, " \u2014 ", view.opponentReady ? "ready" : "placing"] })] })] }), _jsxs("div", { className: "flex min-h-0 min-w-0 flex-1 flex-col gap-3 lg:flex-row lg:gap-4", children: [_jsx("div", { className: "flex min-h-0 min-w-0 flex-1 items-center justify-center [container-type:size]", children: _jsx("div", { style: { width: "min(100cqw, calc(100cqh * 0.95))" }, children: _jsx(BoardGrid, { label: "Your fleet placement grid", className: "w-full", renderCell: myRenderCell, overlay: overlay, onCellClick: handleCellClick, onCellHover: setHover, onCellDragOver: (_coord, event) => {
                                    if (activeShip !== null)
                                        event.preventDefault();
                                }, onCellDrop: (coord, event) => {
                                    event.preventDefault();
                                    handleDrop(coord);
                                }, disabled: !canPlace }) }) }), _jsxs("aside", { className: "flex min-h-0 w-full flex-col gap-2 overflow-auto lg:w-[340px] lg:shrink-0", children: [_jsx(ShipTray, { fleet: view.myFleet, selectedShipID: selected?.shipID ?? null, orientation: activeOrientation, onSelect: handleSelect, onRotate: handleRotate, onDragStart: (shipID) => drag.startDrag({ shipID, orientation: activeOrientation }), onDragEnd: drag.endDrag, onUnplace: (shipID) => onUnplaceShip({ shipID }), onRandomize: handleRandomize, disabled: !canPlace }), _jsxs("div", { className: cn("rounded-xl border bg-white/80 p-4 shadow-sm", fleetComplete ? "border-emerald-300 bg-emerald-50/60" : "border-border"), children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx(Icon, { icon: SparklesIcon, size: 18, className: "text-emerald-600" }), _jsx("strong", { className: "text-sm text-slate-800", children: fleetComplete
                                                    ? view.myReady
                                                        ? "Standing by for opponent"
                                                        : "Ready to engage?"
                                                    : `${SHIP_IDS.length - placedCount} ships remaining` })] }), _jsxs("p", { className: "mt-1 text-xs text-slate-500", children: ["Total fleet tonnage: ", SHIP_IDS.reduce((acc, id) => acc + SHIP_LENGTHS[id], 0), " cells \u2014 ships cannot overlap, diagonals allowed between ships."] }), _jsx(Button, { className: "mt-3 w-full", disabled: !canPlace || !fleetComplete || view.myReady, onClick: onReady, children: view.myReady ? "Waiting for opponent" : "Lock in fleet" })] })] })] })] }));
}
function renderOwnPlanningCell(board, coord, incoming) {
    const cell = board[coord.row]?.[coord.col];
    const shipID = cell?.ship ?? null;
    const shot = incoming.find((s) => s.at.row === coord.row && s.at.col === coord.col);
    if (shot) {
        if (shot.result === "miss") {
            return { tone: "miss", content: _jsx(MissMark, {}), title: "enemy miss" };
        }
        return {
            tone: shot.result === "sunk" ? "sunk" : "hit",
            content: _jsx(HitMark, { sunk: shot.result === "sunk" }),
            title: shot.result === "sunk" ? "ship sunk" : "hit",
        };
    }
    if (shipID !== null) {
        return { tone: "ship", content: _jsx(ShipDot, {}), title: shipID };
    }
    return { tone: "sea" };
}
function ShipDot() {
    return _jsx("span", { className: "mx-auto block h-1.5 w-1.5 rounded-full bg-white/80" });
}
function MissMark() {
    return _jsx("span", { className: "mx-auto block h-2 w-2 rounded-full bg-slate-500" });
}
function HitMark({ sunk }) {
    return (_jsx("span", { className: cn("mx-auto block h-2.5 w-2.5 rounded-full", sunk ? "bg-white" : "bg-white/90") }));
}
