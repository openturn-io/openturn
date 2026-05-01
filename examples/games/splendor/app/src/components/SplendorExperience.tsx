import * as React from "react";
import { MotionConfig } from "framer-motion";

import {
  splendor,
  type SplendorPlayerID,
  type SplendorPlayerView,
} from "@openturn/example-splendor-game";
import { type HostedRoomState } from "@openturn/react";
import { LobbyWithBots } from "@openturn/lobby/react";

import { splendorBindings } from "../bindings";
import { GameOverDialog } from "./GameOverDialog";
import { Table } from "./Table";

const { OpenturnProvider, useRoom } = splendorBindings;

type HostedMatch = NonNullable<HostedRoomState<typeof splendor>["game"]>;

export function SplendorExperience() {
  return (
    <MotionConfig reducedMotion="user">
      <OpenturnProvider>
        <SplendorRoom />
      </OpenturnProvider>
    </MotionConfig>
  );
}

function SplendorRoom() {
  const room = useRoom();

  let body: React.ReactNode;
  if (room.phase === "missing_backend") {
    body = (
      <section className="grid h-full min-h-0 w-full place-items-center px-6 py-6">
        <div className="parchment max-w-[48ch] rounded-2xl px-6 py-5 text-center">
          <p className="m-0 text-sm text-stone-700">
            Hosted backend config is missing. Open this deployment through openturn-cloud{" "}
            <code className="rounded bg-stone-200 px-1 py-0.5 text-xs">/play/&lt;deployment&gt;</code>.
          </p>
        </div>
      </section>
    );
  } else if (room.lobby !== null) {
    body = (
      <section className="grid h-full min-h-0 w-full place-items-center px-6 py-6">
        <LobbyWithBots lobby={room.lobby} title="Splendor" />
      </section>
    );
  } else if (room.game !== null) {
    body = <SplendorHostedGame match={room.game} />;
  } else {
    body = (
      <section className="grid h-full min-h-0 w-full place-items-center px-6 py-6">
        <p className="text-sm text-amber-100/70">
          {room.phase === "connecting" ? "Connecting to the room…" : "Loading…"}
        </p>
      </section>
    );
  }

  return (
    <main className="relative z-10 h-full min-h-0 w-full overflow-hidden">
      <section className="h-full min-h-0 w-full animate-[stage-rise_420ms_cubic-bezier(0.2,0.8,0.2,1)]">
        {body}
      </section>
    </main>
  );
}

function SplendorHostedGame({ match }: { match: HostedMatch }) {
  const snapshot = match.snapshot;
  const view = snapshot?.G as SplendorPlayerView | null | undefined;
  const [dialogDismissed, setDialogDismissed] = React.useState(false);
  const result = match.result;

  React.useEffect(() => {
    if (result === null) setDialogDismissed(false);
  }, [result]);

  if (view === null || view === undefined) {
    return (
      <section className="grid h-full min-h-0 w-full place-items-center px-6 py-6">
        <p className="text-sm text-amber-100/70">Syncing authoritative snapshot…</p>
      </section>
    );
  }

  const winner = view.winner ?? result?.winner ?? null;
  const isGameOver = winner !== null;
  const me = view.myPlayerID;
  const meLabel = me === null ? "Spectator" : `Merchant ${Number.parseInt(me, 10) + 1}`;
  const winnerLabel = winner === null ? "Nobody" : `Merchant ${Number.parseInt(winner, 10) + 1}`;
  const myScore = me === null ? 0 : view.players[me as SplendorPlayerID]?.score ?? 0;
  const winnerScore = winner === null ? 0 : view.players[winner as SplendorPlayerID]?.score ?? 0;

  return (
    <section className="flex h-full min-h-0 w-full flex-col">
      <Table
        view={view}
        onTakeThree={(colors) => match.dispatch.takeThreeGems({ colors })}
        onTakeTwo={(color) => match.dispatch.takeTwoGems({ color })}
        onReserveMarket={(tier, slot) => match.dispatch.reserveCard({ source: "market", tier, slot })}
        onReserveDeck={(tier) => match.dispatch.reserveCard({ source: "deck", tier })}
        onBuyMarket={(tier, slot) => match.dispatch.buyCard({ source: "market", tier, slot })}
        onBuyReserved={(cardID) => match.dispatch.buyCard({ source: "reserved", cardID })}
        onDiscard={(chips) => match.dispatch.discardChips({ chips })}
      />
      <GameOverDialog
        open={isGameOver && !dialogDismissed}
        isWinner={winner === me}
        myLabel={meLabel}
        winnerLabel={winnerLabel}
        myScore={myScore}
        winnerScore={winnerScore}
        onClose={() => setDialogDismissed(true)}
      />
    </section>
  );
}
