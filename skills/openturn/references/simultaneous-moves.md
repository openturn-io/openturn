# Simultaneous moves reference

Openturn doesn't have a separate "simultaneous-moves API." The pattern is: declare a phase whose `activePlayers` returns every player who hasn't yet acted, store partial submissions in `G`, and use `move.stay` to wait. The last submitter resolves the round.

## The pattern

Three required pieces:

1. **`G` holds partial submissions per player**, e.g. `submissions: PlayerRecord<Players, Choice | null>` initialized to all `null`. Use `roster.record(match, null)` from `@openturn/core` to build it (same shape as pig-dice's `roster.record(match, 0)` for scores).

2. **A phase whose `activePlayers` filters to "not yet submitted":**

   ```ts
   phases: {
     plan: {
       activePlayers: ({ G }) => PLAYERS.filter((id) => G.submissions[id] === null),
     },
   },
   ```

3. **A move that uses `move.stay` while submissions are pending and `move.endTurn` to resolve when all players have submitted:**

   ```ts
   submitChoice: move<Choice>({
     run({ G, args, move, player }) {
       const submissions = { ...G.submissions, [player.id]: args };
       const stillPending = PLAYERS.filter((id) => submissions[id] === null);
       if (stillPending.length > 0) return move.stay({ submissions });
       // last submitter resolves the round
       return move.endTurn({ /* compute result, reset submissions */ });
     },
   }),
   ```

## Why activePlayers filters dynamically

Each dispatch re-evaluates `activePlayers` against the new `G`. Once a player submits, their seat is removed from the active set, so the engine won't accept further dispatches from them in this phase. This is what makes the simultaneous semantic work without a separate API — it's just `activePlayers` reading the same partial-submissions field the move writes.

## Hidden submissions

Pair this with `views.player` so each player only sees their own submission until the round resolves; the public view exposes just a count (or nothing) for the in-flight choices. See `views.md` "sealed bids" pattern.

## Resolving the round

- Compute the round result from the complete `submissions` set.
- Reset `submissions` to all `null` in the patch you pass to `move.endTurn` (or `move.goto` if you're advancing phases).
- Update score / state in the same patch — one move dispatch should land the entire round transition.

## See also

- `examples/simultaneous-moves/paper-scissors-rock/game/src/index.ts` — canonical example.
- https://openturn.io/docs/how-to/handle-simultaneous-moves
- `views.md` for hiding pending submissions.
