import * as React from "react";

import { type ModernArtPlayerView } from "@openturn/example-modern-art-game";

import { CashIcon, DeckIcon, EyeIcon, GavelIcon } from "./icons";
import { Tip } from "./ui/tip";
import { curatorName, money, PHASE_LABEL } from "../lib/format";
import { hammerTip, moneyTip, phaseTip, roundTip, tipsToggleTip } from "../lib/tutorialTips";

interface TopBarProps {
  onToggleTips: (next: boolean) => void;
  tipsEnabled: boolean;
  view: ModernArtPlayerView;
}

export function TopBar({ onToggleTips, tipsEnabled, view }: TopBarProps) {
  const me = view.myPlayerID;

  return (
    <header className="topbar">
      <div className="topbar-brand">
        <h1 className="wordmark">
          Modern <span>Art</span>
        </h1>
        <Tip content={roundTip(view)}>
          <div className="round-track" aria-label={`Round ${view.round} of 4`}>
            {[1, 2, 3, 4].map((n) => (
              <i
                className={`round-pip ${n < view.round ? "done" : ""} ${n === view.round ? "now" : ""}`}
                key={n}
              />
            ))}
            <span className="round-label">Round {view.round}</span>
          </div>
        </Tip>
      </div>

      <div className="topbar-status">
        <Tip content={phaseTip(view)}>
          <span className="pill pill-phase">
            {view.revealedMoney !== null ? "Game over" : PHASE_LABEL[view.phase] ?? "Resolving"}
          </span>
        </Tip>
        <Tip content={hammerTip(view)}>
          <span className="pill">
            <GavelIcon className="pill-icon" />
            {curatorName(view.hammer)}
          </span>
        </Tip>
        <span className="pill" title="Cards left in the deck">
          <DeckIcon className="pill-icon" />
          {view.deckCount}
        </span>
        <Tip content={moneyTip(view)}>
          <span className="pill pill-cash">
            {me === null ? <EyeIcon className="pill-icon" /> : <CashIcon className="pill-icon" />}
            {me === null ? "Spectator" : money(view.myMoney ?? 0)}
          </span>
        </Tip>
        <Tip content={tipsToggleTip(tipsEnabled)}>
          <button
            aria-pressed={tipsEnabled}
            className={`tips-toggle ${tipsEnabled ? "on" : ""}`}
            onClick={() => onToggleTips(!tipsEnabled)}
            type="button"
          >
            <span className="dot" aria-hidden />
            Tips
          </button>
        </Tip>
      </div>
    </header>
  );
}
