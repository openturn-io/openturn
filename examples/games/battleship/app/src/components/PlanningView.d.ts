import { type BattleshipPlayerView, type Orientation, type ShipID } from "@openturn/example-battleship-game";
interface PlanningViewProps {
    view: BattleshipPlayerView;
    canPlace: boolean;
    onPlaceShip: (args: {
        shipID: ShipID;
        row: number;
        col: number;
        orientation: Orientation;
    }) => void;
    onUnplaceShip: (args: {
        shipID: ShipID;
    }) => void;
    onReady: () => void;
}
export declare function PlanningView({ view, canPlace, onPlaceShip, onUnplaceShip, onReady, }: PlanningViewProps): import("react/jsx-runtime").JSX.Element;
export {};
