Cutover change is allowed and preferred and no migration/compatibility is needed as we haven't launched yet.

Runtime rules:

- Any current or future package that may run on server, in Cloudflare Workers, or in Durable Objects must be worker-compatible by default.
- Use Bun-specific code only for local tooling, scripts, demos, and CLI packages.
- Classify packages by what they execute, not where they are developed.
- If a package mixes worker/runtime code with Bun-only tooling concerns, split the package instead of weakening the runtime contract.

Runtime mapping in this repo:

- `packages/*` that contain shared engine, protocol, replay, or authoritative runtime logic should target the worker runtime.
- `examples/*/*/game` should target the worker runtime.
- `examples/*/*/cli` and `scripts/*` may target Bun.

Enforcement expectations:

- Worker packages should extend `tsconfig.worker.json`.
- Bun-only packages should extend `tsconfig.bun.json`.
- Worker packages must not import Node builtins or use Bun/Node globals such as `Bun`, `Buffer`, or `process`.
- Declare the intended runtime in each package `package.json` under `openturn.runtime`.

When reading or updating `design.md`, explicitly determine the intended runtime for each package and preserve these boundaries.

When you finally finish running each time, run the mac cli `say "HEY YOUR TASK IS DONE"`