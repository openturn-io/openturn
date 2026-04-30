# @openturn/cli

## 0.2.0

### Patch Changes

- 8705cd5: Add the Bun shebang to the CLI entrypoint so package managers install the `openturn` binary correctly.
- Updated dependencies [6d74435]
  - @openturn/bridge@0.2.0
  - @openturn/inspector-ui@0.2.0
  - @openturn/react@0.2.0
  - @openturn/core@0.2.0
  - @openturn/deploy@0.2.0
  - @openturn/json@0.2.0
  - @openturn/protocol@0.2.0
  - @openturn/server@0.2.0

## 0.1.1

### Patch Changes

- 8fe68eb: Replace `workspace:*` internal dependencies with concrete `^X.Y.Z` ranges so published tarballs install cleanly outside the monorepo. The 0.1.0 release shipped `workspace:*` literals into the npm registry, breaking external consumers.
- Updated dependencies [8fe68eb]
  - @openturn/bridge@0.1.1
  - @openturn/core@0.1.1
  - @openturn/deploy@0.1.1
  - @openturn/inspector-ui@0.1.1
  - @openturn/json@0.1.1
  - @openturn/protocol@0.1.1
  - @openturn/react@0.1.1
  - @openturn/server@0.1.1

## 0.1.0

### Minor Changes

- 390a036: initial changeset release

### Patch Changes

- Updated dependencies [390a036]
  - @openturn/bridge@0.1.0
  - @openturn/core@0.1.0
  - @openturn/deploy@0.1.0
  - @openturn/inspector-ui@0.1.0
  - @openturn/json@0.1.0
  - @openturn/protocol@0.1.0
  - @openturn/react@0.1.0
  - @openturn/server@0.1.0
