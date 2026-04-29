# Openturn docs

This folder contains the Mintlify site for the Openturn repo.

## Local preview

Run the preview from this directory because `docs.json` lives here.

```bash
cd docs
npx mint dev
```

## Validation

```bash
cd docs
npx mint broken-links
npx mint validate
```

## Writing rules

- Keep docs aligned with the current repo state.
- Preserve the worker, browser, and Bun runtime boundaries described in the project root `AGENTS.md`.
- When `design.md` changes, make sure the docs reflect the same package runtime mapping.
