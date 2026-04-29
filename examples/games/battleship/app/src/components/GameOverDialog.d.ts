interface GameOverDialogProps {
    open: boolean;
    isWinner: boolean;
    myLabel: string;
    opponentLabel: string;
    onClose: () => void;
}
export declare function GameOverDialog({ open, isWinner, myLabel, opponentLabel, onClose, }: GameOverDialogProps): import("react/jsx-runtime").JSX.Element | null;
export {};
