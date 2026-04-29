import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";

import {
  CHIP_COLORS,
  TAKE_TWO_MIN_PILE,
  type ChipColor,
  type SplendorPlayerView,
} from "@openturn/example-splendor-game";

import { GemChip } from "./GemChip";
import { Tip } from "./ui/tip";
import { bankChipTip, confirmTakeTip, takeTwoTip } from "../lib/tutorialTips";
import { cn } from "../lib/utils";

type Selection = readonly ChipColor[];

interface ChipBankProps {
  view: SplendorPlayerView;
  isMyTurn: boolean;
  /** Currently-selected chips for the takeThree composer. */
  selection: Selection;
  onToggle: (color: ChipColor) => void;
  onTakeTwo: (color: ChipColor) => void;
  onConfirmTake: () => void;
  onClearSelection: () => void;
  /** True iff the player is mid-discard. */
  mustDiscard: number;
}

export function ChipBank({
  view,
  isMyTurn,
  selection,
  onToggle,
  onTakeTwo,
  onConfirmTake,
  onClearSelection,
  mustDiscard,
}: ChipBankProps) {
  const colors = CHIP_COLORS;
  const selectionSet = new Set<ChipColor>(selection);
  const canConfirm =
    isMyTurn &&
    mustDiscard === 0 &&
    selection.length >= 1 &&
    selection.length <= 3 &&
    new Set(selection).size === selection.length;

  return (
    <div className="felt-panel flex flex-col gap-3 p-3 lg:p-4">
      <div className="flex items-center justify-between gap-2 text-shadow-soft">
        <h3 className="m-0 font-display text-base tracking-wide text-amber-100/90">Bank</h3>
        {selection.length > 0 ? (
          <button
            type="button"
            onClick={onClearSelection}
            className="rounded-md border border-white/15 bg-white/10 px-2 py-0.5 text-xs text-amber-100/90 hover:bg-white/15"
          >
            Clear
          </button>
        ) : null}
      </div>
      <div className="grid grid-cols-3 gap-2.5 lg:flex lg:flex-col lg:gap-3">
        {colors.map((color) => {
          const count = view.bank[color];
          const isGold = color === "gold";
          const selected = selectionSet.has(color);
          const canSelect = isMyTurn && mustDiscard === 0 && !isGold && count > 0 && (selected || selection.length < 3);
          const canTakeTwo = isMyTurn && mustDiscard === 0 && !isGold && count >= TAKE_TWO_MIN_PILE && selection.length === 0;
          return (
            <div
              key={color}
              data-flight-anchor={`bank-chip-${color}`}
              className={cn(
                "relative flex items-center gap-2 rounded-xl px-2 py-1.5",
                selected && "bg-amber-300/15 ring-1 ring-inset ring-amber-200/60",
              )}
            >
              {/* Bank chip token with the pile count. */}
              <Tip
                content={bankChipTip({
                  color,
                  pileCount: count,
                  isMyTurn,
                  mustDiscard,
                  finished: view.winner !== null,
                  selected,
                  selectionLength: selection.length,
                })}
              >
                <button
                  type="button"
                  onClick={() => canSelect && onToggle(color)}
                  disabled={!canSelect}
                  className={cn(
                    "relative inline-flex h-12 w-12 items-center justify-center rounded-full transition-transform",
                    canSelect && "hover:scale-105 hover:-translate-y-0.5",
                    !canSelect && "opacity-70",
                  )}
                >
                  <GemChip color={color} size="md" count={count} />
                </button>
              </Tip>
              <div className="flex flex-1 flex-col">
                <span className="text-[11px] uppercase tracking-[0.18em] text-amber-100/70">{color}</span>
                {!isGold ? (
                  <Tip
                    content={takeTwoTip({
                      color,
                      pileCount: count,
                      isMyTurn,
                      mustDiscard,
                      finished: view.winner !== null,
                      selectionLength: selection.length,
                    })}
                  >
                    <button
                      type="button"
                      onClick={() => canTakeTwo && onTakeTwo(color)}
                      disabled={!canTakeTwo}
                      className={cn(
                        "mt-0.5 self-start rounded-md border border-white/15 bg-white/5 px-2 py-0.5 text-[11px] text-amber-100/90",
                        canTakeTwo && "hover:bg-white/15 hover:border-amber-200/50 cursor-pointer",
                        !canTakeTwo && "opacity-40 cursor-not-allowed",
                      )}
                    >
                      Take 2
                    </button>
                  </Tip>
                ) : (
                  <span className="mt-0.5 text-[10px] text-amber-200/70">wild</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <AnimatePresence>
        {selection.length > 0 ? (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            className="flex items-center justify-between gap-2 rounded-lg border border-amber-200/30 bg-black/20 px-2 py-1.5"
          >
            <div className="flex items-center gap-1">
              {selection.map((c) => (
                <GemChip key={c} color={c} size="xs" showCount={false} />
              ))}
              <span className="ml-1.5 text-xs text-amber-100/80">
                {selection.length} of 3 distinct
              </span>
            </div>
            <Tip
              content={confirmTakeTip({
                selectionLength: selection.length,
                isMyTurn,
                mustDiscard,
              })}
            >
              <button
                type="button"
                onClick={onConfirmTake}
                disabled={!canConfirm}
                className={cn(
                  "rounded-md bg-amber-300 px-3 py-1 text-xs font-medium text-stone-900",
                  !canConfirm && "opacity-50 cursor-not-allowed",
                  canConfirm && "hover:bg-amber-200 cursor-pointer",
                )}
              >
                Take {selection.length}
              </button>
            </Tip>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
