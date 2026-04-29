import type { Orientation, ShipID } from "@openturn/example-battleship-game";
export interface DragShipState {
    shipID: ShipID;
    orientation: Orientation;
}
export declare function useDragShip(): {
    current: DragShipState | null;
    startDrag: (state: DragShipState) => void;
    endDrag: () => void;
    rotate: () => void;
    setCurrent: import("react").Dispatch<import("react").SetStateAction<DragShipState | null>>;
};
