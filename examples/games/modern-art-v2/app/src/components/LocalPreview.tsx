import * as React from "react";

import { type ModernArtPlayerID, type ModernArtPlayerView } from "@openturn/example-modern-art-v2-game";

import { modernArtBindings } from "../bindings";
import { GameOverDialog } from "./GameOverDialog";
import { Gallery } from "./Gallery";

const { OpenturnProvider, useMatch, createLocalMatch } = modernArtBindings;

// Local-mode preview — no lobby, no websocket. All seats sit at this browser
// tab; the toolbar at the top toggles which seat is the camera. Useful for dev
// / screenshot verification of the gallery layout. Wired only when the URL
// includes `?preview=local`. Uses the shared multiplayer bindings with an
// explicit `match` prop on OpenturnProvider — which forces local mode for just
// this subtree without spawning a second bindings instance.
export function LocalPreview(): React.ReactNode {
  const matchStore = React.useMemo(
    () => createLocalMatch({ match: { players: ["0", "1", "2"] } }),
    [],
  );
  return (
    <OpenturnProvider match={matchStore}>
      <Inner />
    </OpenturnProvider>
  );
}

function Inner(): React.ReactNode {
  const m = useMatch();
  const [camera, setCamera] = React.useState<ModernArtPlayerID>("0");
  if (m.mode !== "local") return null;
  const view = m.state.getPlayerView(camera) as ModernArtPlayerView;
  const winner = view.winner;
  const isWinner = winner === camera;
  const meLabel = `Collector ${Number.parseInt(camera, 10) + 1}`;
  const winnerLabel = winner === null ? "Nobody" : `Collector ${Number.parseInt(winner, 10) + 1}`;
  const myMoney = view.players[camera]?.money ?? 0;
  const winnerMoney = winner === null ? 0 : view.players[winner as ModernArtPlayerID]?.money ?? 0;
  const [dismissed, setDismissed] = React.useState(false);
  React.useEffect(() => {
    if (winner === null) setDismissed(false);
  }, [winner]);

  return (
    <main className="relative z-10 flex h-full min-h-0 w-full flex-col overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-1.5 text-xs text-[var(--color-gold-bright)]/80">
        <span className="rounded-full bg-[var(--color-gold-leaf)]/20 px-2 py-0.5 ring-1 ring-inset ring-[var(--color-gold-bright)]/40">
          PREVIEW — local, all seats here
        </span>
        <span>Camera:</span>
        {(["0", "1", "2"] as const).map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => setCamera(id)}
            className={
              camera === id
                ? "rounded-md bg-[var(--color-gold-bright)] px-2 py-0.5 text-[var(--color-frame-dark)]"
                : "rounded-md border border-white/20 bg-white/10 px-2 py-0.5 text-parchment hover:bg-white/15 cursor-pointer"
            }
          >
            Collector {Number.parseInt(id, 10) + 1}
          </button>
        ))}
      </div>
      <section className="h-full min-h-0 w-full">
        <Gallery
          view={view}
          myID={camera}
          onPlaceBid={(amount: number) => void m.state.dispatch.placeBid(camera, { amount })}
          onPassBid={() => void m.state.dispatch.passBid(camera, {})}
          onSealBid={(amount: number) => void m.state.dispatch.sealBid(camera, { amount })}
          onSetFixedPrice={(price: number) => void m.state.dispatch.setFixedPrice(camera, { price })}
          onBuyFixed={() => void m.state.dispatch.buyFixed(camera, {})}
          onDeclineFixed={() => void m.state.dispatch.declineFixed(camera, {})}
          onStartAuction={(paintingId: string, doublePaintingId?: string) =>
            void m.state.dispatch.startAuction(
              camera,
              doublePaintingId === undefined ? { paintingId } : { paintingId, doublePaintingId },
            )
          }
          onSkipTurn={() => void m.state.dispatch.skipTurn(camera, {})}
        />
        <GameOverDialog
          open={winner !== null && !dismissed}
          isWinner={isWinner}
          myLabel={meLabel}
          winnerLabel={winnerLabel}
          myMoney={myMoney}
          winnerMoney={winnerMoney}
          onClose={() => setDismissed(true)}
        />
      </section>
    </main>
  );
}
