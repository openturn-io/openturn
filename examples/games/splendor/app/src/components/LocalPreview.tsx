import * as React from "react";

import {
  splendor,
  type ChipColor,
  type GemColor,
  type SplendorPlayerID,
  type SplendorPlayerView,
  type Tier,
} from "@openturn/example-splendor-game";

import { splendorBindings } from "../bindings";
import { GameOverDialog } from "./GameOverDialog";
import { Table } from "./Table";

const { OpenturnProvider, useMatch, createLocalMatch } = splendorBindings;

// Local-mode preview — no lobby, no websocket. Both seats sit at this browser
// tab; the toolbar at the top toggles which seat is the camera. Useful for
// dev / screenshot verification of the table layout. Wired only when the URL
// includes `?preview=local`. Uses the shared multiplayer bindings with an
// explicit `match` prop on OpenturnProvider — which forces local mode for
// just this subtree without spawning a second bindings instance (which the
// per-game cache in `createOpenturnBindings` would silently swallow).
export function LocalPreview() {
  const matchStore = React.useMemo(
    () => createLocalMatch({ match: { players: ["0", "1"] } }),
    [],
  );
  return (
    <OpenturnProvider match={matchStore}>
      <Inner />
    </OpenturnProvider>
  );
}

function Inner() {
  const m = useMatch();
  const [camera, setCamera] = React.useState<SplendorPlayerID>("0");
  if (m.mode !== "local") return null;
  const view = m.state.getPlayerView(camera) as SplendorPlayerView;
  const winner = view.winner;
  const isWinner = winner === camera;
  const meLabel = `Merchant ${Number.parseInt(camera, 10) + 1}`;
  const winnerLabel = winner === null ? "Nobody" : `Merchant ${Number.parseInt(winner, 10) + 1}`;
  const myScore = view.players[camera]?.score ?? 0;
  const winnerScore = winner === null ? 0 : view.players[winner as SplendorPlayerID]?.score ?? 0;
  const [dismissed, setDismissed] = React.useState(false);
  React.useEffect(() => {
    if (winner === null) setDismissed(false);
  }, [winner]);

  return (
    <main className="relative z-10 flex h-full min-h-0 w-full flex-col overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-1.5 text-xs text-amber-100/80">
        <span className="rounded-full bg-amber-300/20 px-2 py-0.5 ring-1 ring-inset ring-amber-200/40">PREVIEW MODE — local, both seats here</span>
        <span>Camera:</span>
        {(["0", "1"] as const).map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => setCamera(id)}
            className={
              camera === id
                ? "rounded-md bg-amber-300 px-2 py-0.5 text-stone-900"
                : "rounded-md border border-white/20 bg-white/10 px-2 py-0.5 text-amber-100 hover:bg-white/20 cursor-pointer"
            }
          >
            Merchant {Number.parseInt(id, 10) + 1}
          </button>
        ))}
      </div>
      <section className="h-full min-h-0 w-full">
        <Table
          view={view}
          onTakeThree={(colors: readonly GemColor[]) =>
            void m.state.dispatch.takeThreeGems(camera, { colors })
          }
          onTakeTwo={(color: GemColor) =>
            void m.state.dispatch.takeTwoGems(camera, { color })
          }
          onReserveMarket={(tier: Tier, slot: number) =>
            void m.state.dispatch.reserveCard(camera, { source: "market", tier, slot })
          }
          onReserveDeck={(tier: Tier) =>
            void m.state.dispatch.reserveCard(camera, { source: "deck", tier })
          }
          onBuyMarket={(tier: Tier, slot: number) =>
            void m.state.dispatch.buyCard(camera, { source: "market", tier, slot })
          }
          onBuyReserved={(cardID: string) =>
            void m.state.dispatch.buyCard(camera, { source: "reserved", cardID })
          }
          onDiscard={(chips: Partial<Record<ChipColor, number>>) =>
            void m.state.dispatch.discardChips(camera, { chips })
          }
        />
        <GameOverDialog
          open={winner !== null && !dismissed}
          isWinner={isWinner}
          myLabel={meLabel}
          winnerLabel={winnerLabel}
          myScore={myScore}
          winnerScore={winnerScore}
          onClose={() => setDismissed(true)}
        />
      </section>
    </main>
  );
}

void splendor;
