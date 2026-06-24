---
"@openturn/core": minor
---

Add a `suspicious_player_view_identity` validation warning that fires when a game defines `views.player` but its result does not echo the viewer's seat as `myPlayerID`. A missing `myPlayerID` is the most common cause of a silently-frozen hosted UI (the board renders but the human is never prompted to act, while bots keep playing). This is a warning, not an error — games whose UI keys off `match.canAct` / `activePlayers` instead of `view.myPlayerID` can legitimately omit it, and the diagnostic hint names both paths.
