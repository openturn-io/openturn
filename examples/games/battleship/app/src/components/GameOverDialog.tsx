import * as React from "react";

import { CheckmarkCircle02Icon } from "@hugeicons/core-free-icons";

import { Icon } from "./ui/icon";

interface GameOverDialogProps {
  open: boolean;
  isWinner: boolean;
  myLabel: string;
  opponentLabel: string;
  onClose: () => void;
}

export function GameOverDialog({
  open,
  isWinner,
  myLabel,
  opponentLabel,
  onClose,
}: GameOverDialogProps) {
  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="battleship-gameover-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur"
    >
      <div className="w-[min(420px,90vw)] rounded-2xl border border-border bg-white px-6 py-6 shadow-2xl animate-[stage-rise_360ms_cubic-bezier(0.2,0.82,0.2,1)]">
        <div className="flex items-center gap-3">
          <Icon
            icon={CheckmarkCircle02Icon}
            size={32}
            className={isWinner ? "text-emerald-500" : "text-slate-400"}
          />
          <div>
            <p className="m-0 text-[0.72rem] font-medium uppercase tracking-[0.22em] text-slate-500">
              Battle concluded
            </p>
            <h2
              id="battleship-gameover-title"
              className="m-0 font-display text-2xl text-slate-950"
            >
              {isWinner ? `${myLabel} takes the sea` : `${opponentLabel} takes the sea`}
            </h2>
          </div>
        </div>
        <p className="mt-3 text-sm text-slate-600">
          The match is complete. Start a new match from the lobby to sail again.
        </p>
        <button
          type="button"
          onClick={onClose}
          className="mt-4 inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90"
        >
          Review the board
        </button>
      </div>
    </div>
  );
}
