import * as React from "react";

import {
  battleship,
  type BattleshipPlayerView,
} from "@openturn/example-battleship-game";
import { createOpenturnBindings, Lobby, type HostedRoomState } from "@openturn/react";

import { BattleView } from "./BattleView";
import { GameOverDialog } from "./GameOverDialog";
import { PlanningView } from "./PlanningView";

const { OpenturnProvider, useRoom } = createOpenturnBindings(battleship, {
  runtime: "multiplayer",
});

type HostedMatch = NonNullable<HostedRoomState<typeof battleship>["game"]>;

export function BattleshipExperience() {
  return (
    <OpenturnProvider>
      <BattleshipRoom />
    </OpenturnProvider>
  );
}

function BattleshipRoom() {
  const room = useRoom();

  let body: React.ReactNode;
  if (room.phase === "missing_backend") {
    body = (
      <section className="grid h-full min-h-0 w-full place-items-center px-6 py-6">
        <div className="max-w-[48ch] rounded-2xl border border-border bg-white/80 p-6 text-center shadow-sm">
          <p className="m-0 text-sm text-slate-600">
            Hosted backend config is missing. Open this deployment through openturn-cloud{" "}
            <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">/play/&lt;deployment&gt;</code>.
          </p>
        </div>
      </section>
    );
  } else if (room.lobby !== null) {
    body = (
      <section className="grid h-full min-h-0 w-full place-items-center px-6 py-6">
        <Lobby lobby={room.lobby} title="Battleship" />
      </section>
    );
  } else if (room.game !== null) {
    body = <BattleshipHostedGame match={room.game} />;
  } else {
    body = (
      <section className="grid h-full min-h-0 w-full place-items-center px-6 py-6">
        <p className="text-sm text-slate-500">
          {room.phase === "connecting" ? "Connecting to the room…" : "Loading…"}
        </p>
      </section>
    );
  }

  return (
    <main className="h-full min-h-0 w-full overflow-hidden">
      <section className="h-full min-h-0 w-full animate-[stage-rise_420ms_cubic-bezier(0.2,0.8,0.2,1)]">
        {body}
      </section>
    </main>
  );
}

function BattleshipHostedGame({
  match: hostedMatch,
}: {
  match: HostedMatch;
}) {
  const snapshot = hostedMatch.snapshot;
  const view = snapshot?.G as BattleshipPlayerView | null | undefined;
  const playerID = hostedMatch.playerID;
  const [dialogDismissed, setDialogDismissed] = React.useState(false);
  const result = hostedMatch.result;

  const playerLabel =
    playerID === "0" ? "Admiral 1" : playerID === "1" ? "Admiral 2" : "Spectator";

  React.useEffect(() => {
    if (result === null) {
      setDialogDismissed(false);
    }
  }, [result]);

  if (view === null || view === undefined) {
    return (
      <section className="grid h-full min-h-0 w-full place-items-center px-6 py-6">
        <p className="text-sm text-slate-500">Syncing authoritative snapshot…</p>
      </section>
    );
  }

  const isGameOver = view.phase === "gameOver" || result !== null;
  const isWinner = view.winner === view.myPlayerID || result?.winner === view.myPlayerID;
  const opponentLabel = view.opponentID === "0" ? "Admiral 1" : "Admiral 2";

  const canPlace = !view.myReady && view.phase === "planning" && hostedMatch.canDispatch.placeShip;
  const canFire =
    !isGameOver &&
    view.phase === "battle" &&
    view.currentTurn === view.myPlayerID &&
    hostedMatch.canDispatch.fire;

  return (
    <section className="flex h-full min-h-0 w-full flex-col px-4 py-3 lg:px-6">
      {view.phase === "planning" ? (
        <PlanningView
          view={view}
          canPlace={canPlace}
          onPlaceShip={(args) => hostedMatch.dispatch.placeShip(args)}
          onUnplaceShip={(args) => hostedMatch.dispatch.unplaceShip(args)}
          onReady={() => hostedMatch.dispatch.ready(undefined)}
        />
      ) : (
        <BattleView
          view={view}
          canFire={canFire}
          onFire={(args) => hostedMatch.dispatch.fire(args)}
          isGameOver={isGameOver}
        />
      )}
      <GameOverDialog
        open={isGameOver && !dialogDismissed}
        isWinner={Boolean(isWinner)}
        myLabel={playerLabel}
        opponentLabel={opponentLabel}
        onClose={() => setDialogDismissed(true)}
      />
    </section>
  );
}
