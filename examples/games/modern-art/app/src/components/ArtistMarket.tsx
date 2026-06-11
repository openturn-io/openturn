import * as React from "react";

import { ARTISTS, type ArtistID, type ModernArtPlayerView } from "@openturn/example-modern-art-game";

import { Tip } from "./ui/tip";
import { ARTIST_CLASS, ARTIST_NAME, money } from "../lib/format";
import { artistLaneTip, offeredDotsTip } from "../lib/tutorialTips";

interface ArtistMarketProps {
  view: ModernArtPlayerView;
}

function laneValue(view: ModernArtPlayerView, artist: ArtistID): number {
  return view.valueTiles[artist].reduce((sum, tile) => sum + tile, 0);
}

export function ArtistMarket({ view }: ArtistMarketProps) {
  return (
    <aside className="panel market-board">
      <h2 className="panel-title">The Market</h2>
      <p className="panel-subtitle">5th painting of any artist ends the round</p>
      <div className="artist-lanes">
        {ARTISTS.map((artist) => {
          const offered = view.offeredCounts[artist];
          const tiles = view.valueTiles[artist];
          const value = laneValue(view, artist);
          const hot = offered >= 4;
          return (
            <div className={`artist-lane ${ARTIST_CLASS[artist]} ${hot ? "is-hot" : ""}`} key={artist}>
              <Tip content={artistLaneTip({ artist, view })}>
                <div className="artist-lane-head">
                  <span className="artist-swatch" aria-hidden />
                  <strong className="artist-lane-name">{ARTIST_NAME[artist]}</strong>
                  <em className="artist-lane-value" title="Payout per painting if this artist places top 3">
                    {money(value)}
                  </em>
                </div>
              </Tip>
              <div className="artist-lane-body">
                <Tip content={artistLaneTip({ artist, view })}>
                  <div className="value-tiles" aria-label={`Past value tiles: ${tiles.join(", ") || "none"}`}>
                    {[0, 1, 2, 3].map((slot) => (
                      <span className={`value-tile ${tiles[slot] !== undefined ? "filled" : ""}`} key={slot}>
                        {tiles[slot] ?? ""}
                      </span>
                    ))}
                  </div>
                </Tip>
                <Tip content={offeredDotsTip({ artist, view })}>
                  <div className="offer-pips" aria-label={`${offered} of 5 offered this round`}>
                    {[0, 1, 2, 3, 4].map((slot) => (
                      <i className={`offer-pip ${slot < offered ? "lit" : ""}`} key={slot} />
                    ))}
                    {hot ? <span className="offer-warning">round ends next</span> : null}
                  </div>
                </Tip>
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
