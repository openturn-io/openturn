---
"@openturn/bridge": minor
"@openturn/react": minor
---

Add a server-authoritative turn-timer countdown to the play shell, plus a hook for game authors who want custom in-iframe UI.

`<PlayShell>` (used by both the CLI dev shell and the cloud play page) auto-mounts a compact `<TurnCountdown>` in its toolbar trail. The countdown shows `m:ss` with an urgent red state when remaining time is under 5 seconds and is hidden entirely when no deadline is active. Embedders can suppress it with `showTurnCountdown={false}` and mount `<TurnCountdown host={host}>` themselves elsewhere.

A new bridge protocol message `openturn:bridge:deadline` propagates the current `controlMeta.deadline` from the game iframe to the shell. `BridgeHost` gains a `deadline: number | null` readonly field and a `deadline-changed` event with de-dupe (mirrors the existing `matchActive` / `match-state-changed` pattern). `GameBridge.setDeadline(deadline)` is the iframe-side emit method; `<OpenturnProvider>` in `@openturn/react` calls it whenever the snapshot's `controlMeta.deadline` changes (de-duped at both ends so unchanged values don't churn the bridge channel).

For game authors writing custom in-iframe UI (urgent flashes, "5s left!" alerts, animated displays), `useTurnDeadline()` in `@openturn/react` returns `{ deadline, remainingMs, isExpired }` derived from `useMatch()`'s current snapshot. The shell-side equivalent `useTurnDeadline(host)` in `@openturn/bridge` returns the same shape from a `BridgeHost`. Both hooks tick at 1 Hz baseline, ramping to 10 Hz when remaining time drops below 5 seconds; each tick recomputes from `Date.now()` so tab-visibility throttling self-corrects on foreground.
