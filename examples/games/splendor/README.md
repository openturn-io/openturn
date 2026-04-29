# Splendor

Splendor as a cloud-hosted openturn example. Demonstrates a **tabletop
aesthetic** end-to-end (felt backdrop, dimensional gem chips, parchment
development cards, gold noble tiles), **per-player hidden state** (each
merchant's reserved cards stay on the server), **2–4 player variable seating**
via `MatchInput.minPlayers`, and a **single-phase, round-robin** game with a
"complete the round before declaring a winner" end-game pipeline.

## Packages

- `game/` — gamekit game definition (`@openturn/example-splendor-game`).
  Runtime target: `worker`. Contains the `SplendorState`, the official
  Splendor-faithful card distribution (40/30/20 development cards + 10 nobles),
  moves (`takeThreeGems`, `takeTwoGems`, `reserveCard`, `buyCard`,
  `discardChips`), the noble-claim + final-round trigger pipeline, and
  `views.player` projection that filters opponents' reserved cards down to a
  count.
- `app/` — React 19 + Tailwind v4 + framer-motion + Hugeicons. Runtime target:
  `browser`. Wires `<OpenturnProvider>` + `useRoom()` for hosted play and the
  `<Lobby>` primitive for seating. The game UI is composed of `Table`,
  `Market`, `ChipBank`, `PlayerTableau`, `DevCard`, `NobleTile`, `GemChip`,
  `TurnBanner`, and `GameOverDialog` — every visual atom is CSS / SVG with
  `framer-motion` animations and an asset slot reserved for future PNG/SVG
  artwork drop-in (`DevCard.artworkSrc`, `NobleTile.portraitSrc`,
  `GemChip.iconSrc`).

## Local multiplayer development

```sh
cd openturn
bun --filter @openturn/example-splendor-app dev
```

Open the printed play URL. The local play shell creates or joins a room,
injects the hosted backend fragment into the iframe, and serves the generated
browser bundle. Open the invite URL in additional tabs for 3- and 4-player
seats.

### One-tab visual preview

For UI work that doesn't need a full lobby + websocket round trip, append
`?preview=local` to the dev URL. The page renders a no-lobby, single-tab
`LocalPreview` that seats both players locally and exposes a camera toggle in
the header. Useful for designing animations and screenshotting the table.

## Tests

```sh
bun --filter @openturn/example-splendor-game test
```

Covers setup supply by player count, all five moves' validation paths, the
hidden-state secrecy invariant (opponent's reserved IDs never appear in any
player's view), reserve cap, chip cap + discard sub-state, and the
final-round trigger semantics.

## Cloud deployment

```sh
cd openturn/examples/games/splendor/app
bun run deploy
```

The CLI builds the browser bundle, generates and uploads the multiplayer
Worker, and prints the openturn-cloud play URL.

## Known phase-1 simplifications

These are intentional shortcuts; each is a small follow-up PR.

- **Multi-noble pick**: when 2+ nobles qualify on the same turn, the lowest-ID
  one auto-claims. Real Splendor lets the active player choose.
- **Card and noble artwork**: every card center / noble portrait is a CSS
  placeholder. Asset slots are wired (`artworkSrc`, `portraitSrc`) for a
  future drop-in.
- **Mobile layout**: the table assumes ≥1024px. Below that it flows but is not
  polished.
- **AI bot**: the lobby seat dropdown exposes three server-driven bots from
  [`bots/`](./bots/) — `Random` (uniform legal move), `Greedy` (buys the best
  affordable card, otherwise grabs gems aligned with market costs), and
  `Strategic` (plans around nobles, engine balance, reserves, and opponent
  threats). A stronger rollout/search bot (MCTS) is still a follow-up.
