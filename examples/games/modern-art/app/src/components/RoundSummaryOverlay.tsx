import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";

import { type ModernArtPlayerView, type RoundSummary } from "@openturn/example-modern-art-game";

import { ARTIST_CLASS, ARTIST_NAME, curatorName, money } from "../lib/format";

const TILE_FOR_RANK = [30, 20, 10] as const;

interface RoundSummaryOverlayProps {
  view: ModernArtPlayerView;
}

/**
 * Round-end scoring interstitial. Appears whenever a new round summary
 * lands (and the game isn't over — the game-over screen folds the final
 * summary in itself). Dismissible; never re-shows a summary that was
 * already on the table when this client mounted.
 */
export function RoundSummaryOverlay({ view }: RoundSummaryOverlayProps) {
  const summary = view.roundSummary;
  const seenRound = React.useRef(summary?.round ?? 0);
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    if (summary === null) return;
    if (summary.round > seenRound.current) {
      seenRound.current = summary.round;
      if (view.revealedMoney === null) setOpen(true);
    }
  }, [summary, view.revealedMoney]);

  return (
    <AnimatePresence>
      {open && summary !== null ? (
        <motion.div
          animate={{ opacity: 1 }}
          className="overlay-backdrop"
          exit={{ opacity: 0 }}
          initial={{ opacity: 0 }}
        >
          <motion.div
            animate={{ opacity: 1, scale: 1, y: 0 }}
            className="overlay-card"
            exit={{ opacity: 0, scale: 0.96, y: 12 }}
            initial={{ opacity: 0, scale: 0.94, y: 24 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
          >
            <p className="eyebrow">Round {summary.round} closed</p>
            <h2 className="overlay-title">The critics have spoken</h2>
            <SummaryBody summary={summary} view={view} />
            <button autoFocus className="btn btn-gold btn-wide" onClick={() => setOpen(false)} type="button">
              {summary.round >= 4 ? "Continue" : `On to round ${summary.round + 1}`}
            </button>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

export function SummaryBody({ summary, view }: { summary: RoundSummary; view: ModernArtPlayerView }) {
  return (
    <>
      <div className="summary-rankings">
        {summary.rankedArtists.map((artist, rank) => (
          <div className={`summary-rank ${ARTIST_CLASS[artist]}`} key={artist}>
            <span className="summary-place">{rank + 1}</span>
            <span className="artist-dot" aria-hidden />
            <strong className="summary-artist">{ARTIST_NAME[artist]}</strong>
            <span className="summary-count">{summary.counts[artist]} sold</span>
            <span className="summary-tile">+{TILE_FOR_RANK[rank]}</span>
            <b className="summary-value">{money(summary.values[artist])}/painting</b>
          </div>
        ))}
        {summary.rankedArtists.length === 0 ? (
          <p className="summary-none">No artist placed — no paintings were offered.</p>
        ) : null}
      </div>
      <div className="summary-payouts">
        <h3 className="summary-payout-title">Gallery payouts</h3>
        {view.seatOrder.map((id) => (
          <div className="summary-payout-row" key={id}>
            <span>
              {curatorName(id)}
              {id === view.myPlayerID ? <span className="you-tag">you</span> : null}
            </span>
            <b className={summary.payouts[id] > 0 ? "payout-positive" : ""}>
              {summary.payouts[id] > 0 ? `+${money(summary.payouts[id])}` : money(0)}
            </b>
          </div>
        ))}
      </div>
    </>
  );
}
