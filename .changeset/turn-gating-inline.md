---
"@openturn/gamekit": minor
"@openturn/plugins": minor
"@openturn/cli": minor
---

Remove move-level `canPlayer` predicates from gamekit and plugin move definitions. Turn-based gating now relies on the engine's `activePlayers` dispatch gate for standard round-robin turns, and games or plugins with custom rules should reject from `run` with `move.invalid(...)` or a plugin invalid outcome.

Update `openturn create` starters from the counter demo to a styled tic-tac-toe game, including Tailwind CSS setup and multiplayer room UI.
