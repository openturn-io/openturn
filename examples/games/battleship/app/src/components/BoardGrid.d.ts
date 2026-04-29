import * as React from "react";
import { type Coord } from "@openturn/example-battleship-game";
export type CellTone = "sea" | "ship" | "hit" | "miss" | "sunk" | "ghost" | "ghost-bad";
export interface RenderedCell {
    tone: CellTone;
    content?: React.ReactNode;
    disabled?: boolean;
    title?: string;
    pulse?: boolean;
}
export type RenderCell = (coord: Coord, overlayTone?: CellTone) => RenderedCell;
export interface BoardGridProps {
    label: string;
    renderCell: RenderCell;
    overlay?: {
        cells: readonly Coord[];
        tone: CellTone;
    } | null | undefined;
    onCellClick?: ((coord: Coord) => void) | undefined;
    onCellHover?: ((coord: Coord | null) => void) | undefined;
    onCellDragOver?: ((coord: Coord, event: React.DragEvent) => void) | undefined;
    onCellDrop?: ((coord: Coord, event: React.DragEvent) => void) | undefined;
    disabled?: boolean | undefined;
    className?: string | undefined;
    columnsLabel?: string | undefined;
}
export declare function BoardGrid({ label, renderCell, overlay, onCellClick, onCellHover, onCellDragOver, onCellDrop, disabled, className, }: BoardGridProps): import("react/jsx-runtime").JSX.Element;
