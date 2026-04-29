import * as React from "react";
import {
  AnimatePresence,
  animate,
  motion,
  useMotionValue,
  useReducedMotion,
  useTransform,
} from "framer-motion";

import type { ChipColor, GemColor, Tier } from "@openturn/example-splendor-game";

import { GemChip } from "./GemChip";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ChipFlightSpec {
  color: ChipColor;
  fromAnchor: string;
  toAnchor: string;
  /** Optional stagger delay in ms before this flight begins. */
  delay?: number;
}

export interface CardFlightSpec {
  cardID: string;
  bonus: GemColor;
  tier: Tier;
  fromAnchor: string;
  toAnchor: string;
  delay?: number;
}

interface FlightAPI {
  flyChip: (spec: ChipFlightSpec) => void;
  flyCard: (spec: CardFlightSpec) => void;
}

const FlightContext = React.createContext<FlightAPI | null>(null);

export function useFlight(): FlightAPI {
  const ctx = React.useContext(FlightContext);
  if (ctx === null) {
    return { flyChip: () => {}, flyCard: () => {} };
  }
  return ctx;
}

// ---------------------------------------------------------------------------
// Overlay
// ---------------------------------------------------------------------------

type FlightVariant =
  | { kind: "chip"; color: ChipColor }
  | { kind: "card"; bonus: GemColor; tier: Tier };

interface ActiveFlight {
  id: string;
  variant: FlightVariant;
  from: { x: number; y: number; w: number; h: number };
  to: { x: number; y: number; w: number; h: number };
  delay: number;
}

let flightCounter = 0;

export function FlightOverlay({ children }: { children: React.ReactNode }) {
  const [flights, setFlights] = React.useState<readonly ActiveFlight[]>([]);
  const reduced = useReducedMotion();
  const reducedRef = React.useRef(reduced);
  reducedRef.current = reduced;

  // Anchor rect caches. `currCache` is the most recent snapshot, `prevCache`
  // is the one before — that gives us a fallback for elements that just left
  // the DOM (e.g., a market card that was bought this tick).
  const currCache = React.useRef<Map<string, DOMRect>>(new Map());
  const prevCache = React.useRef<Map<string, DOMRect>>(new Map());

  // Only cache anchors that may disappear between renders (cards). Chip pills
  // are always present, so we read them live without paying per-render reflow.
  React.useLayoutEffect(() => {
    prevCache.current = currCache.current;
    const next = new Map<string, DOMRect>();
    document
      .querySelectorAll<HTMLElement>(
        '[data-flight-anchor^="market-card-"], [data-flight-anchor^="reserved-card-"]',
      )
      .forEach((el) => {
        const name = el.getAttribute("data-flight-anchor");
        if (name !== null) next.set(name, el.getBoundingClientRect());
      });
    currCache.current = next;
  });

  const remove = React.useCallback((id: string) => {
    setFlights((curr) => curr.filter((f) => f.id !== id));
  }, []);

  const measure = React.useCallback((name: string): DOMRect | null => {
    const el = document.querySelector(`[data-flight-anchor="${name}"]`);
    if (el !== null) return el.getBoundingClientRect();
    // Fall back to the previous render's snapshot for elements that just left.
    return prevCache.current.get(name) ?? currCache.current.get(name) ?? null;
  }, []);

  const api = React.useMemo<FlightAPI>(() => {
    const spawn = (variant: FlightVariant, fromSel: string, toSel: string, delay: number) => {
      if (reducedRef.current === true) return;
      const from = measure(fromSel);
      const to = measure(toSel);
      if (from === null || to === null) return;
      const id = `flight-${flightCounter}`;
      flightCounter = flightCounter + 1;
      setFlights((curr) => [
        ...curr,
        {
          id,
          variant,
          from: { x: from.left, y: from.top, w: from.width, h: from.height },
          to: { x: to.left, y: to.top, w: to.width, h: to.height },
          delay,
        },
      ]);
    };
    return {
      flyChip: (spec) => {
        spawn(
          { kind: "chip", color: spec.color },
          spec.fromAnchor,
          spec.toAnchor,
          spec.delay ?? 0,
        );
      },
      flyCard: (spec) => {
        spawn(
          { kind: "card", bonus: spec.bonus, tier: spec.tier },
          spec.fromAnchor,
          spec.toAnchor,
          spec.delay ?? 0,
        );
      },
    };
  }, [measure]);

  return (
    <FlightContext.Provider value={api}>
      {children}
      <div
        className="pointer-events-none fixed inset-0 z-50"
        aria-hidden="true"
      >
        <AnimatePresence>
          {flights.map((f) => (
            <Ghost key={f.id} flight={f} onDone={() => remove(f.id)} />
          ))}
        </AnimatePresence>
      </div>
    </FlightContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Ghost — the moving element
// ---------------------------------------------------------------------------

const CHIP_DURATION = 1.1;
const CARD_DURATION = 1.25;

function Ghost({ flight, onDone }: { flight: ActiveFlight; onDone: () => void }) {
  const progress = useMotionValue(0);
  const onDoneRef = React.useRef(onDone);
  onDoneRef.current = onDone;

  const fromCenterX = flight.from.x + flight.from.w / 2;
  const fromCenterY = flight.from.y + flight.from.h / 2;
  const toCenterX = flight.to.x + flight.to.w / 2;
  const toCenterY = flight.to.y + flight.to.h / 2;
  const dx = toCenterX - fromCenterX;
  const dy = toCenterY - fromCenterY;

  const isCard = flight.variant.kind === "card";
  const startWidth = isCard ? flight.from.w : 36;
  const startHeight = isCard ? flight.from.h : 36;
  const endScale = isCard ? Math.max(0.18, 28 / startWidth) : 1;
  const duration = isCard ? CARD_DURATION : CHIP_DURATION;
  const delaySec = flight.delay / 1000;

  // Arc lift: a small upward bow proportional to horizontal distance, capped.
  const lift = Math.min(70, Math.abs(dx) * 0.28);

  const x = useTransform(progress, (p) => dx * p);
  const y = useTransform(progress, (p) => dy * p - lift * 4 * p * (1 - p));
  const scale = useTransform(progress, (p) => {
    if (!isCard) return 1 + Math.sin(Math.PI * p) * 0.04;
    return 1 + (endScale - 1) * p;
  });
  const opacity = useTransform(progress, (p) => {
    if (p < 0.12) return p / 0.12;
    if (p > 0.88) return Math.max(0, (1 - p) / 0.12);
    return 1;
  });

  React.useEffect(() => {
    const controls = animate(progress, 1, {
      duration,
      delay: delaySec,
      ease: [0.33, 0, 0.2, 1],
      onComplete: () => onDoneRef.current(),
    });

    return () => controls.stop();
  }, [delaySec, duration, progress]);

  return (
    <motion.div
      style={{
        position: "absolute",
        left: fromCenterX - startWidth / 2,
        top: fromCenterY - startHeight / 2,
        width: startWidth,
        height: startHeight,
        willChange: "transform, opacity",
        transform: "translateZ(0)",
        x,
        y,
        scale,
        opacity,
      }}
      exit={{ opacity: 0 }}
    >
      {flight.variant.kind === "chip" ? (
        <GemChip color={flight.variant.color} size="md" showCount={false} />
      ) : (
        <CardGhost bonus={flight.variant.bonus} tier={flight.variant.tier} />
      )}
    </motion.div>
  );
}

const TIER_BG: Record<Tier, string> = {
  1: "linear-gradient(135deg, #4a8a3a 0%, #2a5a20 100%)",
  2: "linear-gradient(135deg, #b3a25a 0%, #7a6630 100%)",
  3: "linear-gradient(135deg, #1a1a2a 0%, #2d2d4a 100%)",
};

function CardGhost({ bonus, tier }: { bonus: GemColor; tier: Tier }) {
  return (
    <div
      className="relative h-full w-full overflow-hidden rounded-lg"
      style={{
        background: TIER_BG[tier],
        boxShadow:
          "inset 0 1px 0 rgba(255,255,255,0.18), inset 0 -2px 0 rgba(0,0,0,0.45), 0 8px 18px rgba(0,0,0,0.45)",
        border: "1px solid rgba(0,0,0,0.4)",
      }}
    >
      <div className="absolute inset-0 flex items-center justify-center">
        <GemChip color={bonus} size="md" showCount={false} />
      </div>
    </div>
  );
}
