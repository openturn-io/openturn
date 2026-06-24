---
"@openturn/example-modern-art-v2-game": patch
---

Fix `invalid_event` stall when the turn timeout fires mid-auction in Modern Art v2.

The phase `onTimeout` enumerated legal actions for `pendingBidders[0]` but dispatched them as the round-robin auctioneer (`ctx.player.id`) — a different seat whenever a bid was in flight — so every move hit the `not_your_bid`/`not_your_turn_to_pass` guard and returned `invalid_event`, logging `[openturn:fireTimeout] timeout dispatch failed at state "play": invalid_event` and freezing the game. With 5 collector bots and the 60s clock, any stalled seat tripped it.

`onTimeout` now branches: when no auction is in flight it dispatches a real move for the auctioneer as before; when an auction is in flight it bypasses the player-bound move path entirely and auto-passes the stalled head bidder directly via a raw MoveOutcome, reusing the existing per-type pass/decline/sealed resolution logic (extracted into pure `{ state, finish }` helpers).
