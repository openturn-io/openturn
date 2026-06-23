import * as React from "react";
import { MotionConfig } from "framer-motion";

import { modernArt, type ModernArtPlayerID, type ModernArtPlayerView } from "@openturn/example-modern-art-v2-game";
import { type HostedRoomState } from "@openturn/react";
import { LobbyWithBots } from "@openturn/lobby/react";

import { modernArtBindings } from "../bindings";
import { GameOverDialog } from "./GameOverDialog";
import { Gallery } from "./Gallery";

const { OpenturnProvider, useRoom } = modernArtBindings;

type HostedMatch = NonNullable<HostedRoomState<typeof modernArt>["game"]>;

export function ModernArtExperience(): React.ReactNode {
  return (
    <MotionConfig reducedMotion="user">
      <OpenturnProvider>
        <ModernArtRoom />
      </OpenturnProvider>
    </MotionConfig>
  );
}

function ModernArtRoom(): React.ReactNode {
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
      <section className="h-full min-h-0 w-full overflow-y-auto">
        <div className="flex min-h-full w-full items-center justify-center px-6 py-6">
          <LobbyWithBots lobby={room.lobby} title="Modern Art" configUI="auto" />
        </div>
      </section>
    );
  } else if (room.game !== null) {
    body = <ModernArtHostedGame match={room.game} />;
  } else {
    body = (
      <section className="grid h-full min-h-0 w-full place-items-center px-6 py-6">
        <p className="text-sm text-[var(--color-gold-bright)]/70">
          {room.phase === "connecting" ? "Connecting to the gallery…" : "Loading…"}
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

function ModernArtHostedGame({ match }: { match: HostedMatch }): React.ReactNode {
  const snapshot = match.snapshot;
  const view = snapshot?.G as ModernArtPlayerView | null | undefined;
  const [dialogDismissed, setDialogDismissed] = React.useState(false);
  const result = match.result;

  React.useEffect(() => {
    if (result === null) setDialogDismissed(false);
  }, [result]);

  if (view === null || view === undefined) {
    return (
      <section className="grid h-full min-h-0 w-full place-items-center px-6 py-6">
        <p className="text-sm text-[var(--color-gold-bright)]/70">Syncing authoritative snapshot…</p>
      </section>
    );
  }

  const winner = view.winner ?? result?.winner ?? null;
  const isGameOver = winner !== null;
  const me = view.myPlayerID;
  const meLabel = me === null ? "Spectator" : `Collector ${Number.parseInt(me, 10) + 1}`;
  const winnerLabel = winner === null ? "Nobody" : `Collector ${Number.parseInt(winner, 10) + 1}`;
  const myMoney = me === null ? 0 : view.players[me as ModernArtPlayerID]?.money ?? 0;
  const winnerMoney = winner === null ? 0 : view.players[winner as ModernArtPlayerID]?.money ?? 0;

  return (
    <section className="flex h-full min-h-0 w-full flex-col">
      <Gallery
        view={view}
        myID={me}
        onPlaceBid={(amount) => match.dispatch.placeBid({ amount })}
        onPassBid={() => match.dispatch.passBid({})}
        onSealBid={(amount) => match.dispatch.sealBid({ amount })}
        onSetFixedPrice={(price) => match.dispatch.setFixedPrice({ price })}
        onBuyFixed={() => match.dispatch.buyFixed({})}
        onDeclineFixed={() => match.dispatch.declineFixed({})}
        onStartAuction={(paintingId, doublePaintingId) =>
          doublePaintingId === undefined
            ? match.dispatch.startAuction({ paintingId })
            : match.dispatch.startAuction({ paintingId, doublePaintingId })
        }
        onSkipTurn={() => match.dispatch.skipTurn({})}
      />
      <GameOverDialog
        open={isGameOver && !dialogDismissed}
        isWinner={winner === me}
        myLabel={meLabel}
        winnerLabel={winnerLabel}
        myMoney={myMoney}
        winnerMoney={winnerMoney}
        onClose={() => setDialogDismissed(true)}
      />
    </section>
  );
}
