import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";

import { type ModernArtPlayerView } from "@openturn/example-modern-art-game";

import { CrownIcon } from "./icons";
import { SummaryBody } from "./RoundSummaryOverlay";
import { curatorName, money } from "../lib/format";

interface GameOverOverlayProps {
  view: ModernArtPlayerView;
}

export function GameOverOverlay({ view }: GameOverOverlayProps) {
  const revealed = view.revealedMoney;
  const [dismissed, setDismissed] = React.useState(false);

  if (revealed === null) return null;

  const standings = [...view.seatOrder].sort((a, b) => (revealed[b] ?? 0) - (revealed[a] ?? 0));
  const me = view.myPlayerID;
  const iWon = me !== null && view.winners.includes(me);

  return (
    <>
      <AnimatePresence>
        {!dismissed ? (
          <motion.div
            animate={{ opacity: 1 }}
            className="overlay-backdrop"
            exit={{ opacity: 0 }}
            initial={{ opacity: 0 }}
          >
            <motion.div
              animate={{ opacity: 1, scale: 1, y: 0 }}
              className="overlay-card overlay-final"
              initial={{ opacity: 0, scale: 0.94, y: 24 }}
              transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            >
              <p className="eyebrow">After four rounds</p>
              <h2 className="overlay-title">
                {iWon
                  ? "You take the gallery"
                  : `${view.winners.map(curatorName).join(" & ")} take${view.winners.length === 1 ? "s" : ""} the gallery`}
              </h2>
              <div className="standings">
                {standings.map((id, idx) => {
                  const isWinner = view.winners.includes(id);
                  return (
                    <div className={`standing-row ${isWinner ? "is-winner" : ""}`} key={id}>
                      <span className="standing-place">{idx + 1}</span>
                      <span className="standing-name">
                        {isWinner ? <CrownIcon className="standing-crown" /> : null}
                        {curatorName(id)}
                        {id === me ? <span className="you-tag">you</span> : null}
                      </span>
                      <b className="standing-cash">{money(revealed[id] ?? 0)}</b>
                    </div>
                  );
                })}
              </div>
              {view.roundSummary !== null ? (
                <details className="final-summary">
                  <summary>Final round scoring</summary>
                  <SummaryBody summary={view.roundSummary} view={view} />
                </details>
              ) : null}
              <button className="btn btn-ghost btn-wide" onClick={() => setDismissed(true)} type="button">
                View the table
              </button>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
      {dismissed ? (
        <button className="btn btn-gold reopen-results" onClick={() => setDismissed(false)} type="button">
          <CrownIcon className="pill-icon" />
          Final results
        </button>
      ) : null}
    </>
  );
}
