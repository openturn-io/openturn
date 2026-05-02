# @openturn/protocol

## 0.6.0

### Minor Changes

- ffb51b3: Add `LobbyEnv.requireHumanSeat` so hosted lobbies reject all-bot starts with the new `no_humans_seated` rejection reason; the cloud worker enables it by default. The CLI dev server keeps it off so authors can dry-run bot-vs-bot matches: when the host starts a room with only bot seats, the dev server mints them a game token bound to seat 0's playerID and transitions them straight into the running match so they can watch the bots play out the game. (The host technically connects as player 0 — they shouldn't dispatch during a bot-vs-bot watch, but cloud doesn't expose this path.)

### Patch Changes

- @openturn/core@0.6.0
- @openturn/json@0.6.0

## 0.5.0

### Patch Changes

- @openturn/core@0.5.0
- @openturn/json@0.5.0

## 0.4.0

### Patch Changes

- @openturn/core@0.4.0
- @openturn/json@0.4.0

## 0.3.0

### Patch Changes

- @openturn/core@0.3.0
- @openturn/json@0.3.0

## 0.2.3

### Patch Changes

- @openturn/core@0.2.3
- @openturn/json@0.2.3

## 0.2.2

### Patch Changes

- @openturn/core@0.2.2
- @openturn/json@0.2.2

## 0.2.1

### Patch Changes

- @openturn/core@0.2.1
- @openturn/json@0.2.1

## 0.2.0

### Patch Changes

- @openturn/core@0.2.0
- @openturn/json@0.2.0

## 0.1.1

### Patch Changes

- 8fe68eb: Replace `workspace:*` internal dependencies with concrete `^X.Y.Z` ranges so published tarballs install cleanly outside the monorepo. The 0.1.0 release shipped `workspace:*` literals into the npm registry, breaking external consumers.
- Updated dependencies [8fe68eb]
  - @openturn/core@0.1.1
  - @openturn/json@0.1.1

## 0.1.0

### Minor Changes

- 390a036: initial changeset release

### Patch Changes

- Updated dependencies [390a036]
  - @openturn/core@0.1.0
  - @openturn/json@0.1.0
