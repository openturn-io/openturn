import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { SHIP_IDS, SHIP_LENGTHS, SHIP_NAMES, } from "@openturn/example-battleship-game";
import { AnchorIcon } from "@hugeicons/core-free-icons";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Icon } from "./ui/icon";
import { cn } from "../lib/utils";
export function ShipTray({ fleet, selectedShipID, orientation, onSelect, onRotate, onDragStart, onDragEnd, onUnplace, onRandomize, disabled, }) {
    return (_jsxs("div", { className: "flex w-full flex-col gap-3", children: [_jsxs("div", { className: "flex items-center justify-between gap-2", children: [_jsx("span", { className: "text-xs font-semibold uppercase tracking-[0.14em] text-slate-500", children: "Fleet roster" }), _jsxs("div", { className: "flex items-center gap-2", children: [_jsx(Badge, { variant: "outline", children: orientation === "horizontal" ? "→ Horizontal" : "↓ Vertical" }), _jsx(Button, { size: "sm", variant: "outline", onClick: onRotate, disabled: disabled, children: "Rotate (R)" })] })] }), _jsx("div", { className: "grid grid-cols-1 gap-2 sm:grid-cols-2", children: SHIP_IDS.map((shipID) => {
                    const placed = fleet[shipID] !== undefined;
                    const selected = selectedShipID === shipID;
                    return (_jsx(ShipCard, { shipID: shipID, placed: placed, selected: selected, orientation: orientation, disabled: disabled === true, onSelect: () => onSelect(selected ? null : shipID), onDragStart: () => onDragStart(shipID), onDragEnd: onDragEnd, onUnplace: () => onUnplace(shipID) }, shipID));
                }) }), onRandomize ? (_jsx(Button, { size: "sm", variant: "secondary", onClick: onRandomize, disabled: disabled, children: "Randomize unplaced ships" })) : null] }));
}
function ShipCard({ shipID, placed, selected, orientation, disabled, onSelect, onDragStart, onDragEnd, onUnplace, }) {
    const length = SHIP_LENGTHS[shipID];
    const draggable = !placed && !disabled;
    return (_jsxs("div", { className: cn("flex items-center justify-between gap-3 rounded-lg border bg-white/80 px-3 py-2 shadow-sm transition", placed
            ? "border-emerald-200 bg-emerald-50/80"
            : selected
                ? "border-sea-mid bg-sea-foam/70 ring-2 ring-sea-mid/30"
                : "border-border hover:border-sea-mid/40"), children: [_jsxs("button", { type: "button", draggable: draggable, onDragStart: () => draggable && onDragStart(), onDragEnd: onDragEnd, onClick: onSelect, disabled: placed || disabled, className: "flex flex-1 items-center gap-2 text-left disabled:cursor-default", "aria-pressed": selected, children: [_jsx(Icon, { icon: AnchorIcon, size: 16, className: "text-sea-mid" }), _jsxs("div", { className: "flex flex-col", children: [_jsx("span", { className: "text-sm font-semibold text-slate-800", children: SHIP_NAMES[shipID] }), _jsxs("span", { className: "text-[11px] text-slate-500", children: [length, " cells"] })] }), _jsx("div", { className: cn("ml-auto flex gap-0.5", orientation === "vertical" ? "flex-col" : "flex-row"), children: Array.from({ length }, (_, i) => (_jsx("span", { className: cn("h-2.5 w-2.5 rounded-sm", placed ? "bg-emerald-500/80" : "bg-ship-hull/80") }, i))) })] }), placed ? (_jsx(Button, { size: "sm", variant: "ghost", onClick: onUnplace, disabled: disabled, children: "Remove" })) : null] }));
}
