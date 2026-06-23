# Modern Art

A faithful implementation of Reiner Knizia's _Modern Art_ (1992) for 3–5 players, built on the Openturn engine. Buy and sell paintings across four rounds; after each round the top three artists (by paintings sold) pay out, and the richest collector wins.

## Packages

- **`game/`** — `@openturn/example-modern-art-v2-game`. The `defineGame` value: state, moves, views, legal-action enumeration. Worker runtime.
- **`bots/`** — `@openturn/example-modern-art-v2-bots`. Three bots (`random`, `collector`, `speculator`) plus the bot registry. Worker runtime.
- **`app/`** — `@openturn/example-modern-art-v2-app`. Hosted-multiplayer React UI with a gallery aesthetic. Browser runtime.

## Rules modeled

- **70 paintings, 5 artists** with the official rarity curve: Krypto 16, Karl Gitter 15, Cristin P. 14, Yoko 13, Lite Metal 12.
- **Starting money:** $100 each.
- **Deal:** 3p → 10 each, 4p → 9 each, 5p → 8 each (hand persists across rounds).
- **Five auction types:** Open, Sealed, Once-Around, Fixed-Price, Double.
- **Round end:** the 5th painting of any single artist put up for auction ends the round (that painting is not auctioned). A round also ends if all hands are exhausted.
- **Scoring:** rank artists by paintings sold (ties broken by rarity — rarer artist ranks higher). Top-3 artists gain $30 / $20 / $10 per painting of theirs you own, cumulative across rounds.
- **Game end:** after round 4, the richest player wins.

## Develop

```sh
cd app
bun run dev    # http://localhost:3011
```

Open `?preview=local` for a no-lobby single-tab preview where every seat is driven from one browser window.

## Test

```sh
cd game && bun test    # game-definition tests
cd bots && bun test    # bot termination tests
```
