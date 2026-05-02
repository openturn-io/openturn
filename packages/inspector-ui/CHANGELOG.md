# @openturn/inspector-ui

## 0.5.0

### Minor Changes

- 43742b6: Fix same-tab play shell theme propagation so embedded dev bars and inspector chrome follow the selected dark theme, and keep the lobby React chrome fixed instead of accepting consumer skinning props (`Lobby` no longer accepts `className` or `renderSeat` — use `LobbyWithBots` for the bot-aware variant).

### Patch Changes

- Updated dependencies [43742b6]
  - @openturn/bridge@0.5.0
  - @openturn/react@0.5.0
  - @openturn/core@0.5.0
  - @openturn/inspector@0.5.0
  - @openturn/replay@0.5.0

## 0.4.0

### Patch Changes

- Updated dependencies [f9930a5]
- Updated dependencies [f9930a5]
  - @openturn/bridge@0.4.0
  - @openturn/react@0.4.0
  - @openturn/core@0.4.0
  - @openturn/inspector@0.4.0
  - @openturn/replay@0.4.0

## 0.3.0

### Patch Changes

- Updated dependencies [a65c92d]
- Updated dependencies [c3e9159]
  - @openturn/bridge@0.3.0
  - @openturn/react@0.3.0
  - @openturn/core@0.3.0
  - @openturn/inspector@0.3.0
  - @openturn/replay@0.3.0

## 0.2.3

### Patch Changes

- @openturn/bridge@0.2.3
- @openturn/core@0.2.3
- @openturn/inspector@0.2.3
- @openturn/react@0.2.3
- @openturn/replay@0.2.3

## 0.2.2

### Patch Changes

- Updated dependencies [e7e9c70]
  - @openturn/react@0.2.2
  - @openturn/bridge@0.2.2
  - @openturn/core@0.2.2
  - @openturn/inspector@0.2.2
  - @openturn/replay@0.2.2

## 0.2.1

### Patch Changes

- @openturn/bridge@0.2.1
- @openturn/core@0.2.1
- @openturn/inspector@0.2.1
- @openturn/react@0.2.1
- @openturn/replay@0.2.1

## 0.2.0

### Patch Changes

- Updated dependencies [6d74435]
  - @openturn/bridge@0.2.0
  - @openturn/react@0.2.0
  - @openturn/core@0.2.0
  - @openturn/inspector@0.2.0
  - @openturn/replay@0.2.0

## 0.1.1

### Patch Changes

- 8fe68eb: Replace `workspace:*` internal dependencies with concrete `^X.Y.Z` ranges so published tarballs install cleanly outside the monorepo. The 0.1.0 release shipped `workspace:*` literals into the npm registry, breaking external consumers.
- Updated dependencies [8fe68eb]
  - @openturn/bridge@0.1.1
  - @openturn/core@0.1.1
  - @openturn/inspector@0.1.1
  - @openturn/react@0.1.1
  - @openturn/replay@0.1.1

## 0.1.0

### Minor Changes

- 390a036: initial changeset release

### Patch Changes

- Updated dependencies [390a036]
  - @openturn/bridge@0.1.0
  - @openturn/core@0.1.0
  - @openturn/inspector@0.1.0
  - @openturn/react@0.1.0
  - @openturn/replay@0.1.0
