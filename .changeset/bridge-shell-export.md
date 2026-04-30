---
"@openturn/bridge": minor
---

Add `@openturn/bridge/shell` entry point that exports `PlayShell`, the React component used to host a deployed bundle in a browser shell. The package now declares `react@^19.2.0` as an optional peer dependency, so existing non-React consumers (`/host`, `/game`) are unaffected.
