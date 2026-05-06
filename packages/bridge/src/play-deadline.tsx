import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import type { BridgeHost } from "./host";

const FAST_TICK_MS = 100;
const SLOW_TICK_MS = 1_000;
const FAST_TICK_THRESHOLD_MS = 5_000;

/**
 * Live-updating turn-countdown derived from a `BridgeHost`. Ticks at 1Hz
 * baseline, ramping to 10Hz when `remainingMs < 5000` so the final-seconds
 * display feels smooth. Each tick recomputes `remainingMs` from `Date.now()`,
 * so tab-visibility throttling self-corrects on foreground.
 */
export function useTurnDeadline(host: BridgeHost): {
  deadline: number | null;
  remainingMs: number;
  isExpired: boolean;
} {
  const [deadline, setDeadline] = useState<number | null>(host.deadline);

  useEffect(() => {
    setDeadline(host.deadline);
    return host.on("deadline-changed", (e) => {
      setDeadline(e.deadline);
    });
  }, [host]);

  const [remainingMs, setRemainingMs] = useState<number>(() =>
    deadline === null ? 0 : Math.max(0, deadline - Date.now()),
  );

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (deadline === null) {
      setRemainingMs(0);
      return;
    }

    const tick = () => {
      const next = Math.max(0, deadline - Date.now());
      setRemainingMs(next);
      if (next === 0) return;
      const interval = next < FAST_TICK_THRESHOLD_MS ? FAST_TICK_MS : SLOW_TICK_MS;
      timerRef.current = setTimeout(tick, interval);
    };

    tick();
    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [deadline]);

  return {
    deadline,
    remainingMs,
    isExpired: deadline !== null && remainingMs === 0,
  };
}

/** Default countdown UI rendered in `<PlayShell>`'s toolbar trail. */
export function TurnCountdown({ host }: { host: BridgeHost }): ReactNode {
  const { deadline, remainingMs, isExpired } = useTurnDeadline(host);
  if (deadline === null) return null;

  const urgent = remainingMs < FAST_TICK_THRESHOLD_MS;
  const totalSeconds = Math.ceil(remainingMs / 1_000);
  const mm = Math.floor(totalSeconds / 60);
  const ss = (totalSeconds % 60).toString().padStart(2, "0");

  return (
    <span
      className={`font-mono tabular-nums tracking-tight ${
        urgent ? "text-red-600 dark:text-red-400" : "text-slate-700 dark:text-slate-300"
      }`}
      aria-live="polite"
      aria-label="Turn time remaining"
    >
      {mm}:{ss}
      {isExpired ? " ⏱" : ""}
    </span>
  );
}
