---
"@openturn/bridge": minor
"@openturn/lobby": minor
"@openturn/inspector-ui": minor
---

Fix same-tab play shell theme propagation so embedded dev bars and inspector chrome follow the selected dark theme, and keep the lobby React chrome fixed instead of accepting consumer skinning props (`Lobby` no longer accepts `className` or `renderSeat` — use `LobbyWithBots` for the bot-aware variant).
