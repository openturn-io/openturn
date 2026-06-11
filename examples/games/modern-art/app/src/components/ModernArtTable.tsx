import * as React from "react";

import { type ModernArtPlayerView } from "@openturn/example-modern-art-game";

import { ArtistMarket } from "./ArtistMarket";
import { type AuctionHandlers } from "./AuctionControls";
import { AuctionStage } from "./AuctionStage";
import { CollectorsPanel } from "./CollectorsPanel";
import { GameOverOverlay } from "./GameOverOverlay";
import { HandRail } from "./HandRail";
import { RoundSummaryOverlay } from "./RoundSummaryOverlay";
import { TopBar } from "./TopBar";
import { TipsProvider, useTipsToggle } from "./ui/tip";

interface ModernArtTableProps extends AuctionHandlers {
  onPlayPainting: (cardID: string) => void;
  view: ModernArtPlayerView;
}

export function ModernArtTable(props: ModernArtTableProps) {
  const { view } = props;
  const [tipsEnabled, setTipsEnabled] = useTipsToggle();

  return (
    <TipsProvider enabled={tipsEnabled}>
      <main className="modern-art-shell">
        <TopBar onToggleTips={setTipsEnabled} tipsEnabled={tipsEnabled} view={view} />
        <div className="table-grid">
          <ArtistMarket view={view} />
          <AuctionStage
            onFixedPrice={props.onFixedPrice}
            onHiddenBid={props.onHiddenBid}
            onOfferDouble={props.onOfferDouble}
            onOneOffer={props.onOneOffer}
            onOpenPass={props.onOpenPass}
            onOpenRaise={props.onOpenRaise}
            onRespondFixed={props.onRespondFixed}
            view={view}
          />
          <CollectorsPanel view={view} />
        </div>
        <HandRail onPlayPainting={props.onPlayPainting} view={view} />
        <RoundSummaryOverlay view={view} />
        <GameOverOverlay view={view} />
      </main>
    </TipsProvider>
  );
}
