# Battleship

Classic Battleship as a cloud-hosted openturn example. Demonstrates **per-player
hidden state** (each admiral's fleet positions stay on the server, the opponent
only sees hit/miss/sunk markers) and a **multi-phase flow** — simultaneous
planning into round-robin battle into a terminal game-over.

## Packages

- `game/` — gamekit game definition (`@openturn/example-battleship-game`).
  Runtime target: `worker`. Contains the `BattleshipState`, moves
  (`placeShip`, `unplaceShip`, `ready`, `fire`), phase gating, and `views.player`
  projection that filters secrets out before transmission.
- `app/` — React 19 + Tailwind v4 + shadcn-style UI + Hugeicons. Runtime target:
  `browser`. Wires `<OpenturnProvider cloud={{}}>` + `useRoom()` for hosted play
  and the `<Lobby>` primitive for seating.

## Local multiplayer development

```sh
cd openturn
bun --filter @openturn/example-battleship-app dev
```

Open the printed play URL. The local play shell creates or joins a room,
injects the hosted backend fragment into the iframe, and serves the generated
browser bundle. Open the invite URL in a second tab to claim the other seat.

## Tests

```sh
bun --filter @openturn/example-battleship-game test
```

Covers placement validation (bounds + overlap + duplicate), readiness gating,
fire-phase gating, the hidden-state secrecy invariant (opponent's unshot ship
cells never appear in a player view), sunk-ship reveal, and a happy path to a
winner.

## Cloud deployment

```sh
cd openturn/examples/battleship/app
bun run deploy
```

The CLI builds the browser bundle, generates and uploads the multiplayer
Worker, and prints the openturn-cloud play URL.
