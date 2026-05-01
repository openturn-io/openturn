# @openturn/bridge

## 0.3.0

### Minor Changes

- c3e9159: Share the React play shell between the CLI dev server and hosted shells, exposing the shared play adapter types from `@openturn/bridge` and serving the CLI play app bundle from the local dev server.

### Patch Changes

- a65c92d: Rename the play shell invite action to Copy Invite, show a sonner success toast after copying, and let player seat badges wrap cleanly in crowded room toolbars.
  - @openturn/client@0.3.0
  - @openturn/json@0.3.0

## 0.2.3

### Patch Changes

- @openturn/client@0.2.3
- @openturn/json@0.2.3

## 0.2.2

### Patch Changes

- @openturn/client@0.2.2
- @openturn/json@0.2.2

## 0.2.1

### Patch Changes

- @openturn/client@0.2.1
- @openturn/json@0.2.1

## 0.2.0

### Minor Changes

- 6d74435: Add `@openturn/bridge/shell` entry point that exports `PlayShell`, the React component used to host a deployed bundle in a browser shell. The package now declares `react@^19.2.0` as an optional peer dependency, so existing non-React consumers (`/host`, `/game`) are unaffected.

### Patch Changes

- @openturn/client@0.2.0
- @openturn/json@0.2.0

## 0.1.1

### Patch Changes

- 8fe68eb: Replace `workspace:*` internal dependencies with concrete `^X.Y.Z` ranges so published tarballs install cleanly outside the monorepo. The 0.1.0 release shipped `workspace:*` literals into the npm registry, breaking external consumers.
- Updated dependencies [8fe68eb]
  - @openturn/client@0.1.1
  - @openturn/json@0.1.1

## 0.1.0

### Minor Changes

- 390a036: initial changeset release

### Patch Changes

- Updated dependencies [390a036]
  - @openturn/client@0.1.0
  - @openturn/json@0.1.0
