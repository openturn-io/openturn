# Openturn Internal Notes

This file is for internal planning only. The canonical user-facing architecture explanation lives in the docs site under `docs/`.

## Current public stance

- `@openturn/core` is the canonical worker-safe authoring and runtime package.
- `@openturn/core` uses a pure reducer over a strict declared state machine: immutable authoritative `G`, declared states, event dispatch, reducer-selected transitions, derived selectors, and compiled graph metadata.
- Core transitions are pure reducer branches. There is no side-effect pipeline, no preparer/guard/commit split, and no compatibility layer for older runtime models.
- `@openturn/gamekit` is the optional worker-safe sugar layer for move-first turn-based authoring. It compiles back to pure `@openturn/core` definitions and can be mixed with raw core authoring in the same game.
- Hosted, replay, protocol, and devtools packages are aligned around strict-core events, snapshots, transition traces, and replay-safe outputs. There is no intended public dual-track between legacy core and a separate machine runtime.
- `@openturn/bot` is the optional bot layer. It consumes only public session APIs (`applyEvent`, `getState`, `getPlayerView`) plus one optional author hook (`legalActions` on `GameDefinition`). Bots are out-of-engine: `decide` runs as a Promise outside the reducer, dispatch goes back through the same path a human client uses. Same `defineBot` shape powers random, heuristic, MCTS, and LLM-backed bots; same bot runs on a `LocalGameSession` and on a `HostedClient` over the network.

## Runtime boundaries

Classify packages by what they execute, not where they are developed.

Current intended runtime mapping:

- `@openturn/core`: worker
- `@openturn/json`: worker
- `@openturn/manifest`: worker
- `@openturn/gamekit`: worker
- `@openturn/protocol`: worker
- `@openturn/replay`: worker
- `@openturn/server`: worker
- `@openturn/client`: worker
- `@openturn/bot`: worker
- `@openturn/inspector`: worker
- `@openturn/bridge`: browser
- `@openturn/react`: browser
- `@openturn/inspector-ui`: browser
- `@openturn/deploy`: Bun
- `@openturn/cli`: Bun
- `examples/*/*/game`: worker
- `examples/*/*/app`: browser
- `examples/*/*/cli`: Bun
- `scripts/*`: Bun
- generated multiplayer deployment Workers: worker

`@openturn/bridge` is the single source of truth for the host↔game iframe
wire (URL-fragment `BridgeInit`, namespaced postMessage protocol, and the
capability registry that lets games expose utilities to the shell). Both the
iframe (`createGameBridge`) and the shell (`createBridgeHost`) import this
package; neither hand-rolls the protocol. The retired
`@openturn/connect` package is replaced by `@openturn/bridge`; the retired
`@openturn/devtools` and `@openturn/devtools-react` packages are renamed to
`@openturn/inspector` and `@openturn/inspector-ui`. `@openturn/manifest` is a
worker-safe leaf that carries the deployment manifest schema consumed by
`@openturn/deploy` and the cloud shell.

## Design rules

- If code may run in Cloudflare Workers or Durable Objects, keep it worker-compatible now.
- Worker packages must not depend on Node builtins or Bun globals.
- If a package mixes worker/runtime logic with Bun-only tooling, split the package.
- Cutover changes are preferred over compatibility layers until launch.
- Reducers and authored state derivations must stay pure and replay-safe.
- Authoritative state and reducer results should be serializable replay values.
- JSON serializability is enforced through `@openturn/json` and Zod-backed shared schemas.
- Runtime metadata such as views, selectors, control summaries, and traces should derive from snapshots rather than side effects.
- Replay, protocol, transport, and persistence surfaces use strict JSON values rather than `structuredClone` semantics.
- `@openturn/replay` owns the canonical saved replay artifact: game id, match bootstrap, seed, initial time, and action log.
- Browser replay viewers load saved replay artifacts, resolve the authored game by id, and materialize inspector timelines locally without any live match dependency.
- Bun-only packages may persist replay files to disk, but worker/browser packages must stay file-I/O free.
- Cloud multiplayer authoring defaults to two files: `app/game.ts` exports `game` and `match`, and `app/page.tsx` renders the game UI.
- Playable browser examples use the same `app/game.ts` and `app/page.tsx` authoring surface, and may keep normal browser-only frontend dependencies such as React component libraries, Tailwind CSS, and app-local styles.
- `app/openturn.ts` is optional metadata for names and deployment overrides, including multiplayer `gameKey`, `schemaVersion`, `deploymentVersion`, and players.
- `@openturn/deploy` is Bun-only and may generate browser and Worker entry files locally, but the generated multiplayer Worker and `@openturn/server` runtime remain worker-safe.
- The default multiplayer Worker is generated from `app/game.ts`; authors do not need a `deployment.ts` or hand-written Wrangler Worker for cloud deployment.
- `defineGameDeployment` remains a worker-safe low-level API for tests and advanced local deployment modules, not the default cloud authoring surface.

## Core model notes

- `G` is the authoritative replay-safe state.
- `position` is the active control node and monotonic turn counter.
- `derived` contains replay-safe projections such as active players, selectors, and control metadata.
- Transition matching is decided by resolver return values:
  - `null`, `undefined`, or `false` means the branch does not match.
  - A `GameTransitionRejection` (from `rejectTransition(code, details?)`) means the event is invalid and the dispatcher receives a typed error.
  - `{ G?, enqueue?, profile?, result?, turn? }` means the branch matches and returns the next snapshot fragment. `profile` applies a `ProfileCommitDeltaMap` atomically with the transition; setting `result` to a non-null value terminates the match.
- Exactly one matching branch per `(state, event)` pair — the engine raises `ambiguous_transition` if two branches return a result.
- Internal queued events are allowed, but they must remain deterministic and replay-safe.
- `pendingTargets` in control summaries are structural candidate targets from the current node ancestry, not speculative runtime reachability. `activePlayers` is the only field that gates dispatch at runtime.

## When to update this file

Update `design.md` only for internal planning, package-boundary decisions, and future architecture notes that are not yet part of the public docs contract.
