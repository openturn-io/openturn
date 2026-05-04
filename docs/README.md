# Openturn docs

> [!WARNING]
> Openturn is currently in an early alpha stage. APIs may change quickly, behavior may shift between releases, and the platform should be expected to be unstable while the core framework and hosted services are still evolving.

This folder contains the Mintlify site for the Openturn repo.

## Local preview

Run the preview from this directory because `docs.json` lives here.

```bash
cd docs
bunx mint dev
```

## Validation

```bash
cd docs
bunx mint broken-links
bunx mint validate
```

## Writing rules

- Keep docs aligned with the current repo state.
- Preserve the worker, browser, and Bun runtime boundaries described in the project root `AGENTS.md`.
- When `design.md` changes, make sure the docs reflect the same package runtime mapping.
