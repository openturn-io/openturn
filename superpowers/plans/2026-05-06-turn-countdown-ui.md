# Turn-Timer Countdown UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface a server-authoritative live turn-time countdown in the play shell (auto-mounted, used by both CLI dev shell and cloud play page) and expose a hook for game authors to drive custom in-game UI.

**Architecture:** Two surfaces sharing the same data shape and ticking logic. (1) `<PlayShell>` (in `@openturn/bridge`) auto-renders `<TurnCountdown>` in its toolbar trail; the component subscribes to a new `BridgeHost.deadline` field that updates from a new `openturn:bridge:deadline` postMessage emitted by the game iframe whenever its `controlMeta.deadline` changes. (2) `useTurnDeadline()` in `@openturn/react` reads the same data from `useMatch()`'s snapshot for game authors who want their own UI. Both hooks tick at 1 Hz, ramping to 10 Hz when `remainingMs < 5000`. Bridge messages emit only on snapshot change; the per-tick recomputation is purely client-side.

**Tech Stack:** TypeScript, Zod (bridge protocol schemas), React (hooks + components), `vitest` + `@testing-library/react` for the bridge package, `bun:test` for `@openturn/react` (matches existing patterns), Tailwind for the default UI.

**Spec:** `superpowers/specs/2026-05-06-turn-countdown-ui-design.md`

---

## File Map

| File | Role |
|---|---|
| `packages/bridge/src/schema.ts` | Add `openturn:bridge:deadline` message variant to `BridgeMessageSchema`. |
| `packages/bridge/src/host.ts` | Add `host.deadline` readonly field, `deadline-changed` event in `BridgeHostEventMap`, message handler that de-dupes and emits. |
| `packages/bridge/src/game.ts` | Add `setDeadline(deadline: number \| null): void` to `GameBridge`. Iframe-side de-dupe via a `lastDeadline` slot. |
| `packages/bridge/src/play-deadline.tsx` (NEW) | `useTurnDeadline(host)` hook (uses `useSyncExternalStore` for the deadline + `useState`/`useEffect` `setTimeout` ticking). `<TurnCountdown host>` component returning the formatted span (or null when deadline is null). |
| `packages/bridge/src/play-deadline.test.tsx` (NEW) | Hook + component tests with vitest fake timers. |
| `packages/bridge/src/shell.tsx` | Mount `<TurnCountdown host={host} />` in the toolbar trail. Add `showTurnCountdown?: boolean` prop (default `true`). |
| `packages/bridge/src/index.ts` | Export `useTurnDeadline`, `TurnCountdown` from the new file. |
| `packages/bridge/src/bridge.test.ts` | New round-trip test: game.setDeadline → host.deadline + deadline-changed event. |
| `packages/bridge/src/schema.test.ts` | Parse tests for the new message variant. |
| `packages/react/src/index.tsx` | Add `useTurnDeadline()` (in-iframe variant) reading from `useMatch()`. Wire the existing `<OpenturnProvider>` to call `backend.setDeadline(deadline)` on snapshot deadline changes. |
| `packages/react/src/index.test.tsx` | Hook test + provider-emission test. |

---

## Task 1: Bridge protocol — add `openturn:bridge:deadline` message

**Files:**
- Modify: `packages/bridge/src/schema.ts`
- Test: `packages/bridge/src/schema.test.ts`

- [ ] **Step 1: Write failing tests**

In `packages/bridge/src/schema.test.ts`, append (or add inside the existing test block; check what's there first and match the pattern):

```ts
test("BridgeMessageSchema parses openturn:bridge:deadline with a number", () => {
  const result = BridgeMessageSchema.safeParse({
    kind: "openturn:bridge:deadline",
    deadline: 1_700_000_000_000,
  });
  expect(result.success).toBe(true);
  if (result.success) {
    expect(result.data.kind).toBe("openturn:bridge:deadline");
  }
});

test("BridgeMessageSchema parses openturn:bridge:deadline with null", () => {
  const result = BridgeMessageSchema.safeParse({
    kind: "openturn:bridge:deadline",
    deadline: null,
  });
  expect(result.success).toBe(true);
});

test("BridgeMessageSchema rejects openturn:bridge:deadline with a string deadline", () => {
  const result = BridgeMessageSchema.safeParse({
    kind: "openturn:bridge:deadline",
    deadline: "soon",
  });
  expect(result.success).toBe(false);
});
```

(Read the existing imports — `BridgeMessageSchema` is already exported from `./schema`. Use whatever test framework the file uses — `vitest` per the repo's bridge tests. Check file head for the import line and copy.)

- [ ] **Step 2: Run tests to verify failure**

Run: `bun run --filter @openturn/bridge test`

Expected: FAIL on the new tests — the message variant isn't in the schema yet.

- [ ] **Step 3: Add the message variant**

In `packages/bridge/src/schema.ts`, find `BridgeMessageSchema` (around line 95+) and add a new variant alongside the existing ones:

```ts
z.object({
  kind: z.literal("openturn:bridge:deadline"),
  deadline: z.number().nullable(),
}),
```

Place it after the existing `openturn:bridge:match-state` variant for symmetry — the two are conceptually similar (game→host status updates).

- [ ] **Step 4: Run tests + typecheck**

Run: `bun run --filter @openturn/bridge test && bun run --filter @openturn/bridge typecheck`

Expected: All new tests PASS; existing tests PASS; typecheck PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/bridge/src/schema.ts packages/bridge/src/schema.test.ts
git commit -m "bridge: add openturn:bridge:deadline message variant"
```

---

## Task 2: BridgeHost — receive deadline message + emit event

**Files:**
- Modify: `packages/bridge/src/host.ts`
- Test: `packages/bridge/src/bridge.test.ts`

- [ ] **Step 1: Write failing tests**

In `packages/bridge/src/bridge.test.ts`, find the existing `match-state-changed` test pattern (around line 246-268). Append parallel tests after it:

```ts
it("deadline: starts as null", () => {
  const { host } = setup();  // adapt to whatever helper pattern the existing tests use
  expect(host.deadline).toBe(null);
});

it("deadline: receiving openturn:bridge:deadline updates host.deadline and fires event", async () => {
  const { host, postFromGame } = setup();
  const fired: Array<number | null> = [];
  host.on("deadline-changed", (e) => fired.push(e.deadline));

  postFromGame({ kind: "openturn:bridge:deadline", deadline: 1_700_000_000_000 });
  await flushMicrotasks();  // or whatever the existing tests use

  expect(host.deadline).toBe(1_700_000_000_000);
  expect(fired).toEqual([1_700_000_000_000]);
});

it("deadline: receiving the same deadline twice fires the event once", async () => {
  const { host, postFromGame } = setup();
  const fired: Array<number | null> = [];
  host.on("deadline-changed", (e) => fired.push(e.deadline));

  postFromGame({ kind: "openturn:bridge:deadline", deadline: 1_700_000_000_000 });
  postFromGame({ kind: "openturn:bridge:deadline", deadline: 1_700_000_000_000 });
  await flushMicrotasks();

  expect(fired).toEqual([1_700_000_000_000]);
});

it("deadline: receiving null after a number clears and fires", async () => {
  const { host, postFromGame } = setup();
  const fired: Array<number | null> = [];
  host.on("deadline-changed", (e) => fired.push(e.deadline));

  postFromGame({ kind: "openturn:bridge:deadline", deadline: 1_700_000_000_000 });
  postFromGame({ kind: "openturn:bridge:deadline", deadline: null });
  await flushMicrotasks();

  expect(host.deadline).toBe(null);
  expect(fired).toEqual([1_700_000_000_000, null]);
});
```

(Read the existing `match-state` test in `bridge.test.ts:246-268` to find the actual test setup helper names — `setup()`, `postFromGame()`, `flushMicrotasks()` are placeholders for the actual idioms. Use what the file already has.)

- [ ] **Step 2: Run tests to verify failure**

Run: `bun run --filter @openturn/bridge test`

Expected: FAIL on new tests — `host.deadline` and `deadline-changed` event don't exist yet.

- [ ] **Step 3: Update `BridgeHostEventMap`**

In `packages/bridge/src/host.ts:42-46`, add `deadline-changed`:

```ts
export type BridgeHostEventMap = {
  ready: { origin: string };
  "lifecycle-close": Record<string, never>;
  "match-state-changed": { matchActive: boolean };
  "deadline-changed": { deadline: number | null };
};
```

- [ ] **Step 4: Add `deadline` field to `BridgeHost` interface**

In `packages/bridge/src/host.ts:60-93` (the `BridgeHost` interface), add after `matchActive`:

```ts
/**
 * Current turn deadline as a wall-clock millisecond instant (server's clock),
 * or null when no active deadline. Updated by `openturn:bridge:deadline`
 * messages from the game iframe. Subscribe via `on("deadline-changed", ...)`
 * to react.
 */
readonly deadline: number | null;
```

- [ ] **Step 5: Implement state + handler in `createBridgeHost`**

In `packages/bridge/src/host.ts`, find the body of `createBridgeHost` (around line 105+). Find where `matchActive` state is declared — likely a `let matchActive: boolean = ...` near the top of the function. Add a sibling:

```ts
let deadline: number | null = null;
```

Find the `onMessage` switch statement (around line 220+, where `case "openturn:bridge:match-state":` lives). Add a parallel case:

```ts
case "openturn:bridge:deadline":
  if (deadline !== message.deadline) {
    deadline = message.deadline;
    emit("deadline-changed", { deadline });
  }
  return;
```

In the returned object (around line 263+, where `get matchActive() { return matchActive; }` is), add:

```ts
get deadline() {
  return deadline;
},
```

- [ ] **Step 6: Run tests + typecheck**

Run: `bun run --filter @openturn/bridge test && bun run --filter @openturn/bridge typecheck`

Expected: All new tests PASS; existing tests PASS; typecheck PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/bridge/src/host.ts packages/bridge/src/bridge.test.ts
git commit -m "bridge: BridgeHost.deadline field + deadline-changed event with de-dupe"
```

---

## Task 3: GameBridge — `setDeadline(deadline)` with iframe-side de-dupe

**Files:**
- Modify: `packages/bridge/src/game.ts`
- Test: `packages/bridge/src/bridge.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `packages/bridge/src/bridge.test.ts` (parallel to the existing `setMatchActive` round-trip test pattern):

```ts
it("game.setDeadline: round-trips through to host.deadline", async () => {
  const { host, game } = setup();
  const fired: Array<number | null> = [];
  host.on("deadline-changed", (e) => fired.push(e.deadline));

  game.setDeadline(1_700_000_000_000);
  await flushMicrotasks();

  expect(host.deadline).toBe(1_700_000_000_000);
  expect(fired).toEqual([1_700_000_000_000]);
});

it("game.setDeadline: identical consecutive calls coalesce (one bridge message)", async () => {
  const { host, game } = setup();
  const fired: Array<number | null> = [];
  host.on("deadline-changed", (e) => fired.push(e.deadline));

  game.setDeadline(1_700_000_000_000);
  game.setDeadline(1_700_000_000_000);
  game.setDeadline(1_700_000_000_000);
  await flushMicrotasks();

  expect(fired.length).toBe(1);
});

it("game.setDeadline: null after a number clears", async () => {
  const { host, game } = setup();
  const fired: Array<number | null> = [];
  host.on("deadline-changed", (e) => fired.push(e.deadline));

  game.setDeadline(1_700_000_000_000);
  game.setDeadline(null);
  await flushMicrotasks();

  expect(host.deadline).toBe(null);
  expect(fired).toEqual([1_700_000_000_000, null]);
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `bun run --filter @openturn/bridge test`

Expected: FAIL — `game.setDeadline` doesn't exist.

- [ ] **Step 3: Add to `GameBridge` interface**

In `packages/bridge/src/game.ts:37-69` (the `GameBridge` interface), add after `setMatchActive`:

```ts
/**
 * Announce the current turn deadline (wall-clock millis) or null when no
 * active deadline. The shell's countdown subscribes via
 * `host.on("deadline-changed", ...)`. Safe to call repeatedly; duplicate
 * values are coalesced.
 */
setDeadline(deadline: number | null): void;
```

- [ ] **Step 4: Implement `setDeadline` in `createGameBridge`**

In `packages/bridge/src/game.ts`, find `createGameBridge` (line 80+). Near the top of the function body (where `let matchActive = ...` is declared), add:

```ts
let lastDeadline: number | null | undefined = undefined;
```

(`undefined` sentinel so the first call always emits, even if the value is `null`.)

In the returned object (around line 294 where `setMatchActive` is implemented), add a sibling:

```ts
setDeadline(deadline) {
  if (lastDeadline === deadline) return;
  lastDeadline = deadline;
  postTo(parent, parentOrigin, {
    kind: "openturn:bridge:deadline",
    deadline,
  });
},
```

- [ ] **Step 5: Run tests + typecheck**

Run: `bun run --filter @openturn/bridge test && bun run --filter @openturn/bridge typecheck`

Expected: All new tests PASS; existing tests PASS; typecheck PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/bridge/src/game.ts packages/bridge/src/bridge.test.ts
git commit -m "bridge: GameBridge.setDeadline with iframe-side de-dupe"
```

---

## Task 4: Shell hook + default `<TurnCountdown>` component

**Files:**
- Create: `packages/bridge/src/play-deadline.tsx`
- Test: `packages/bridge/src/play-deadline.test.tsx`
- Modify: `packages/bridge/src/index.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/bridge/src/play-deadline.test.tsx`:

```tsx
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen, act } from "@testing-library/react";
import { renderHook } from "@testing-library/react";

afterEach(() => cleanup());

import type { BridgeHost, BridgeHostEventMap } from "./host";
import { TurnCountdown, useTurnDeadline } from "./play-deadline";

/** Minimal in-memory BridgeHost stub for hook/component tests. */
function makeFakeHost(initialDeadline: number | null = null): BridgeHost & {
  setDeadline(d: number | null): void;
} {
  let currentDeadline: number | null = initialDeadline;
  const listeners = new Set<(e: BridgeHostEventMap["deadline-changed"]) => void>();
  return {
    src: "",
    matchActive: false,
    deadline: initialDeadline,
    get matchActive_get() { return false; },
    setDeadline(d) {
      currentDeadline = d;
      // Mutate the readonly field via a getter
      Object.defineProperty(this, "deadline", {
        get: () => currentDeadline,
        configurable: true,
      });
      for (const l of listeners) l({ deadline: d });
    },
    emitShellControl: () => undefined,
    pause: () => undefined,
    resume: () => undefined,
    close: () => undefined,
    on: (event, listener) => {
      if (event === "deadline-changed") {
        listeners.add(listener as (e: BridgeHostEventMap["deadline-changed"]) => void);
        return () => listeners.delete(listener as (e: BridgeHostEventMap["deadline-changed"]) => void);
      }
      return () => undefined;
    },
    requestBatchStream: async () => "no-source" as const,
    stopBatchStream: () => undefined,
    onBatch: () => () => undefined,
  } as unknown as BridgeHost & { setDeadline(d: number | null): void };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("useTurnDeadline", () => {
  test("returns null deadline + 0 remainingMs initially", () => {
    const host = makeFakeHost(null);
    const { result } = renderHook(() => useTurnDeadline(host));
    expect(result.current.deadline).toBe(null);
    expect(result.current.remainingMs).toBe(0);
    expect(result.current.isExpired).toBe(false);
  });

  test("updates when host emits deadline-changed", () => {
    const host = makeFakeHost(null);
    const { result } = renderHook(() => useTurnDeadline(host));

    act(() => {
      host.setDeadline(Date.now() + 30_000);
    });

    expect(result.current.deadline).not.toBe(null);
    expect(result.current.remainingMs).toBeGreaterThan(29_000);
    expect(result.current.remainingMs).toBeLessThanOrEqual(30_000);
  });

  test("ticks at 1Hz when remainingMs >= 5000", () => {
    const start = 1_700_000_000_000;
    vi.setSystemTime(start);
    const host = makeFakeHost(start + 30_000);
    const { result } = renderHook(() => useTurnDeadline(host));

    expect(result.current.remainingMs).toBe(30_000);

    act(() => { vi.advanceTimersByTime(1_000); });
    expect(result.current.remainingMs).toBe(29_000);

    act(() => { vi.advanceTimersByTime(1_000); });
    expect(result.current.remainingMs).toBe(28_000);
  });

  test("ramps to 10Hz when remainingMs < 5000", () => {
    const start = 1_700_000_000_000;
    vi.setSystemTime(start);
    const host = makeFakeHost(start + 4_500);
    const { result } = renderHook(() => useTurnDeadline(host));

    expect(result.current.remainingMs).toBe(4_500);

    act(() => { vi.advanceTimersByTime(100); });
    expect(result.current.remainingMs).toBe(4_400);

    act(() => { vi.advanceTimersByTime(100); });
    expect(result.current.remainingMs).toBe(4_300);
  });

  test("isExpired becomes true at deadline; ticking stops", () => {
    const start = 1_700_000_000_000;
    vi.setSystemTime(start);
    const host = makeFakeHost(start + 1_000);
    const { result } = renderHook(() => useTurnDeadline(host));

    act(() => { vi.advanceTimersByTime(1_000); });
    expect(result.current.remainingMs).toBe(0);
    expect(result.current.isExpired).toBe(true);

    // After expiry, advancing time should not change anything
    act(() => { vi.advanceTimersByTime(5_000); });
    expect(result.current.remainingMs).toBe(0);
    expect(result.current.isExpired).toBe(true);
  });

  test("clearing deadline (host emits null) stops ticking", () => {
    const start = 1_700_000_000_000;
    vi.setSystemTime(start);
    const host = makeFakeHost(start + 30_000);
    const { result } = renderHook(() => useTurnDeadline(host));
    expect(result.current.remainingMs).toBe(30_000);

    act(() => { host.setDeadline(null); });
    expect(result.current.deadline).toBe(null);
    expect(result.current.remainingMs).toBe(0);
    expect(result.current.isExpired).toBe(false);
  });
});

describe("<TurnCountdown />", () => {
  test("renders nothing when deadline is null", () => {
    const host = makeFakeHost(null);
    const { container } = render(<TurnCountdown host={host} />);
    expect(container.firstChild).toBeNull();
  });

  test("renders 0:30 for a 30s deadline", () => {
    const start = 1_700_000_000_000;
    vi.setSystemTime(start);
    const host = makeFakeHost(start + 30_000);
    render(<TurnCountdown host={host} />);
    expect(screen.getByLabelText("Turn time remaining").textContent).toContain("0:30");
  });

  test("adds urgent text-red class when remainingMs < 5000", () => {
    const start = 1_700_000_000_000;
    vi.setSystemTime(start);
    const host = makeFakeHost(start + 4_500);
    render(<TurnCountdown host={host} />);
    const node = screen.getByLabelText("Turn time remaining");
    expect(node.className).toContain("text-red-600");
  });

  test("formats m:ss with zero-padded seconds", () => {
    const start = 1_700_000_000_000;
    vi.setSystemTime(start);
    const host = makeFakeHost(start + 65_000);  // 1:05
    render(<TurnCountdown host={host} />);
    expect(screen.getByLabelText("Turn time remaining").textContent).toContain("1:05");
  });

  test("shows 0:00 ⏱ when expired", () => {
    const start = 1_700_000_000_000;
    vi.setSystemTime(start);
    const host = makeFakeHost(start - 1);  // already past
    render(<TurnCountdown host={host} />);
    const text = screen.getByLabelText("Turn time remaining").textContent ?? "";
    expect(text).toContain("0:00");
    expect(text).toContain("⏱");
  });
});
```

(`makeFakeHost` is rough — adapt the host stub to whatever shape `BridgeHost` actually has. The key bits are: `host.deadline` reads, `host.on("deadline-changed", listener)` returns an unsubscribe. Read the actual `BridgeHost` interface in `host.ts:60-93` and stub everything it requires.)

- [ ] **Step 2: Run tests to verify failure**

Run: `bun run --filter @openturn/bridge test`

Expected: FAIL — `play-deadline.tsx` doesn't exist.

- [ ] **Step 3: Implement `useTurnDeadline` and `<TurnCountdown>`**

Create `packages/bridge/src/play-deadline.tsx`:

```tsx
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
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
  const deadline = useSyncExternalStore(
    (onChange) => host.on("deadline-changed", onChange),
    () => host.deadline,
    () => host.deadline,
  );

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
      if (next === 0) return;  // stop ticking; next deadline change re-starts
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
      {mm}:{ss}{isExpired ? " ⏱" : ""}
    </span>
  );
}
```

- [ ] **Step 4: Export from package index**

In `packages/bridge/src/index.ts`, add:

```ts
export { TurnCountdown, useTurnDeadline } from "./play-deadline";
```

(Match the existing alphabetical / grouping convention in that file.)

- [ ] **Step 5: Run tests + typecheck**

Run: `bun run --filter @openturn/bridge test && bun run --filter @openturn/bridge typecheck`

Expected: All new tests PASS; existing tests PASS; typecheck PASS.

If a hook test fails because `useSyncExternalStore` doesn't behave well under fake timers, fall back to the simpler `useState` + manual subscribe pattern:

```ts
const [deadline, setDeadlineState] = useState<number | null>(host.deadline);
useEffect(() => {
  setDeadlineState(host.deadline);
  return host.on("deadline-changed", (e) => setDeadlineState(e.deadline));
}, [host]);
```

(Either pattern works; `useSyncExternalStore` is the conventional React 18 path.)

- [ ] **Step 6: Commit**

```bash
git add packages/bridge/src/play-deadline.tsx packages/bridge/src/play-deadline.test.tsx packages/bridge/src/index.ts
git commit -m "bridge: useTurnDeadline hook + TurnCountdown default component"
```

---

## Task 5: Auto-mount `<TurnCountdown>` in `<PlayShell>`

**Files:**
- Modify: `packages/bridge/src/shell.tsx`

- [ ] **Step 1: Add `showTurnCountdown?` prop to `PlayShellProps`**

In `packages/bridge/src/shell.tsx:25-35`, update the props interface:

```ts
export interface PlayShellProps {
  host: BridgeHost;
  gameName: string;
  toolbarLead?: ReactNode;
  toolbarTrail?: ReactNode;
  iframeTitle?: string;
  iframeSandbox?: string;
  iframeAllow?: string;
  className?: string;
  toolbarClassName?: string;
  /**
   * When true (default), `<PlayShell>` auto-mounts `<TurnCountdown host={host}>`
   * inside the toolbar trail. Set to false to suppress (e.g., when the
   * embedder relocates the countdown elsewhere via `<TurnCountdown>` directly).
   */
  showTurnCountdown?: boolean;
}
```

- [ ] **Step 2: Mount `<TurnCountdown>` in the toolbar trail**

Update the destructure and toolbar JSX in the same file:

```tsx
import { TurnCountdown } from "./play-deadline";
// ...

export function PlayShell({
  host,
  gameName,
  toolbarLead,
  toolbarTrail,
  iframeTitle,
  iframeSandbox,
  iframeAllow,
  className,
  toolbarClassName,
  showTurnCountdown = true,
}: PlayShellProps) {
  return (
    <div
      className={
        className ??
        "flex h-dvh min-h-0 flex-col bg-white text-slate-900 dark:bg-slate-950 dark:text-slate-100"
      }
    >
      <div
        className={
          toolbarClassName ??
          "flex flex-none flex-wrap items-center gap-x-3 gap-y-2 border-b border-slate-200 bg-white/80 px-4 py-2 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-950/80 dark:text-slate-400"
        }
      >
        <strong className="text-slate-900 dark:text-slate-100">{gameName}</strong>
        {toolbarLead}
        <div className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-3">
          {showTurnCountdown ? <TurnCountdown host={host} /> : null}
          {toolbarTrail}
        </div>
      </div>
      <div className="min-h-0 flex-1">
        <BridgeIframe
          host={host}
          title={iframeTitle ?? gameName}
          {...(iframeSandbox === undefined ? {} : { sandbox: iframeSandbox })}
          {...(iframeAllow === undefined ? {} : { allow: iframeAllow })}
        />
      </div>
    </div>
  );
}
```

(Note: the existing `gap-1` on the trail was tightened — bumped to `gap-3` to give the countdown breathing room. If existing tests assert on `gap-1` exactly, revert to `gap-1` and accept a slightly tighter layout, or update the test.)

- [ ] **Step 3: Run tests + typecheck**

Run: `bun run --filter @openturn/bridge test && bun run --filter @openturn/bridge typecheck`

Expected: PASS. If a `<PlayShell>`-level test asserts on toolbar children, update the expected children to include the countdown.

- [ ] **Step 4: Commit**

```bash
git add packages/bridge/src/shell.tsx
git commit -m "bridge: auto-mount TurnCountdown in PlayShell toolbar trail"
```

---

## Task 6: In-iframe `useTurnDeadline()` hook in `@openturn/react`

**Files:**
- Modify: `packages/react/src/index.tsx`
- Test: `packages/react/src/index.test.tsx` (or create a sibling `use-turn-deadline.test.tsx`)

- [ ] **Step 1: Write failing tests**

Append to `packages/react/src/index.test.tsx` (read the file head for the test framework and import patterns first — likely `bun:test` or `vitest`; match what's there):

```ts
test("useTurnDeadline returns null deadline when match has none", () => {
  // Set up a tiny game with no state.deadline; mount OpenturnProvider; call useTurnDeadline.
  // Assert deadline === null, remainingMs === 0, isExpired === false.
  // (Use the existing test patterns in this file — `createOpenturnBindings` + a tiny game.)
});

test("useTurnDeadline returns the snapshot's controlMeta.deadline", () => {
  // Set up a game whose initial state declares deadline: now+30000.
  // Assert hook returns the deadline number.
});

test("useTurnDeadline ticks at 1Hz when remainingMs >= 5000", () => {
  // With fake timers, advance 1s; assert remainingMs decreases by 1000.
});

test("useTurnDeadline ramps to 10Hz when remainingMs < 5000", () => {
  // With fake timers and a 4.5s deadline, advance 100ms; assert remainingMs decreased by 100.
});
```

(The exact assertions depend on the test framework + existing test scaffolding in this file. Read `packages/react/src/index.test.tsx` head to find: framework, helper patterns for mounting `<OpenturnProvider>` with a tiny game, fake-timer usage. Adapt the templates above to the actual idioms.)

- [ ] **Step 2: Run tests to verify failure**

Run: `bun run --filter @openturn/react test`

Expected: FAIL — `useTurnDeadline` not exported.

- [ ] **Step 3: Add `useTurnDeadline` to `@openturn/react`**

In `packages/react/src/index.tsx`, find `useMatch` (around line 796) and add the new hook nearby:

```tsx
export function useTurnDeadline(): {
  deadline: number | null;
  remainingMs: number;
  isExpired: boolean;
} {
  // The active match is exposed via useMatch(). Read controlMeta.deadline from
  // its current snapshot. The return shape mirrors `@openturn/bridge`'s
  // `useTurnDeadline(host)` — game authors get the same data wherever they're
  // reading from.
  const match = useMatch();
  const deadline = readMatchDeadline(match);

  const [remainingMs, setRemainingMs] = useState<number>(() =>
    deadline === null ? 0 : Math.max(0, deadline - Date.now()),
  );

  useEffect(() => {
    if (deadline === null) {
      setRemainingMs(0);
      return;
    }
    let handle: ReturnType<typeof setTimeout> | null = null;
    const tick = () => {
      const next = Math.max(0, deadline - Date.now());
      setRemainingMs(next);
      if (next === 0) return;
      const interval = next < 5_000 ? 100 : 1_000;
      handle = setTimeout(tick, interval);
    };
    tick();
    return () => {
      if (handle !== null) clearTimeout(handle);
    };
  }, [deadline]);

  return {
    deadline,
    remainingMs,
    isExpired: deadline !== null && remainingMs === 0,
  };
}

function readMatchDeadline(match: ReturnType<typeof useMatch>): number | null {
  // useMatch() returns a discriminated union (mode === "local" | "hosted").
  // Both shapes carry a snapshot whose meta.derived.controlMeta.deadline
  // exposes the current deadline. Returns null when no match is loaded yet
  // or the current state declares no deadline.
  const snapshot = (match as { snapshot?: { derived?: { controlMeta?: { deadline?: number | null } } } }).snapshot;
  return snapshot?.derived?.controlMeta?.deadline ?? null;
}
```

(The `readMatchDeadline` helper accommodates both `local` and `hosted` match shapes — both have a `snapshot` field with the same nested structure. If the actual `MatchView` discriminated union exposes `snapshot` differently, narrow accordingly.)

- [ ] **Step 4: Run tests + typecheck**

Run: `bun run --filter @openturn/react test && bun run --filter @openturn/react typecheck`

Expected: All new tests PASS; typecheck PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/react/src/index.tsx packages/react/src/index.test.tsx
git commit -m "react: useTurnDeadline hook for in-iframe consumers"
```

---

## Task 7: Wire `<OpenturnProvider>` to emit deadline changes via the bridge

**Files:**
- Modify: `packages/react/src/index.tsx`
- Test: `packages/react/src/index.test.tsx`

- [ ] **Step 1: Write failing tests**

Append to `packages/react/src/index.test.tsx`:

```ts
test("OpenturnProvider calls backend.setDeadline when the snapshot's controlMeta.deadline changes", () => {
  // Mount OpenturnProvider with a game whose initial state has deadline: T1.
  // Spy on the bridge's setDeadline.
  // Assert setDeadline was called with T1 once on mount.
  // Dispatch an event that transitions the state to one with deadline: T2.
  // Assert setDeadline was called with T2.
});

test("OpenturnProvider does not re-call setDeadline when the deadline doesn't change", () => {
  // Mount with a game whose state has deadline: T1.
  // Dispatch an event that transitions to a state still with deadline: T1.
  // Assert setDeadline was called once (not twice).
});

test("OpenturnProvider calls backend.setDeadline(null) on unmount", () => {
  // Mount, then unmount.
  // Assert setDeadline(null) was called as part of cleanup.
});
```

(Use the test idioms already in this file. The "spy on the bridge" pattern mirrors how existing tests verify `setMatchActive` is called — read the file for examples.)

- [ ] **Step 2: Run tests to verify failure**

Run: `bun run --filter @openturn/react test`

Expected: FAIL — no emission wiring yet.

- [ ] **Step 3: Wire emission inside `<OpenturnProvider>`**

In `packages/react/src/index.tsx:1476-1479`, find the existing `setMatchActive` effect. Add a parallel effect right after it:

```tsx
// Emit the current snapshot's controlMeta.deadline to the shell via the
// bridge whenever it changes. The bridge's iframe-side de-dupe means this is
// safe to call on every render; the message only goes out when the value
// changes. The shell's `<TurnCountdown>` reads via `host.deadline`.
const matchSnapshot = (gameMatch as { snapshot?: { derived?: { controlMeta?: { deadline?: number | null } } } }).snapshot;
const currentDeadline = matchSnapshot?.derived?.controlMeta?.deadline ?? null;
useEffect(() => {
  if (backend === null) return;
  backend.setDeadline(currentDeadline);
}, [backend, currentDeadline]);

useEffect(() => {
  return () => {
    if (backend !== null) backend.setDeadline(null);
  };
}, [backend]);
```

(Place these effects right after the existing `setMatchActive` effect block so the bridge-emission concerns live next to each other.)

- [ ] **Step 4: Run tests + typecheck**

Run: `bun run --filter @openturn/react test && bun run --filter @openturn/react typecheck`

Expected: All new tests PASS; existing tests PASS; typecheck PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/react/src/index.tsx packages/react/src/index.test.tsx
git commit -m "react: emit snapshot deadline through bridge on change"
```

---

## Task 8: Full-monorepo verification

**Files:** All modified files from Tasks 1-7.

- [ ] **Step 1: Run full typecheck**

From `openturn/` root: `bun run typecheck`

Expected: PASS for every workspace.

- [ ] **Step 2: Run full test suite**

From `openturn/` root: `bun run test`

Expected: PASS for every workspace.

- [ ] **Step 3: Spec checklist spot-check**

Manually verify against `superpowers/specs/2026-05-06-turn-countdown-ui-design.md`:

- [ ] §1 New `openturn:bridge:deadline` message variant in schema (Task 1)
- [ ] §2 `BridgeHost.deadline` readonly field + `deadline-changed` event with de-dupe (Task 2)
- [ ] §3 `GameBridge.setDeadline` method with iframe-side de-dupe (Task 3)
- [ ] §4 `<TurnCountdown>` returns null when deadline is null; renders `m:ss`; urgent class < 5s; `aria-label` set (Task 4)
- [ ] §4 `useTurnDeadline(host)` ticks at 1Hz, ramps to 10Hz under 5s, recomputes from `Date.now()` (Task 4)
- [ ] §5 `<PlayShell>` auto-mounts `<TurnCountdown>`; `showTurnCountdown` opts out (Task 5)
- [ ] §6 `useTurnDeadline()` in `@openturn/react` reads from `useMatch()` snapshot (Task 6)
- [ ] §3 `<OpenturnProvider>` calls `backend.setDeadline(...)` on snapshot deadline changes; `null` on unmount (Task 7)

- [ ] **Step 4: Commit any final integration fixes**

```bash
git add <modified files>
git commit -m "fix: <description of integration-level fix>"
```

If the suite was clean on the first try, no commit needed.

---

## Notes for the executing engineer

- **Read order:** spec → this plan → existing `bridge.test.ts` (for the `setMatchActive` round-trip pattern that this slice mirrors).
- **The de-dupe is load-bearing.** Both iframe-side (`game.setDeadline`) and host-side dedup independently. Without iframe-side dedup, every snapshot pushes a bridge message even when the deadline didn't change. Without host-side dedup, every received message fires `deadline-changed` even on idempotent input. Both layers are cheap; both stay.
- **Ticker pattern is shared.** Tasks 4 and 6 each implement essentially the same ticker. If you want to factor a shared `useDeadlineTicker(deadline: number | null)` helper, fine — but `@openturn/bridge` and `@openturn/react` don't currently share a deps package. The 30-line hook can live in both without churn. Pragmatism over DRY for v1.
- **Tab-visibility / browser throttling**: handled implicitly by recomputing `remainingMs = max(0, deadline - Date.now())` on each tick (rather than decrementing a stored counter). No special API calls needed.
- **What happens BEFORE the iframe boots**: the host's `deadline` starts as `null`. The countdown stays hidden until the iframe's first `setDeadline` arrives. This matches the existing `matchActive` pattern.
- **Slice B integration**: when the server fires a timeout, the new snapshot has either a fresh `controlMeta.deadline` (next state) or `null` (terminal). `<OpenturnProvider>`'s effect picks up the change, `setDeadline(...)` propagates, and the countdown re-renders. No extra wiring needed for the server-fired-timeout case.

---

## Self-review notes

Cross-checked against the spec:

- **Spec coverage:** Every section maps to at least one task. Task 8's spot-check enumerates them.
- **Placeholder scan:** No TBDs. The "if `useSyncExternalStore` doesn't behave well under fake timers, fall back to..." note in Task 4 is real engineering guidance, not a placeholder.
- **Type consistency:** `host.deadline`, `BridgeHost.deadline`, `setDeadline(deadline: number | null)`, `useTurnDeadline(host)` / `useTurnDeadline()`, `{ deadline, remainingMs, isExpired }` — all spelled identically across tasks.
- **Test coverage:** TDD for the load-bearing pieces — schema (Task 1), host receive (Task 2), game emit (Task 3), shell hook + component (Task 4), iframe hook (Task 6), provider emission (Task 7). Tasks 5 and 8 are integration / verification and don't add new TDD.
