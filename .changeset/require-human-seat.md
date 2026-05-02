---
"@openturn/protocol": minor
"@openturn/server": minor
"@openturn/lobby": minor
"@openturn/cli": patch
---

Add `LobbyEnv.requireHumanSeat` so hosted lobbies reject all-bot starts with the new `no_humans_seated` rejection reason; the cloud worker enables it by default. The CLI dev server keeps it off so authors can dry-run bot-vs-bot matches: when the host starts a room with only bot seats, the dev server mints them a game token bound to seat 0's playerID and transitions them straight into the running match so they can watch the bots play out the game. (The host technically connects as player 0 — they shouldn't dispatch during a bot-vs-bot watch, but cloud doesn't expose this path.)
