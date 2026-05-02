# @openturn/server

## 0.5.0

### Patch Changes

- @openturn/bot@0.5.0
- @openturn/core@0.5.0
- @openturn/json@0.5.0
- @openturn/protocol@0.5.0

## 0.4.0

### Patch Changes

- @openturn/bot@0.4.0
- @openturn/core@0.4.0
- @openturn/json@0.4.0
- @openturn/protocol@0.4.0

## 0.3.0

### Patch Changes

- 910daa2: Rehydrate cloud-hosted bot drivers from persisted active lobby seats whenever a game message arrives without an in-memory driver — both after Durable Object hibernation and on first message after `loadLobby`. Also exports `resolveBotMapFromSeats` and `BotSeatRecordShape` for callers that need to derive a bot map from persisted seats.
  - @openturn/bot@0.3.0
  - @openturn/core@0.3.0
  - @openturn/json@0.3.0
  - @openturn/protocol@0.3.0

## 0.2.3

### Patch Changes

- 19ed132: Derive cloud worker lobby capacity from the deployed game definition so hosted lobby state preserves the declared player pool without injecting per-session match metadata.
  - @openturn/bot@0.2.3
  - @openturn/core@0.2.3
  - @openturn/json@0.2.3
  - @openturn/protocol@0.2.3

## 0.2.2

### Patch Changes

- @openturn/bot@0.2.2
- @openturn/core@0.2.2
- @openturn/json@0.2.2
- @openturn/protocol@0.2.2

## 0.2.1

### Patch Changes

- @openturn/bot@0.2.1
- @openturn/core@0.2.1
- @openturn/json@0.2.1
- @openturn/protocol@0.2.1

## 0.2.0

### Patch Changes

- @openturn/bot@0.2.0
- @openturn/core@0.2.0
- @openturn/json@0.2.0
- @openturn/protocol@0.2.0

## 0.1.1

### Patch Changes

- 8fe68eb: Replace `workspace:*` internal dependencies with concrete `^X.Y.Z` ranges so published tarballs install cleanly outside the monorepo. The 0.1.0 release shipped `workspace:*` literals into the npm registry, breaking external consumers.
- Updated dependencies [8fe68eb]
  - @openturn/bot@0.1.1
  - @openturn/core@0.1.1
  - @openturn/json@0.1.1
  - @openturn/protocol@0.1.1

## 0.1.0

### Minor Changes

- 390a036: initial changeset release

### Patch Changes

- Updated dependencies [390a036]
  - @openturn/bot@0.1.0
  - @openturn/core@0.1.0
  - @openturn/json@0.1.0
  - @openturn/protocol@0.1.0
