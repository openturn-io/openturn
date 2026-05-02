---
"@openturn/bridge": patch
---

Force the play shell iframe to remount when the bridge host changes by keying it on `host.src`. Browsers don't reload an iframe on hash-only `src` updates, so without the key the bundle would keep running with stale init after `returnToLobby` (game→lobby) instead of re-reading the fresh fragment.
