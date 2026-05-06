# Turn-Timer Countdown UI — Design

**Date:** 2026-05-06
**Status:** Approved for implementation
**Scope:** Follow-up to Slice B (turn timer enforcement, just merged on this branch). Pure UI / data-flow work — no engine changes.

## Goal

Show a server-authoritative live countdown in the play shell so players always know how much time they have left, and expose a hook game authors can use to drive their own in-game UI (urgent flashes, "5s left!" alerts, animated displays). Both the CLI dev shell and the cloud play page get the countdown for free; game authors who want richer treatment use the in-iframe hook.

## Non-Goals

- Per-game shell countdown styling (use the in-iframe hook for that).
- Server-client clock-skew compensation.
- Pre-deadline notifications, sounds, or browser-level alerts.
- Spectator-only / read-only differential displays.
- Lobby-phase countdowns (lobby has no `controlMeta.deadline`).

## Architecture — two surfaces

The play shell (in `@openturn/bridge`) is the parent React tree wrapping the game iframe; the game's React tree runs **inside** the iframe. They communicate exclusively via typed `postMessage` (the bridge protocol).

| Surface | Lives in | Audience | What it shows |
|---|---|---|---|
| Shell countdown | `@openturn/bridge` (`<PlayShell>`) | Always-visible, game-agnostic, used by CLI dev shell + cloud play page | Compact `0:30` in toolbar trail |
| In-iframe hook | `@openturn/react` | Game authors who want custom UI inside the game iframe | Same data, game's choice of rendering |

Both surfaces share the same data shape and update cadence:

```ts
{
  deadline: number | null;   // wall-clock instant in ms (server's clock); null when no deadline active
  remainingMs: number;       // max(0, deadline - Date.now()); 0 when null deadline
  isExpired: boolean;        // deadline !== null && remainingMs === 0
}
```

Update cadence: 1 Hz baseline, ramping to 10 Hz when `remainingMs < 5_000`. Each tick recomputes `remainingMs` from `Date.now()` (no manual decrement) — this self-corrects after tab-throttling without special handling.

## 1. Bridge protocol additions

New iframe → host message in `packages/bridge/src/schema.ts`:

```ts
z.object({
  kind: z.literal("openturn:bridge:deadline"),
  deadline: z.number().nullable(),
}),
```

Wall-clock instant in milliseconds (server's clock), or `null` when no active deadline.

**Emitted only when the deadline value changes**, not on every tick. Wall-clock ticking is purely client-side in the shell. The bridge contract: "tell me when the deadline changes; I'll handle the seconds-counter myself."

## 2. BridgeHost API additions

`packages/bridge/src/host.ts` gains a parallel of the existing `matchActive` pattern:

```ts
export type BridgeHostEventMap = {
  ready: { origin: string };
  "lifecycle-close": Record<string, never>;
  "match-state-changed": { matchActive: boolean };
  "deadline-changed": { deadline: number | null };  // NEW
};

export interface BridgeHost {
  // ...existing fields...
  /**
   * Current turn deadline as a wall-clock millisecond instant (server's clock),
   * or null when no active deadline. Updated by `openturn:bridge:deadline`
   * messages from the game iframe. Subscribe via `on("deadline-changed", ...)`
   * to react.
   */
  readonly deadline: number | null;
}
```

The host's internal state machine handles the message:

- Receive `openturn:bridge:deadline` → update internal `deadline` field → if value changed vs. previous, emit `deadline-changed` event.
- De-dupe: receiving the same deadline twice fires the event once. (Implementation: simple `lastEmitted` ref; emit when current !== lastEmitted.)

## 3. Game-side emission

`packages/bridge/src/game.ts` gains a parallel to `setMatchActive`:

```ts
export interface BridgeGame {
  // ...existing methods...
  setDeadline(deadline: number | null): void;
}
```

Where in the iframe does this get called? In `@openturn/react`'s match-state subscription path — the same place that already calls `bridgeGame.setMatchActive(...)` when the match active flag flips. Right next to that, observe `snapshot.derived.controlMeta.deadline`; on change, call `bridgeGame.setDeadline(deadline)`.

De-dupe at the iframe side too: only call `setDeadline` when the value differs from the last call. This mirrors the host-side de-dupe and keeps the bridge channel quiet during normal gameplay (one message per actual deadline change, not one per snapshot).

If the iframe's React tree is unmounted (game tab closed, etc.), the cleanup path should call `setDeadline(null)` to clear the host's view. Same hygiene as `setMatchActive(false)`.

## 4. Shell-side hook + default component

A new file `packages/bridge/src/play-deadline.tsx` contains the hook and component (kept separate from `play.tsx` so the shell-vs-runtime split is clear).

### Hook

```ts
export function useTurnDeadline(host: BridgeHost): {
  deadline: number | null;
  remainingMs: number;
  isExpired: boolean;
};
```

Implementation outline:

1. Track `deadline` via `useSyncExternalStore` (subscribe via `host.on("deadline-changed", ...)`; getSnapshot returns `host.deadline`).
2. Track `remainingMs` via `useState` + `useEffect`.
3. The effect runs on every `deadline` change. If `deadline === null`, set `remainingMs = 0` and clear any timer.
4. If `deadline !== null`, set up a tick:
   - First, immediately compute `remainingMs = max(0, deadline - Date.now())`.
   - Schedule the next tick via `setTimeout`. The interval is 1000 ms when `remainingMs >= 5000`, otherwise 100 ms.
   - On each tick: recompute `remainingMs`, then re-schedule with the appropriate interval (so the cadence ramps up automatically once `remainingMs` crosses 5s).
   - When `remainingMs === 0`, stop ticking (don't re-schedule). The next deadline change re-starts the loop.
5. Return `{ deadline, remainingMs, isExpired: deadline !== null && remainingMs === 0 }`.

`setTimeout`-based scheduling (not `setInterval`) lets the cadence change inline without clearing/recreating an interval. It also self-aligns to `Date.now()` so tab-visibility throttling doesn't drift.

### Default component

```tsx
export function TurnCountdown({ host }: { host: BridgeHost }): ReactNode {
  const { deadline, remainingMs, isExpired } = useTurnDeadline(host);
  if (deadline === null) return null;
  const urgent = remainingMs < 5_000;
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

`Math.ceil` on `remainingMs / 1000` ensures the display shows whole seconds — `0.99s` displays as `0:01`, not `0:00`. The display reaches `0:00` only at the exact deadline (or after).

When `deadline === null` the component returns `null` — no DOM, no chrome flickering when transitioning between phases that have / don't have deadlines.

## 5. Shell auto-mount

`<PlayShell>` mounts `<TurnCountdown>` automatically inside the toolbar trail, before any `toolbarTrail` content the embedder passed:

```tsx
// inside packages/bridge/src/shell.tsx
<div className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-3">
  <TurnCountdown host={host} />
  {toolbarTrail}
</div>
```

(`gap-3` instead of the existing `gap-1` to give the countdown breathing room; can be tuned during implementation.)

Why automatic: the user-facing requirement is "the app shell should show the count down" — embedders shouldn't have to wire it up per game. Both `<PlayPage>` (cloud play page) and the CLI dev shell mount `<PlayShell>` and inherit the countdown for free.

Embedders who want to suppress the default get an opt-out:

```tsx
export interface PlayShellProps {
  // ...existing props...
  /** Default true. Set false to suppress the auto-mounted turn countdown. */
  showTurnCountdown?: boolean;
}
```

When `false`, the component is not rendered. Embedders who want to relocate the countdown can mount `<TurnCountdown host={host}>` themselves anywhere in their tree.

## 6. In-iframe React hook

`@openturn/react` (`packages/react/src/index.tsx`, near `useMatch` / `useRoom`) gains:

```ts
export function useTurnDeadline(): {
  deadline: number | null;
  remainingMs: number;
  isExpired: boolean;
};
```

Implementation:

1. Read `match.snapshot.derived.controlMeta.deadline` via `useMatch()` (which already subscribes to snapshot changes and re-renders).
2. Apply the same 1Hz/10Hz `setTimeout` ticking pattern as the shell-side hook (the logic is identical aside from where `deadline` is sourced from).
3. Return the same `{ deadline, remainingMs, isExpired }` shape.

The two hooks (shell + iframe) share so much logic that the implementer should factor a `useDeadlineTicker(deadline: number | null)` helper used by both. The shell hook wires `deadline` from `host`; the iframe hook wires `deadline` from `useMatch`. Helper lives wherever DRY allows; one option is a tiny new internal package or a shared util in `@openturn/core`.

(If sharing across packages is awkward — `@openturn/bridge` and `@openturn/react` don't currently have a shared dep — copy-paste the ~30 lines twice. Cheap; both copies stay obviously similar.)

### Game-author usage

```tsx
import { useTurnDeadline } from "@openturn/react";

function MyGameUrgentBanner() {
  const { deadline, remainingMs, isExpired } = useTurnDeadline();
  if (deadline === null) return null;
  if (isExpired) return <BigRedFlash>Time's up — random move incoming!</BigRedFlash>;
  if (remainingMs < 10_000) return <Pulse>{(remainingMs / 1000).toFixed(1)}s</Pulse>;
  return null;
}
```

## 7. Edge cases (locked behaviors)

| Case | Behavior |
|---|---|
| Game has no `state.deadline` declared | `controlMeta.deadline` is null; iframe emits `setDeadline(null)`; `host.deadline` is null; `<TurnCountdown>` returns null; `useTurnDeadline()` returns `{ deadline: null, remainingMs: 0, isExpired: false }` |
| Game in lobby phase (no active match) | Same as above — the iframe React tree may not yet be mounted, but the host's deadline starts as null, so the countdown is hidden until the game emits |
| Tab backgrounded mid-turn | Browser throttles `setTimeout`; on foregrounding, the next tick recomputes from `Date.now()` and snaps to the correct value. No drift handling needed. |
| Server fires timeout transition | Server applies the timeout transition (per Slice B), emits a new snapshot with a new `controlMeta.deadline` (or null) → iframe sees the snapshot change → emits `setDeadline(newDeadline)` → host fires `deadline-changed` → countdown updates. ~1 round-trip-time of UI lag, acceptable. |
| Client clock ahead of server's | Countdown reaches `0:00` before server fires the timeout. Display stays at `0:00` (with the "⏱" indicator). When the server eventually fires, a new snapshot arrives and the counter resets. No misleading "+0:01". |
| Client clock behind server's | Countdown reaches `0:00` after the server fires. The server's snapshot arrives first; the new deadline (or null) replaces the old one before the local timer would have hit zero. Counter never overshoots. |
| Deadline duration changes mid-turn (e.g., a state config function reads from G) | Uncommon but legal: the iframe sees a new `controlMeta.deadline`, emits `setDeadline(newValue)`, countdown re-targets. |
| Multiple deadline changes in rapid succession | Iframe-side and host-side de-dupe by value — only the changes actually observed propagate. |
| `<PlayShell>` unmounts mid-turn | Hook cleanup clears the timer. No leaked setTimeout. |

## 8. Tests

### Bridge protocol (`packages/bridge/src/schema.test.ts`)

- New `openturn:bridge:deadline` message parses with a number value.
- New `openturn:bridge:deadline` message parses with a null value.
- Out-of-band `kind` is rejected.

### BridgeHost (`packages/bridge/src/bridge.test.ts`)

- `host.deadline` starts as `null`.
- After receiving `openturn:bridge:deadline` with a number, `host.deadline` updates and `deadline-changed` fires once.
- Receiving the same value again does not fire a second `deadline-changed`.
- Receiving a different value fires `deadline-changed` once with the new value.
- Receiving `null` after a number clears `host.deadline` and fires `deadline-changed` with `{ deadline: null }`.

### BridgeGame (`packages/bridge/src/bridge.test.ts`)

- `bridgeGame.setDeadline(t)` posts a message; round-trip arrives at host's `deadline-changed` with the same value.
- Calling `setDeadline(t)` twice with the same value emits one bridge message (iframe-side de-dupe).

### Shell hook + component (`packages/bridge/src/play-deadline.test.tsx`)

Use `vitest` fake timers + `@testing-library/react`:

- `useTurnDeadline(host)` returns `null` deadline + 0 remainingMs initially.
- After host receives a deadline 30 s in the future, hook updates synchronously.
- Advance 1000 ms via fake timers → `remainingMs` decreases by 1000 ± tolerance; cadence is 1 s.
- Advance to 4900 ms remaining → next tick fires within 100 ms (cadence ramped up).
- When `remainingMs` hits 0, hook stops ticking; `isExpired` is true.
- Hook unmounts cleanly without leaked timers (assert via fake-timer pendingCount).
- `<TurnCountdown host={host}>` renders nothing when deadline is null.
- Renders `0:30` for 30 s remaining; `0:05` for 5 s; `0:00 ⏱` when expired.
- Adds the urgent text-red class when remaining < 5 s.
- `aria-label="Turn time remaining"` is present.

### Shell mount (`packages/bridge/src/play.test.tsx` or shell.test)

- `<PlayShell host={host}>` renders `<TurnCountdown>` in the toolbar trail by default.
- `<PlayShell host={host} showTurnCountdown={false}>` does NOT render the countdown.

### In-iframe hook (`packages/react/src/index.test.tsx`)

- `useTurnDeadline()` returns deadline from current match snapshot.
- Advances correctly with fake timers (mirrors shell-side hook tests).
- Returns null deadline when state declares none.

### Wiring inside `<OpenturnProvider>` (`packages/react/src/index.test.tsx`)

- When the provider mounts and the snapshot has a deadline, `bridgeGame.setDeadline(deadline)` is called once.
- When a snapshot transition changes the deadline, `setDeadline` is called with the new value.
- Identical-deadline snapshots (e.g., two events that don't change phase) do NOT re-call `setDeadline`.
- On unmount, `setDeadline(null)` is called to clear the host's view.

## 9. Implementation surface

| File | Change |
|---|---|
| `packages/bridge/src/schema.ts` | Add `openturn:bridge:deadline` message variant. |
| `packages/bridge/src/host.ts` | Add `host.deadline` field, `deadline-changed` event, message handler with de-dupe. |
| `packages/bridge/src/game.ts` | Add `setDeadline(deadline)` method that posts the message; iframe-side de-dupe. |
| `packages/bridge/src/play-deadline.tsx` (NEW) | `useTurnDeadline(host)` hook + `<TurnCountdown>` component. |
| `packages/bridge/src/play-deadline.test.tsx` (NEW) | Hook + component tests with fake timers. |
| `packages/bridge/src/shell.tsx` | Mount `<TurnCountdown host={host} />` inside the toolbar trail. Add `showTurnCountdown?: boolean` prop. |
| `packages/bridge/src/play.tsx` | Pass `showTurnCountdown` through `<PlayPage>` if the embedder supplies it (or just rely on the shell-level default). |
| `packages/bridge/src/index.ts` | Export the new public hook + component. |
| `packages/bridge/src/bridge.test.ts` | E2E round-trip test for the new message + event. |
| `packages/bridge/src/schema.test.ts` | Schema parse tests. |
| `packages/react/src/index.tsx` | Add `useTurnDeadline()` (in-iframe variant). Wire `<OpenturnProvider>` to call `bridgeGame.setDeadline(...)` on snapshot deadline changes. |
| `packages/react/src/index.test.tsx` | Hook test + provider-emission test. |
| `packages/cli/dist/play-app/main.js` | No change — picks up the auto-mounted countdown via `<PlayPage>` → `<PlayShell>` chain. |
| `openturn-cloud/src/...` (cloud play page consumer) | No change — same reason. |

The change is type-additive at every public surface. Existing games that don't declare deadlines see no behavior change (the bridge fires `setDeadline(null)` once at startup; the countdown stays hidden).

## 10. Out of scope (re-stated)

- Server-client clock-skew compensation
- Pre-deadline notifications, sounds, browser notifications
- Per-game shell theming for the countdown (use the in-iframe hook)
- Spectator-only / read-only differential displays
- Lobby-phase deadlines (lobby has no `controlMeta.deadline` today)
- Tournament-style match timers (different mechanism; not part of turn timeout)
