---
"@openturn/server": patch
---

Rehydrate cloud-hosted bot drivers from persisted active lobby seats whenever a game message arrives without an in-memory driver — both after Durable Object hibernation and on first message after `loadLobby`. Also exports `resolveBotMapFromSeats` and `BotSeatRecordShape` for callers that need to derive a bot map from persisted seats.
