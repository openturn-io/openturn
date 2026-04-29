import { type FleetMap, type Orientation, type ShipID } from "@openturn/example-battleship-game";
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
export declare function ShipTray({ fleet, selectedShipID, orientation, onSelect, onRotate, onDragStart, onDragEnd, onUnplace, onRandomize, disabled, }: ShipTrayProps): import("react/jsx-runtime").JSX.Element;
