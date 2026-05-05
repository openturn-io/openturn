---
"@openturn/cli": minor
"@openturn/core": minor
"@openturn/lobby": minor
"@openturn/replay": minor
"@openturn/server": minor
---

Add `MatchInput.hostPlayerID` as the seated player who hosted the lobby that started a match, with `null` for single-player matches, spectating hosts, or absent hosts. The core runtime now normalizes and validates the field, exposes `isHost`, and threads the value into game setup and snapshots.

Lobby and server start flows now resolve the host player ID at `lobby:start`, persist it into room metadata, and pass it into the running game match in both hosted worker and local CLI runtimes. Replay parsing now preserves and validates `hostPlayerID` from saved match envelopes.
