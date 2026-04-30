---
"@openturn/cli": patch
---

Fix `openturn dev` exiting immediately after startup when telemetry is enabled. The dev command now waits for SIGINT/SIGTERM and stops the server cleanly on shutdown.
