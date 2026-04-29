---
"@openturn/bot": patch
"@openturn/bridge": patch
"@openturn/cli": patch
"@openturn/client": patch
"@openturn/core": patch
"@openturn/deploy": patch
"@openturn/gamekit": patch
"@openturn/inspector": patch
"@openturn/inspector-ui": patch
"@openturn/json": patch
"@openturn/lobby": patch
"@openturn/manifest": patch
"@openturn/plugin-chat": patch
"@openturn/plugins": patch
"@openturn/protocol": patch
"@openturn/react": patch
"@openturn/replay": patch
"@openturn/server": patch
---

Replace `workspace:*` internal dependencies with concrete `^X.Y.Z` ranges so published tarballs install cleanly outside the monorepo. The 0.1.0 release shipped `workspace:*` literals into the npm registry, breaking external consumers.
