import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import * as React from "react";
import { SHIP_IDS, SHIP_NAMES, } from "@openturn/example-battleship-game";
import { AnchorIcon, Cancel01Icon, Fire02Icon, SparklesIcon, Target02Icon, } from "@hugeicons/core-free-icons";
import { Badge } from "./ui/badge";
import { Icon } from "./ui/icon";
import { BoardGrid } from "./BoardGrid";
import { cn } from "../lib/utils";
export function BattleView({ view, canFire, onFire, isGameOver }) {
    const isMyTurn = view.currentTurn === view.myPlayerID;
    const myLabel = view.myPlayerID === "0" ? "Admiral 1" : "Admiral 2";
    const opponentLabel = view.opponentID === "0" ? "Admiral 1" : "Admiral 2";
    const sunkMap = React.useMemo(() => {
        const map = new Map();
        for (const reveal of view.opponentFleetSunk) {
            for (const cell of reveal.cells) {
                map.set(`${cell.row}:${cell.col}`, reveal.shipID);
            }
        }
        return map;
    }, [view.opponentFleetSunk]);
    const ownRender = React.useCallback((coord) => renderDefensiveCell(view, coord), [view]);
    const targetRender = React.useCallback((coord) => renderTargetCell(view, coord, sunkMap), [view, sunkMap]);
    return (_jsxs("section", { className: "flex h-full min-h-0 w-full flex-col gap-3", children: [_jsx(StatusPanel, { view: view, isMyTurn: isMyTurn, myLabel: myLabel, opponentLabel: opponentLabel, isGameOver: isGameOver }), _jsxs("div", { className: "flex min-h-0 min-w-0 flex-1 flex-col gap-3 lg:flex-row lg:gap-4", children: [_jsx(BoardPanel, { title: `Your waters — ${myLabel}`, subtitle: `${view.myShipsRemaining} ships afloat`, tone: "defensive", children: _jsx(BoardGrid, { label: "Your defensive board", renderCell: ownRender, disabled: true, className: "w-full" }) }), _jsx(BoardPanel, { title: `Target — ${opponentLabel}`, subtitle: isGameOver
                            ? view.winner === view.myPlayerID
                                ? "Victory"
                                : "Defeat"
                            : isMyTurn
                                ? "Click an untested cell to fire"
                                : `Awaiting ${opponentLabel}'s shot`, tone: "offensive", accent: isMyTurn && !isGameOver, children: _jsx(BoardGrid, { label: "Opponent target board", renderCell: targetRender, onCellClick: canFire && !isGameOver
                                ? (coord) => onFire({ row: coord.row, col: coord.col })
                                : undefined, disabled: !canFire || isGameOver, className: "w-full" }) })] })] }));
}
function BoardPanel({ title, subtitle, children, tone, accent, }) {
    return (_jsxs("div", { className: cn("flex min-h-0 min-w-0 flex-1 flex-col gap-2 rounded-2xl border bg-white/70 p-3 shadow-[0_10px_30px_rgba(15,23,42,0.06)] backdrop-blur", accent ? "border-sea-mid ring-2 ring-sea-mid/20" : "border-border"), children: [_jsxs("div", { className: "flex w-full items-center justify-between gap-2", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx(Icon, { icon: tone === "defensive" ? AnchorIcon : Target02Icon, size: 18, className: tone === "defensive" ? "text-sea-mid" : "text-hit" }), _jsx("strong", { className: "text-sm text-slate-800", children: title })] }), subtitle ? _jsx("span", { className: "text-[11px] text-slate-500", children: subtitle }) : null] }), _jsx("div", { className: "flex min-h-0 min-w-0 flex-1 items-center justify-center [container-type:size]", children: _jsx("div", { style: { width: "min(100cqw, calc(100cqh * 0.95))" }, children: children }) })] }));
}
function StatusPanel({ view, isMyTurn, myLabel, opponentLabel, isGameOver, }) {
    const mySunk = SHIP_IDS.filter((id) => {
        const entry = view.myFleet[id];
        return entry !== undefined && entry.hits >= entry.length;
    });
    const opponentSunk = view.opponentFleetSunk.map((s) => s.shipID);
    const lastShot = view.lastShot;
    return (_jsxs("div", { className: "flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-white/80 px-5 py-4 shadow-sm", children: [_jsxs("div", { className: "flex flex-col", children: [_jsx("p", { className: "m-0 text-[0.72rem] font-medium uppercase tracking-[0.22em] text-slate-500", children: isGameOver ? "Battle complete" : "Battle phase" }), _jsx("h2", { className: "m-0 font-display text-2xl text-slate-950", children: isGameOver
                            ? view.winner === view.myPlayerID
                                ? `${myLabel} wins`
                                : `${opponentLabel} wins`
                            : isMyTurn
                                ? `Your turn, ${myLabel}`
                                : `Awaiting ${opponentLabel}` })] }), _jsxs("div", { className: "flex flex-wrap items-center gap-2 text-xs", children: [_jsxs(Badge, { variant: isMyTurn && !isGameOver ? "default" : "outline", children: [_jsx(Icon, { icon: Fire02Icon, size: 14 }), isGameOver ? "Done" : isMyTurn ? "Your fire" : "Their fire"] }), _jsxs(Badge, { variant: "outline", children: [myLabel, ": ", view.myShipsRemaining, " afloat / ", mySunk.length, " sunk"] }), _jsxs(Badge, { variant: "outline", children: [opponentLabel, ": ", view.opponentShipsRemaining, " afloat / ", opponentSunk.length, " sunk"] }), lastShot ? (_jsxs(Badge, { variant: lastShotVariant(lastShot.result), children: [_jsx(Icon, { icon: lastShot.result === "miss" ? Cancel01Icon : lastShot.result === "sunk" ? SparklesIcon : Fire02Icon, size: 14 }), describeShot(lastShot, view.myPlayerID)] })) : null] })] }));
}
function lastShotVariant(result) {
    if (result === "miss")
        return "outline";
    if (result === "sunk")
        return "success";
    return "destructive";
}
function describeShot(shot, myID) {
    const who = shot.by === myID ? "You" : "Opponent";
    const loc = coordName(shot.at);
    if (shot.result === "miss")
        return `${who} missed at ${loc}`;
    if (shot.result === "sunk") {
        const shipName = shot.sunkShipID ? SHIP_NAMES[shot.sunkShipID] : "a ship";
        return `${who} sank ${shipName}`;
    }
    return `${who} hit at ${loc}`;
}
function coordName({ row, col }) {
    return `${"ABCDEFGHIJ"[col]}${row + 1}`;
}
function renderDefensiveCell(view, coord) {
    const cell = view.myBoard[coord.row]?.[coord.col];
    const shipID = cell?.ship ?? null;
    const shot = view.opponentShotsAtMe.find((s) => s.at.row === coord.row && s.at.col === coord.col);
    if (shot) {
        if (shot.result === "miss") {
            return { tone: "miss", content: _jsx(MissDot, {}), disabled: true, title: "miss" };
        }
        return {
            tone: shot.result === "sunk" ? "sunk" : "hit",
            content: _jsx(HitDot, { sunk: shot.result === "sunk" }),
            disabled: true,
            title: shot.result === "sunk" ? "ship sunk" : "hit",
        };
    }
    if (shipID !== null) {
        return { tone: "ship", disabled: true, title: SHIP_NAMES[shipID] };
    }
    return { tone: "sea", disabled: true };
}
function renderTargetCell(view, coord, sunkMap) {
    const shot = view.myShotsAtOpponent.find((s) => s.at.row === coord.row && s.at.col === coord.col);
    if (shot) {
        if (shot.result === "miss") {
            return { tone: "miss", content: _jsx(MissDot, {}), disabled: true, title: "miss" };
        }
        const isSunk = shot.result === "sunk" || sunkMap.has(`${coord.row}:${coord.col}`);
        return {
            tone: isSunk ? "sunk" : "hit",
            content: _jsx(HitDot, { sunk: isSunk }),
            disabled: true,
            title: isSunk ? "sunk" : "hit",
        };
    }
    if (sunkMap.has(`${coord.row}:${coord.col}`)) {
        return {
            tone: "sunk",
            content: _jsx(HitDot, { sunk: true }),
            disabled: true,
            title: "revealed (sunk)",
        };
    }
    return { tone: "sea", title: "fire here" };
}
function MissDot() {
    return _jsx("span", { className: "mx-auto block h-2 w-2 rounded-full bg-slate-500" });
}
function HitDot({ sunk }) {
    return _jsx("span", { className: cn("mx-auto block h-2.5 w-2.5 rounded-full", sunk ? "bg-white" : "bg-white/90") });
}
