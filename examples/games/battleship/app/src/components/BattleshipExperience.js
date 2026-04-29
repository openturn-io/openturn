import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import * as React from "react";
import { battleship, } from "@openturn/example-battleship-game";
import { createOpenturnBindings, Lobby } from "@openturn/react";
import { BattleView } from "./BattleView";
import { GameOverDialog } from "./GameOverDialog";
import { PlanningView } from "./PlanningView";
const { OpenturnProvider, useRoom } = createOpenturnBindings(battleship, {
    runtime: "multiplayer",
});
export function BattleshipExperience() {
    return (_jsx(OpenturnProvider, { children: _jsx(BattleshipRoom, {}) }));
}
function BattleshipRoom() {
    const room = useRoom();
    let body;
    if (room.phase === "missing_backend") {
        body = (_jsx("section", { className: "grid h-full min-h-0 w-full place-items-center px-6 py-6", children: _jsx("div", { className: "max-w-[48ch] rounded-2xl border border-border bg-white/80 p-6 text-center shadow-sm", children: _jsxs("p", { className: "m-0 text-sm text-slate-600", children: ["Hosted backend config is missing. Open this deployment through openturn-cloud", " ", _jsx("code", { className: "rounded bg-slate-100 px-1 py-0.5 text-xs", children: "/play/<deployment>" }), "."] }) }) }));
    }
    else if (room.lobby !== null) {
        body = (_jsx("section", { className: "grid h-full min-h-0 w-full place-items-center px-6 py-6", children: _jsx(Lobby, { lobby: room.lobby, title: "Battleship" }) }));
    }
    else if (room.game !== null) {
        body = _jsx(BattleshipHostedGame, { match: room.game });
    }
    else {
        body = (_jsx("section", { className: "grid h-full min-h-0 w-full place-items-center px-6 py-6", children: _jsx("p", { className: "text-sm text-slate-500", children: room.phase === "connecting" ? "Connecting to the room…" : "Loading…" }) }));
    }
    return (_jsx("main", { className: "h-full min-h-0 w-full overflow-hidden", children: _jsx("section", { className: "h-full min-h-0 w-full animate-[stage-rise_420ms_cubic-bezier(0.2,0.8,0.2,1)]", children: body }) }));
}
function BattleshipHostedGame({ match: hostedMatch, }) {
    const snapshot = hostedMatch.snapshot;
    const view = snapshot?.G;
    const playerID = hostedMatch.playerID;
    const [dialogDismissed, setDialogDismissed] = React.useState(false);
    const result = hostedMatch.result;
    const playerLabel = playerID === "0" ? "Admiral 1" : playerID === "1" ? "Admiral 2" : "Spectator";
    React.useEffect(() => {
        if (result === null) {
            setDialogDismissed(false);
        }
    }, [result]);
    if (view === null || view === undefined) {
        return (_jsx("section", { className: "grid h-full min-h-0 w-full place-items-center px-6 py-6", children: _jsx("p", { className: "text-sm text-slate-500", children: "Syncing authoritative snapshot\u2026" }) }));
    }
    const isGameOver = view.phase === "gameOver" || result !== null;
    const isWinner = view.winner === view.myPlayerID || result?.winner === view.myPlayerID;
    const opponentLabel = view.opponentID === "0" ? "Admiral 1" : "Admiral 2";
    const canPlace = !view.myReady && view.phase === "planning" && hostedMatch.canDispatch.placeShip;
    const canFire = !isGameOver &&
        view.phase === "battle" &&
        view.currentTurn === view.myPlayerID &&
        hostedMatch.canDispatch.fire;
    return (_jsxs("section", { className: "flex h-full min-h-0 w-full flex-col px-4 py-3 lg:px-6", children: [view.phase === "planning" ? (_jsx(PlanningView, { view: view, canPlace: canPlace, onPlaceShip: (args) => hostedMatch.dispatch.placeShip(args), onUnplaceShip: (args) => hostedMatch.dispatch.unplaceShip(args), onReady: () => hostedMatch.dispatch.ready(undefined) })) : (_jsx(BattleView, { view: view, canFire: canFire, onFire: (args) => hostedMatch.dispatch.fire(args), isGameOver: isGameOver })), _jsx(GameOverDialog, { open: isGameOver && !dialogDismissed, isWinner: Boolean(isWinner), myLabel: playerLabel, opponentLabel: opponentLabel, onClose: () => setDialogDismissed(true) })] }));
}
