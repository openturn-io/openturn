---
"@openturn/protocol": minor
"@openturn/server": minor
"@openturn/lobby": minor
"@openturn/cli": patch
---

Add `LobbyEnv.requireHumanSeat` so hosted lobbies reject all-bot starts with the new `no_humans_seated` rejection reason; the cloud worker enables it by default. The CLI dev server keeps it off so authors can dry-run bot-vs-bot matches, and no longer closes the host's lobby socket when every seat is a bot — the host stays connected and the lobby surfaces `phase=active` instead of "room closed".
