import * as React from "react";

import {
  type ModernArtPlayerID,
  type ModernArtPlayerView,
} from "@openturn/example-modern-art-game";

import { modernArtBindings } from "../bindings";
import { ModernArtTable } from "./ModernArtTable";

const { OpenturnProvider, createLocalMatch, useMatch } = modernArtBindings;

export function LocalPreview() {
  const matchStore = React.useMemo(
    () => createLocalMatch({ match: { players: ["0", "1", "2"] } }),
    [],
  );
  return (
    <OpenturnProvider match={matchStore}>
      <LocalInner />
    </OpenturnProvider>
  );
}

function LocalInner() {
  const match = useMatch();
  const [camera, setCamera] = React.useState<ModernArtPlayerID>("0");
  if (match.mode !== "local") return null;
  const view = match.state.getPlayerView(camera) as ModernArtPlayerView;

  return (
    <>
      <div className="preview-bar">
        <span>PREVIEW MODE</span>
        {view.seatOrder.map((id) => (
          <button
            className={camera === id ? "active" : ""}
            key={id}
            onClick={() => setCamera(id)}
            type="button"
          >
            Seat {Number.parseInt(id, 10) + 1}
          </button>
        ))}
      </div>
      <ModernArtTable
        onFixedPrice={(amount) => void match.state.dispatch.setFixedPrice?.(camera, { amount })}
        onHiddenBid={(amount) => void match.state.dispatch.submitHiddenBid?.(camera, { amount })}
        onOfferDouble={(cardID) => void match.state.dispatch.offerDouble?.(camera, { cardID })}
        onOneOffer={(amount) => void match.state.dispatch.submitOneOffer?.(camera, { amount })}
        onOpenPass={() => void match.state.dispatch.passOpenBid?.(camera, undefined)}
        onOpenRaise={(amount) => void match.state.dispatch.raiseOpenBid?.(camera, { amount })}
        onPlayPainting={(cardID) => void match.state.dispatch.playPainting?.(camera, { cardID })}
        onRespondFixed={(accept) => void match.state.dispatch.respondFixedPrice?.(camera, { accept })}
        view={view}
      />
    </>
  );
}
