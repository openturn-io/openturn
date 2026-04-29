import * as React from "react";
import { motion } from "framer-motion";

interface GameOverDialogProps {
  open: boolean;
  isWinner: boolean;
  myLabel: string;
  winnerLabel: string;
  myScore: number;
  winnerScore: number;
  onClose: () => void;
}

export function GameOverDialog({
  open,
  isWinner,
  myLabel,
  winnerLabel,
  myScore,
  winnerScore,
  onClose,
}: GameOverDialogProps) {
  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="splendor-gameover-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-sm"
    >
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: "spring", duration: 0.45 }}
        className="parchment w-[min(440px,92vw)] rounded-2xl px-6 py-6"
      >
        <div className="flex items-baseline gap-2">
          <p className="m-0 text-[11px] font-medium uppercase tracking-[0.25em] text-stone-700">
            Round complete
          </p>
        </div>
        <h2
          id="splendor-gameover-title"
          className="mt-1 mb-3 font-display text-3xl text-stone-900"
        >
          {isWinner ? `${myLabel} earns the renown` : `${winnerLabel} earns the renown`}
        </h2>
        <div className="mt-1 flex items-center gap-4 text-stone-800">
          <div>
            <p className="m-0 text-[11px] uppercase tracking-[0.2em] text-stone-600">{myLabel}</p>
            <p className="m-0 font-display text-xl">{myScore}</p>
          </div>
          <span className="text-stone-600">vs</span>
          <div>
            <p className="m-0 text-[11px] uppercase tracking-[0.2em] text-stone-600">{winnerLabel}</p>
            <p className="m-0 font-display text-xl">{winnerScore}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="mt-5 inline-flex h-9 items-center justify-center rounded-md bg-stone-900 px-4 text-sm font-medium text-amber-50 shadow-sm hover:bg-stone-800 cursor-pointer"
        >
          Review the table
        </button>
      </motion.div>
    </div>
  );
}
