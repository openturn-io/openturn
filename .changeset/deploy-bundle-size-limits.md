---
"@openturn/manifest": minor
"@openturn/deploy": minor
"@openturn/cli": minor
---

Add bundle size limits and image asset support for `openturn deploy`. The CLI now (a) enables Vite's `public/` folder so static images can ship alongside imported assets, (b) records per-asset sizes in the deployment manifest, and (c) rejects oversized bundles before contacting the cloud (per-asset 25 MiB, total assets 25 MiB, total images 25 MiB, multiplayer worker 3 MiB gzipped). The cloud control plane re-validates the same limits as defense in depth.
