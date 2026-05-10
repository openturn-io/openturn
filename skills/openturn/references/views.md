# Views reference

Views decide what each audience sees. `views.public` is for spectators; `views.player` is for the player at a specific seat. The server only sends each audience their view — never raw `G`. **Hidden information lives inside `G`** and the views strip it out.

## Signatures

```ts
views: {
  public?: ({ G, C, phase, turn }) => TPublic,
  player?: ({ G, C, phase, turn }, { id }) => TPlayer,
}
```

The first-arg context (`ViewContext`) is identical for both callbacks: `G` is the full author state (deep-readonly), `C` is computed values, `phase` is the current phase, `turn` is the turn context. The `player` callback also receives `{ id }` — the seat the view is being rendered for.

## Defaults

- If `views.public` is omitted, the full `G` is returned as the public view. **For any game with hidden state, define `views.public` explicitly.**
- If `views.player` is omitted, **the runner returns the full `G` to every player** — *not* the public view. So defining `views.public` alone is not enough to hide state from players: forgetting `views.player` leaks every secret. **For any game with hidden state, always define both `views.public` and `views.player`.**

## Pattern: hand of cards

`G` holds every hand. `views.public` exposes only sizes; `views.player` exposes the caller's hand plus everything in the public shape. Factor a helper so the public projection is defined once:

```ts
type State = { deck: Card[]; hands: Record<PlayerID, Card[]>; discard: Card[] };

// Helper takes the same context shape as views.public — TS infers it.
const publicView = (ctx: { G: DeepReadonly<State> }) => ({
  handSizes: Object.fromEntries(Object.entries(ctx.G.hands).map(([id, h]) => [id, h.length])),
  discard: ctx.G.discard,
  deckSize: ctx.G.deck.length,
});

views: {
  public: publicView,
  player: (ctx, { id }) => ({
    ...publicView(ctx),
    myHand: ctx.G.hands[id] ?? [],
  }),
}
// Note: inside views, G is typed `DeepReadonly<GamekitAuthorState<State>>`. The
// destructure above narrows it structurally — both calls of `publicView` work
// because TS accepts narrower parameter shapes.
```

## Pattern: fog of war

`G.tiles` is the full map; each player only sees tiles their units can observe. `visibleTo(id, tile)` is your visibility predicate.

```ts
views: {
  public: () => ({ visibleTiles: [] }), // spectators see nothing
  player: ({ G }, { id }) => ({
    visibleTiles: G.tiles.filter((t) => visibleTo(id, t)),
  }),
}
```

## Pattern: sealed bids

`G.bids` is `Record<PlayerID, number | null>`. Public viewers learn *who* has bid, never *what*. Each player learns their own bid.

```ts
const publicView = ({ G }: { G: DeepReadonly<{ bids: Record<PlayerID, number | null> }> }) => ({
  playersWhoBid: Object.entries(G.bids).filter(([, b]) => b !== null).map(([id]) => id),
});

views: {
  public: publicView,
  player: (ctx, { id }) => ({ ...publicView(ctx), myBid: ctx.G.bids[id] ?? null }),
}
```

## Anti-pattern: reading `derived` inside views

View contexts expose computed values as **`C`**, not `derived`. The `derived` field exists on rule contexts (`legalActions`, `phases.activePlayers`, etc.) and on raw snapshots — it is **not** available inside `views.public` or `views.player`. This trips up authors who copy a `derived.X` reference from a rule context into a view, since the symbol is named differently in each layer.

```ts
// ❌ Throws "Cannot read property X of undefined" at view evaluation time.
views: {
  public: ({ G, derived }) => ({ winner: derived.winner }),
}

// ✅ Use C inside views.
views: {
  public: ({ G, C }) => ({ winner: C.winner }),
}
```

If you want a value from `legalActions` to appear in a view, recompute it inside the `computed` block and read it via `C`. The two layers are intentionally separated: rule contexts can read `derived` (which includes machine-state introspection like `activePlayers`); views can only read author-defined `computed` outputs.

## Anti-pattern: shaping views inside moves

Do not strip hidden info inside a move and re-store the stripped version in `G`. Keep `G` as the full ground truth and let views project. A move that writes "what the opponent should see" into `G` conflates authoritative state with rendering — replays break, undo breaks, and any future view that needs the hidden field is now impossible to write. Authoritative state and rendering are different layers.

## Leak check

If `views.public` exposes `Object.keys(G.hands)` plus `G.deck.length` plus a deterministic `G.deckSeed`, then any client can simulate the deck and read every hand. **Anything derivable from a public view is leaked.** Likewise: a "shuffled" array whose length and seed are public is not hidden; a count of "cards drawn this turn" plus the deck order is not hidden. Run a mental dry-run before shipping each view — given exactly what the public view exposes, can a determined client reconstruct anything you intended to hide?

## See also

- https://openturn.io/docs/how-to/model-hidden-info
- https://openturn.io/docs/concepts/gamekit-views-and-computed
- Splendor (uses views for hidden noble effects): `examples/games/splendor/game/src/`
