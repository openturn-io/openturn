import * as React from "react";

import {
  SHIP_IDS,
  SHIP_LENGTHS,
  SHIP_NAMES,
  type FleetMap,
  type Orientation,
  type ShipID,
} from "@openturn/example-battleship-game";
import { AnchorIcon } from "@hugeicons/core-free-icons";

import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Icon } from "./ui/icon";
import { cn } from "../lib/utils";

export interface ShipTrayProps {
  fleet: FleetMap;
  selectedShipID: ShipID | null;
  orientation: Orientation;
  onSelect: (shipID: ShipID | null) => void;
  onRotate: () => void;
  onDragStart: (shipID: ShipID) => void;
  onDragEnd: () => void;
  onUnplace: (shipID: ShipID) => void;
  onRandomize?: () => void;
  disabled?: boolean;
}

export function ShipTray({
  fleet,
  selectedShipID,
  orientation,
  onSelect,
  onRotate,
  onDragStart,
  onDragEnd,
  onUnplace,
  onRandomize,
  disabled,
}: ShipTrayProps) {
  return (
    <div className="flex w-full flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
          Fleet roster
        </span>
        <div className="flex items-center gap-2">
          <Badge variant="outline">
            {orientation === "horizontal" ? "→ Horizontal" : "↓ Vertical"}
          </Badge>
          <Button size="sm" variant="outline" onClick={onRotate} disabled={disabled}>
            Rotate (R)
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {SHIP_IDS.map((shipID) => {
          const placed = fleet[shipID] !== undefined;
          const selected = selectedShipID === shipID;
          return (
            <ShipCard
              key={shipID}
              shipID={shipID}
              placed={placed}
              selected={selected}
              orientation={orientation}
              disabled={disabled === true}
              onSelect={() => onSelect(selected ? null : shipID)}
              onDragStart={() => onDragStart(shipID)}
              onDragEnd={onDragEnd}
              onUnplace={() => onUnplace(shipID)}
            />
          );
        })}
      </div>
      {onRandomize ? (
        <Button size="sm" variant="secondary" onClick={onRandomize} disabled={disabled}>
          Randomize unplaced ships
        </Button>
      ) : null}
    </div>
  );
}

interface ShipCardProps {
  shipID: ShipID;
  placed: boolean;
  selected: boolean;
  orientation: Orientation;
  disabled: boolean;
  onSelect: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onUnplace: () => void;
}

function ShipCard({
  shipID,
  placed,
  selected,
  orientation,
  disabled,
  onSelect,
  onDragStart,
  onDragEnd,
  onUnplace,
}: ShipCardProps) {
  const length = SHIP_LENGTHS[shipID];
  const draggable = !placed && !disabled;
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 rounded-lg border bg-white/80 px-3 py-2 shadow-sm transition",
        placed
          ? "border-emerald-200 bg-emerald-50/80"
          : selected
            ? "border-sea-mid bg-sea-foam/70 ring-2 ring-sea-mid/30"
            : "border-border hover:border-sea-mid/40",
      )}
    >
      <button
        type="button"
        draggable={draggable}
        onDragStart={() => draggable && onDragStart()}
        onDragEnd={onDragEnd}
        onClick={onSelect}
        disabled={placed || disabled}
        className="flex flex-1 items-center gap-2 text-left disabled:cursor-default"
        aria-pressed={selected}
      >
        <Icon icon={AnchorIcon} size={16} className="text-sea-mid" />
        <div className="flex flex-col">
          <span className="text-sm font-semibold text-slate-800">{SHIP_NAMES[shipID]}</span>
          <span className="text-[11px] text-slate-500">{length} cells</span>
        </div>
        <div className={cn("ml-auto flex gap-0.5", orientation === "vertical" ? "flex-col" : "flex-row")}>
          {Array.from({ length }, (_, i) => (
            <span
              key={i}
              className={cn(
                "h-2.5 w-2.5 rounded-sm",
                placed ? "bg-emerald-500/80" : "bg-ship-hull/80",
              )}
            />
          ))}
        </div>
      </button>
      {placed ? (
        <Button size="sm" variant="ghost" onClick={onUnplace} disabled={disabled}>
          Remove
        </Button>
      ) : null}
    </div>
  );
}
