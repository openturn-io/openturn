import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import * as React from "react";
import { BOARD_SIZE } from "@openturn/example-battleship-game";
import { cn } from "../lib/utils";
const COLUMN_LETTERS = "ABCDEFGHIJ";
const toneClass = {
    sea: "bg-sea-foam/70 hover:bg-sea-foam border-sea-shallow/30",
    ship: "bg-ship-hull text-white border-ship-hull-edge",
    hit: "bg-hit/90 text-white border-hit",
    miss: "bg-miss border-slate-300",
    sunk: "bg-sunk text-white border-sunk-edge",
    ghost: "bg-sea-shallow/40 border-sea-mid/50",
    "ghost-bad": "bg-rose-300/60 border-rose-500/70",
};
export function BoardGrid({ label, renderCell, overlay, onCellClick, onCellHover, onCellDragOver, onCellDrop, disabled, className, }) {
    const overlayLookup = React.useMemo(() => {
        if (!overlay)
            return null;
        const set = new Set();
        for (const { row, col } of overlay.cells) {
            set.add(`${row}:${col}`);
        }
        return { set, tone: overlay.tone };
    }, [overlay]);
    return (_jsxs("div", { className: cn("inline-flex flex-col gap-1 rounded-2xl border border-sea-mid/10 bg-white/80 p-3 shadow-[0_10px_30px_rgba(15,23,42,0.06)] backdrop-blur", className), role: "group", "aria-label": label, children: [_jsxs("div", { className: "grid gap-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400", style: { gridTemplateColumns: `20px repeat(${BOARD_SIZE}, minmax(0, 1fr))` }, children: [_jsx("span", {}), Array.from({ length: BOARD_SIZE }, (_, i) => (_jsx("span", { className: "flex items-end justify-center", children: COLUMN_LETTERS[i] }, `col-${i}`)))] }), _jsx("div", { className: "grid gap-1", style: { gridTemplateColumns: `20px repeat(${BOARD_SIZE}, minmax(0, 1fr))` }, children: Array.from({ length: BOARD_SIZE }, (_, row) => (_jsxs(React.Fragment, { children: [_jsx("span", { className: "flex items-center justify-center text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400", children: row + 1 }), Array.from({ length: BOARD_SIZE }, (_, col) => {
                            const overlayTone = overlayLookup?.set.has(`${row}:${col}`) ? overlayLookup.tone : undefined;
                            const cell = renderCell({ row, col }, overlayTone);
                            const cellTone = overlayTone ?? cell.tone;
                            const isInteractive = !disabled &&
                                !cell.disabled &&
                                (Boolean(onCellClick) || Boolean(onCellDragOver) || Boolean(onCellDrop));
                            return (_jsx("button", { type: "button", role: "gridcell", "aria-label": `${COLUMN_LETTERS[col]}${row + 1}${cell.title ? ` — ${cell.title}` : ""}`, disabled: !isInteractive && cell.disabled !== false, onClick: () => onCellClick?.({ row, col }), onMouseEnter: () => onCellHover?.({ row, col }), onMouseLeave: () => onCellHover?.(null), onDragOver: onCellDragOver
                                    ? (event) => onCellDragOver({ row, col }, event)
                                    : undefined, onDrop: onCellDrop ? (event) => onCellDrop({ row, col }, event) : undefined, className: cn("relative aspect-square rounded-md border text-xs font-semibold transition duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sea-mid/60 focus-visible:z-10", isInteractive ? "cursor-pointer" : "cursor-default", toneClass[cellTone], cell.pulse ? "animate-[shot-splash_360ms_cubic-bezier(0.2,0.82,0.2,1)]" : ""), children: cell.content ?? null }, `${row}-${col}`));
                        })] }, `row-${row}`))) })] }));
}
