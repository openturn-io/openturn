import * as React from "react";
import { createPortal } from "react-dom";

interface TipProps {
  /** Tip body. Falsy values disable the tooltip while still rendering children. */
  content: React.ReactNode | null | false;
  children: React.ReactElement;
  /** Open delay in ms (default 120). */
  delay?: number;
}

const TipsEnabledContext = React.createContext<boolean>(true);

export function TipsProvider({
  enabled,
  children,
}: {
  enabled: boolean;
  children: React.ReactNode;
}) {
  return <TipsEnabledContext.Provider value={enabled}>{children}</TipsEnabledContext.Provider>;
}

export function useTipsEnabled(): boolean {
  return React.useContext(TipsEnabledContext);
}

const STORAGE_KEY = "splendor.tutorialTips";

/** Persistent tutorial-tips on/off, stored in localStorage. Defaults to enabled. */
export function useTipsToggle(): readonly [boolean, (next: boolean) => void] {
  const [enabled, setEnabled] = React.useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      return saved === null ? true : saved === "1";
    } catch {
      return true;
    }
  });
  const update = React.useCallback((next: boolean) => {
    setEnabled(next);
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {
        // ignore quota / privacy errors
      }
    }
  }, []);
  return [enabled, update] as const;
}

/**
 * Cursor-anchored tooltip rendered through a portal so it can escape any
 * `overflow: hidden` ancestors. Wraps a single child element and forwards
 * mouse events. Tooltips can be globally disabled via TipsProvider.
 */
export function Tip({ content, children, delay = 120 }: TipProps) {
  const enabled = useTipsEnabled();
  const [pos, setPos] = React.useState<{ x: number; y: number } | null>(null);
  const timerRef = React.useRef<number | null>(null);

  const cancel = React.useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  React.useEffect(() => cancel, [cancel]);

  // When tips are turned off, also drop any in-flight timers/positions.
  React.useEffect(() => {
    if (!enabled) {
      cancel();
      setPos(null);
    }
  }, [enabled, cancel]);

  const child = React.Children.only(children) as React.ReactElement<{
    onMouseEnter?: (e: React.MouseEvent) => void;
    onMouseMove?: (e: React.MouseEvent) => void;
    onMouseLeave?: (e: React.MouseEvent) => void;
  }>;

  // When disabled, return the child untouched — no event listeners, no portal.
  if (!enabled) return child;

  const schedule = (e: React.MouseEvent) => {
    const x = e.clientX;
    const y = e.clientY;
    cancel();
    timerRef.current = window.setTimeout(() => setPos({ x, y }), delay);
  };

  const move = (e: React.MouseEvent) => {
    if (pos === null) return;
    setPos({ x: e.clientX, y: e.clientY });
  };

  const leave = () => {
    cancel();
    setPos(null);
  };

  const cloned = React.cloneElement(child, {
    onMouseEnter: (e: React.MouseEvent) => {
      schedule(e);
      child.props.onMouseEnter?.(e);
    },
    onMouseMove: (e: React.MouseEvent) => {
      move(e);
      child.props.onMouseMove?.(e);
    },
    onMouseLeave: (e: React.MouseEvent) => {
      leave();
      child.props.onMouseLeave?.(e);
    },
  });

  const hasContent = content !== null && content !== undefined && content !== false && content !== "";
  const visible = pos !== null && hasContent;

  const TIP_W = 260;
  const TIP_H = 110;
  let left = 0;
  let top = 0;
  if (pos !== null) {
    const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
    const vh = typeof window !== "undefined" ? window.innerHeight : 800;
    left = pos.x + 16;
    if (left + TIP_W > vw - 8) left = Math.max(8, pos.x - TIP_W - 12);
    top = pos.y + 18;
    if (top + TIP_H > vh - 8) top = Math.max(8, pos.y - TIP_H - 12);
  }

  return (
    <>
      {cloned}
      {visible && typeof document !== "undefined"
        ? createPortal(
            <div
              role="tooltip"
              className="pointer-events-none fixed z-[9999] h-auto min-h-0 rounded-md bg-stone-950/95 px-2.5 py-1.5 text-[11px] leading-snug text-amber-50 shadow-xl ring-1 ring-amber-200/30 backdrop-blur-sm whitespace-normal break-words [&_p]:whitespace-normal [&_p]:break-words"
              style={{
                left,
                top,
                width: TIP_W,
                maxWidth: TIP_W,
                height: "auto",
                minHeight: 0,
                boxSizing: "border-box",
              }}
            >
              {content}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
