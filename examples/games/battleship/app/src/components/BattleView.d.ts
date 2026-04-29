import { type BattleshipPlayerView } from "@openturn/example-battleship-game";
interface BattleViewProps {
    view: BattleshipPlayerView;
    canFire: boolean;
    onFire: (args: {
        row: number;
        col: number;
    }) => void;
    isGameOver: boolean;
}
export declare function BattleView({ view, canFire, onFire, isGameOver }: BattleViewProps): import("react/jsx-runtime").JSX.Element;
export {};
