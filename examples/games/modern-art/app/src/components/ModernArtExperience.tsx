import * as React from "react";
import { MotionConfig } from "framer-motion";

import { LobbyWithBots } from "@openturn/lobby/react";
import { type HostedRoomState } from "@openturn/react";
import {
  modernArt,
  type ModernArtPlayerView,
} from "@openturn/example-modern-art-game";

import { modernArtBindings } from "../bindings";
import { ModernArtTable } from "./ModernArtTable";

const { OpenturnProvider, useRoom } = modernArtBindings;

type HostedMatch = NonNullable<HostedRoomState<typeof modernArt>["game"]>;

export function ModernArtExperience() {
  return (
    <MotionConfig reducedMotion="user">
      <OpenturnProvider>
        <ModernArtRoom />
      </OpenturnProvider>
    </MotionConfig>
  );
}

function ModernArtRoom() {
  const room = useRoom();

  if (room.phase === "missing_backend") {
    return (
      <main className="modern-art-shell centered">
        <div className="lobby-panel">
          <h1>Modern Art</h1>
          <p>Hosted backend config is missing.</p>
        </div>
      </main>
    );
  }

  if (room.lobby !== null) {
    return (
      <main className="lobby-shell">
        <div className="lobby-panel">
          <LobbyWithBots
            configSchema={modernArt.config}
            configUI="auto"
            lobby={room.lobby}
            title="Modern Art"
          />
        </div>
      </main>
    );
  }

  if (room.game !== null) return <HostedGame match={room.game} />;

  return (
    <main className="modern-art-shell centered">
      <p className="loading-text">{room.phase === "connecting" ? "Connecting..." : "Loading..."}</p>
    </main>
  );
}

function HostedGame({ match }: { match: HostedMatch }) {
  const view = match.snapshot?.G as ModernArtPlayerView | null | undefined;
  if (view === null || view === undefined) {
    return (
      <main className="modern-art-shell centered">
        <p className="loading-text">Syncing table...</p>
      </main>
    );
  }

  return (
    <ModernArtTable
      onFixedPrice={(amount) => match.dispatch.setFixedPrice?.({ amount })}
      onHiddenBid={(amount) => match.dispatch.submitHiddenBid?.({ amount })}
      onOfferDouble={(cardID) => match.dispatch.offerDouble?.({ cardID })}
      onOneOffer={(amount) => match.dispatch.submitOneOffer?.({ amount })}
      onOpenPass={() => match.dispatch.passOpenBid?.(undefined)}
      onOpenRaise={(amount) => match.dispatch.raiseOpenBid?.({ amount })}
      onPlayPainting={(cardID) => match.dispatch.playPainting?.({ cardID })}
      onRespondFixed={(accept) => match.dispatch.respondFixedPrice?.({ accept })}
      view={view}
    />
  );
}
