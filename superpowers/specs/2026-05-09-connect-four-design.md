# Connect Four — Splendor-tier example with bots — Design

**Date:** 2026-05-09
**Status:** Approved for implementation
**Scope:** Replace the current single-package `examples/games/connect-four/` scaffold (which still contains tic-tac-toe game logic) with a polished, hosted-multiplayer Connect Four example mirroring Splendor's package shape and conventions. Three packages — `game/`, `bots/`, `app/` — workspace-linked, runtime: `multiplayer`, three difficulty-tiered bots in the lobby, modern-minimalist Tailwind v4 UI with framer-motion drop animations.

## Goal

Ship Connect Four as the second Splendor-tier reference example in the openturn monorepo. A developer reading the source should be able to use it as a template for any 2-player perfect-information game with bots: same package layout, same lobby integration, same authoritative-state idioms, same testing strategy. The end product is deployable to Openturn Cloud via `bunx openturn deploy` and works locally via `bunx openturn dev`.

## Non-Goals

- **No CLI package.** Tic-tac-toe ships a `cli/`; we explicitly don't.
- **No shared `ui/` package.** Components live in `app/src/components/`.
- **No spectator-only / hidden-info modeling.** Connect Four is fully public.
- **No replay UI, sharable links, tournaments, ELO, or persistent profiles.** Lobby is per-match.
- **No drag-and-drop or animated path-painting on placement.** Click-to-drop only.
- **No sound, no haptic feedback.** Defer to a later spec if desired.
- **No Cloud production deploy as part of this spec.** The package supports deploy; actually publishing it is out of scope.

## Architecture — three packages

```
examples/games/connect-four/
├── game/                              # @openturn/example-connect-four-game (worker runtime)
│   ├── src/index.ts                   # defineGame(...), helpers, public re-exports
│   ├── test/connect-four.test.ts
│   ├── package.json                   # extends tsconfig.worker.json
│   └── tsconfig.json
├── bots/                              # @openturn/example-connect-four-bots (worker runtime)
│   ├── src/random.ts
│   ├── src/heuristic.ts
│   ├── src/minimax.ts
│   ├── src/index.ts                   # defineBotRegistry + attachBots(connectFour, registry)
│   ├── test/bots.test.ts
│   ├── package.json                   # extends tsconfig.worker.json
│   └── tsconfig.json
└── app/                               # @openturn/example-connect-four-app (browser runtime)
    ├── app/page.tsx                   # routes ?preview=local → LocalPreview, else ConnectFourExperience
    ├── app/openturn.ts                # metadata: { runtime: "multiplayer", multiplayer: { gameKey: "connect-four", schemaVersion: "1" } }
    ├── src/styles.css                 # @import "tailwindcss"; one line, nothing else
    ├── src/components/
    │   ├── ConnectFourExperience.tsx
    │   ├── LocalPreview.tsx
    │   ├── Match.tsx
    │   ├── Board.tsx
    │   ├── Disc.tsx
    │   ├── ColumnGhost.tsx
    │   ├── PlayerCard.tsx
    │   ├── Sidebar.tsx
    │   ├── StatusBanner.tsx
    │   └── WinningLineOverlay.tsx
    ├── package.json                   # workspace:* on game + bots + lobby + react + server
    └── tsconfig.json
```

Runtime classification per `AGENTS.md`:
- `game/` and `bots/` declare `"openturn": { "runtime": "worker" }` and extend `tsconfig.worker.json`. No Bun/Node globals; no `Buffer`, `process`, `Date.now` inside reducers or `decide`.
- `app/` declares `"openturn": { "runtime": "browser" }` and extends the browser tsconfig.
- Internal `@openturn/*` deps use `workspace:*`; external npm deps (`framer-motion`, `clsx`, `tailwind-merge`, `react`, etc.) are pinned with `^` versions, matching Splendor.

The dep graph is one-directional: `app/` → `bots/` → `game/`. The `bots/` package imports the game's types so `defineBotRegistry` can be `BotRegistry<typeof connectFour>`. The game package never imports `bots/`. `attachBots(connectFour, connectFourBotRegistry)` produces `connectFourWithBots`, which `app/` imports — this is the documented sidestep for the otherwise-circular dep.

## 1. Game definition (`game/src/index.ts`)

State is plain JSON, no class instances, no `Map` / `Set` / `Date`:

```ts
export type Mark = "0" | "1";   // "0" displays as red, "1" as yellow (mapping in app only)
export type Cell = Mark | null;

export interface ConnectFourState {
  board: Cell[][];                                                // 6 rows × 7 cols, board[0] is top row
  lastMove: { col: number; row: number; player: Mark } | null;
}

export interface DropDiscArgs { col: number; }
```

Layout convention: `board[0]` is the **top** row, `board[5]` the **bottom**. This matches CSS render order (no row flip on render). Drop physics scan rows 5→0 looking for the first empty cell.

```ts
export const connectFour = defineGame({
  playerIDs: ["0", "1"] as const,
  setup: (): ConnectFourState => ({
    board: Array.from({ length: 6 }, () => Array<Cell>(7).fill(null)),
    lastMove: null,
  }),
  turn: turn.roundRobin(),
  computed: {
    winningLine: ({ G }) =>
      G.lastMove ? findWinningLine(G.board, G.lastMove.row, G.lastMove.col) : null,
    isBoardFull: ({ G }) => G.board[0]!.every((c) => c !== null),
  },
  legalActions: ({ G, derived }, playerID) => {
    if (!derived.activePlayers.includes(playerID)) return [];
    return [0, 1, 2, 3, 4, 5, 6]
      .filter((col) => G.board[0]![col] === null)
      .map((col) => ({ event: "dropDisc", payload: { col }, label: `Col ${col + 1}` }));
  },
  moves: ({ move }) => ({
    dropDisc: move<DropDiscArgs>({
      run({ G, args, move, player }) {
        if (G.board[0]![args.col] !== null) {
          return move.invalid("column_full", { col: args.col });
        }
        const row = lowestEmptyRow(G.board, args.col);
        const board = withDisc(G.board, row, args.col, player.id as Mark);
        const lastMove = { col: args.col, row, player: player.id as Mark };
        if (findWinningLine(board, row, args.col) !== null) {
          return move.finish({ winner: player.id }, { board, lastMove });
        }
        if (board[0]!.every((c) => c !== null)) {
          return move.finish({ draw: true }, { board, lastMove });
        }
        return move.endTurn({ board, lastMove });
      },
    }),
  }),
  views: {
    public: ({ G, turn, derived }) => ({
      board: G.board,
      lastMove: G.lastMove,
      currentPlayer: turn.currentPlayer,
      winningLine: derived.winningLine,
    }),
    player: ({ G, turn, derived }) => ({
      board: G.board,
      lastMove: G.lastMove,
      currentPlayer: turn.currentPlayer,
      winningLine: derived.winningLine,
    }),
  },
});
```

Defining `views.player` explicitly avoids the documented footgun where omitting it leaks full `G` to every player. The two views return the same shape because Connect Four has no hidden state.

**Pure helpers, exported from the same module:**

- `lowestEmptyRow(board, col): number` — scan rows 5→0, return the first index where `board[r][col] === null`. Caller must have already checked the column isn't full.
- `withDisc(board, r, c, mark): Cell[][]` — immutable update; returns a new outer array with a new row at `r`. Other rows are reference-shared.
- `findWinningLine(board, r, c): { row: number; col: number }[] | null` — given the cell just placed, scan in each of the 4 directions (`—`, `|`, `╲`, `╱`) for 4 consecutive cells of the same mark including `(r, c)`. Returns the 4 winning cells (top-left to bottom-right ordered) or `null`. Runs in O(1) per move.

These helpers are part of the package's public surface so `bots/` can reuse them.

## 2. Bots (`bots/src/*`)

Three difficulty-tiered bots registered via `defineBotRegistry` and attached with `attachBots(connectFour, connectFourBotRegistry)`. The bots-attached game is what `app/` imports.

```ts
// bots/src/index.ts
import { defineBotRegistry, attachBots } from "@openturn/lobby/registry";
import { connectFour } from "@openturn/example-connect-four-game";
import { randomBot } from "./random";
import { heuristicBot } from "./heuristic";
import { makeMinimaxBot } from "./minimax";

export const connectFourBotRegistry = defineBotRegistry([
  { botID: "random",    label: "Random",    difficulty: "easy",   bot: randomBot },
  { botID: "heuristic", label: "Heuristic", difficulty: "medium", bot: heuristicBot },
  { botID: "minimax",   label: "Minimax",   difficulty: "hard",   bot: makeMinimaxBot({ depth: 6 }) },
]);

export const connectFourWithBots = attachBots(connectFour, connectFourBotRegistry);
```

### Random (`random.ts`)

```ts
export const randomBot = defineBot({
  name: "random",
  decide: ({ legalActions, rng }) => rng.pick(legalActions),
});
```

### Heuristic (`heuristic.ts`)

One-ply, scores each legal column:

1. If dropping in this column makes 4-in-a-row → score `+Infinity`.
2. Else if the opponent dropping in this column would make 4-in-a-row → score `+10_000` (forced block).
3. Else center bias: column-weight table `[3, 4, 5, 7, 5, 4, 3]` plus `+1` for stacking on top of an existing own-disc, `−1` for placing under an opponent's threatened diagonal.
4. Tie-break with `rng.pick` over the maximum-scored columns so games aren't identical.

Decides in <5ms. Uses the exported `findWinningLine` and a small `wouldWin(board, col, mark)` helper. Wins ≥95% vs Random over 100 games (test target).

### Minimax (`minimax.ts`)

Alpha-beta with iterative deepening. View-only — operates on the public board, **never calls `simulate`** — so it works in every topology (in-process local supervisor, server-side DO supervisor, hypothetical sidecar).

```ts
export function makeMinimaxBot({ depth, budgetMs = 2000 }: { depth: number; budgetMs?: number }) {
  return defineBot({
    name: `minimax-d${depth}`,
    thinkingBudgetMs: budgetMs,
    decide: ({ view, playerID, deadline, legalActions, rng }) => {
      const choice = searchAlphaBeta({
        board: view.board,
        me: playerID as Mark,
        maxDepth: depth,
        deadline,
      });
      return choice ?? rng.pick(legalActions);
    },
  });
}
```

- `evaluate(board, me)` — weighted count of open 2-in-a-rows + 3-in-a-rows for `me` minus same for opponent, with center-column emphasis. Returns `+Infinity` for `me` win, `−Infinity` for opponent win.
- Iterative deepening: search depth 1, then 2, …, up to `maxDepth`, retaining the best move at each completed depth. Between depths check `deadline.expired()` — return the deepest completed depth's best move when budget runs out. If even depth 1 doesn't complete, return `null` and let the caller fall back to `rng.pick`.
- Move ordering: try center-out (`[3, 2, 4, 1, 5, 0, 6]`) at every node — boosts alpha-beta cutoffs ~3×.
- Default `depth: 6`, `budgetMs: 2000`. Connect Four is solved at perfect play (first player wins with center start), but depth 6 produces strong-amateur-feel play within a 2-second budget, leaves headroom for slower devices, and feels natural to play against.

### Determinism

All three bots are pure functions of `(view, legalActions, rng)`. The bot context's `rng` is forked from `snapshot.meta.rng` plus a per-bot/seat/turn salt, so:
- Same seed + same view → same move.
- Two bots playing the same snapshot get different streams.
- Replays are bit-identical.

No bot calls `Math.random`, `Date.now`, or `crypto.*`. The minimax `deadline` API does affect which move is returned (a budget that aborts before depth `D` completes returns the best move from depth `D-1`), so under wall-clock pressure two runs can diverge. Tests requiring exact reproducibility use a very large `budgetMs` so iterative deepening always reaches `maxDepth`; live play accepts the harmless variance because depth-`D-1` moves are still strong.

### Topology wiring (no app changes per topology)

- **Local single-device:** `useBotAttachOnTransition` from `@openturn/lobby/react` in `ConnectFourExperience.tsx`. The hook returns a bot-aware facade once the lobby transitions; `app/` drives the UI from `facade ?? rawSession`.
- **Hosted dev (`openturn dev`) and Openturn Cloud:** the room Durable Object reads `game.bots` and instantiates `createHostedBotSupervisor` automatically. App code is identical to the local case — only the lobby channel hook differs (`useLobbyChannel` instead of `useLocalLobbyChannel`).

## 3. App / UI (`app/`)

### Top-level routing

```tsx
// app/app/page.tsx
import "../src/styles.css";
import { ConnectFourExperience } from "../src/components/ConnectFourExperience";
import { LocalPreview } from "../src/components/LocalPreview";

export default function Page() {
  if (typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("preview") === "local") {
    return <LocalPreview />;
  }
  return <ConnectFourExperience />;
}
```

### Styling — Tailwind v4, no inline styles, no CSS-in-JS

Everything is Tailwind utility classes applied to JSX. The single `src/styles.css` contains only `@import "tailwindcss";`. This is a hard rule for this spec:

- **No inline `style={{ … }}` attributes** for static styling — including the soft-halo last-move treatment, which is expressed as a Tailwind v4 arbitrary `shadow-[…]` utility (see `Disc.tsx` row below for the literal string).
- **Dynamic values** that genuinely can't be Tailwind (per-frame transform targets during the spring drop) go through `framer-motion`'s `initial` / `animate` props, not a `style` object.
- **No CSS-in-JS** (no `styled-components`, `emotion`, or equivalent).
- **No standalone `.css` files** beyond `src/styles.css`.
- **Use `clsx` + `tailwind-merge`** (`cn()` helper in `src/lib/cn.ts`) for conditional classes — same pattern as Splendor.
- The visual-direction mockup (option B from brainstorming) is the source of truth for color and density. Mockup CSS is illustrative; the implementation uses Tailwind classes.

### Lobby phase

```tsx
<LobbyWithBots lobby={view} title="Connect Four" />
```

from `@openturn/lobby/react`. Two seats, "Take seat" or "Assign bot ▾" dropdown populated from `connectFourBotRegistry`. Same component for local and hosted; only the channel hook differs.

### Match phase — layout

Desktop (≥720px): two-column grid. Left column holds the board card, right column the sidebar.

```
┌─────────────────────────────────────────────────────────────────┐
│ Connect Four                                          [ ⓘ Help ] │  header
├─────────────────────────────────────────┬───────────────────────┤
│            ▼ ghost on hover             │  ● Red — You          │  player cards
│        ┌───────────────────────┐        │     Your turn         │
│        │ . . . . . . .         │        │                       │
│        │ . . . . . . .         │        │  ○ Yellow             │
│        │ . . . y . . .         │        │     Bot · Minimax     │
│        │ . . r r . . .         │        │     Waiting           │
│        │ . y y r y . .         │        │ ─────────────────     │
│        │ r r y y r y .         │        │  Turn 7 · Moves 11    │
│        └───────────────────────┘        │  Move history         │
│        Click any column to drop         │  [    New match    ]  │
└─────────────────────────────────────────┴───────────────────────┘
```

Mobile (<720px): the sidebar collapses to a horizontal row above the board (player cards side-by-side, history hidden behind a disclosure). Board scales to fill width with `aspect-[7/6]`.

### Components

| Component | Responsibility | Key Tailwind tokens |
|---|---|---|
| `ConnectFourExperience.tsx` | Phase switch lobby↔match, owns the raw session and the bot-aware facade via `useBotAttachOnTransition`. | `min-h-screen bg-slate-50 text-slate-950` |
| `LocalPreview.tsx` | `?preview=local` hot-seat — no lobby, both seats human, useful for board-layout work. | Same shell as `Match.tsx` |
| `Match.tsx` | Header + 2-col grid; renders `<Board>` and `<Sidebar>`; listens for `result` to swap status banner and surface "New match" CTA. | `mx-auto max-w-5xl px-6 py-8`, `grid grid-cols-1 gap-6 md:grid-cols-[1fr_260px]` |
| `Board.tsx` | 7×6 grid of `<Disc>` wells; column-level pointer/keyboard handlers; emits `dropDisc({ col })`; renders `<ColumnGhost>` above the hovered/focused column. | `grid grid-cols-7 gap-1.5 p-1 rounded-xl bg-white border border-slate-200 shadow-sm` |
| `Disc.tsx` | A single cell. Empty → `bg-slate-100 border border-slate-200 rounded-full`. Filled → `bg-red-500` or `bg-amber-400`, `shadow-sm`. New disc animates from above with `framer-motion` spring (initial `y: -dropDistance`, target `y: 0`, `{ type: "spring", stiffness: 380, damping: 24, mass: 1 }`, plus 120ms `scaleY 0.92→1` squash on landing). The last-played disc gets the soft-halo treatment via a Tailwind v4 arbitrary utility: `border-transparent shadow-[0_0_0_3px_rgba(15,23,42,0.05),0_0_14px_rgba(15,23,42,0.08),0_1px_2px_rgba(15,23,42,0.12)]`. The class string lives as a `LAST_MOVE_HALO` constant in `src/lib/halo.ts` and is composed via `cn()`. |
| `ColumnGhost.tsx` | Faded disc above the hovered/focused column in the active player's color (`bg-red-500/30` or `bg-amber-400/30`). Hidden when game is over or when not the local seat's turn. | `aspect-square rounded-full transition-opacity` |
| `Sidebar.tsx` | Wraps `<PlayerCard>` ×2, stats row (turn / moves), `<MoveHistory>`, and the post-game "New match" button. | `flex flex-col gap-2.5` |
| `PlayerCard.tsx` | Disc swatch + name + role line ("You · Your turn", "Bot · Minimax · Thinking…"). Active card gets `ring-1 ring-slate-300`. | `flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3.5 py-3` |
| `StatusBanner.tsx` | Small-caps status above the board: "Your turn", "Yellow is thinking…", "Red wins", "Draw". `aria-live="polite"`. | `text-xs font-medium uppercase tracking-[0.18em] text-slate-500` |
| `WinningLineOverlay.tsx` | When `view.winningLine !== null`, renders an SVG line stroked between the 4 winning cells with `stroke-slate-900/30 stroke-[3px]`; animates `stroke-dashoffset` 0→1 over 400ms. | absolutely positioned over the board grid |

The `cn()` helper (`src/lib/cn.ts`) is `clsx` + `tailwind-merge` — same as Splendor.

### Bot driver wiring

```tsx
import { useBotAttachOnTransition } from "@openturn/lobby/react";
import { createLocalSession } from "@openturn/core";
import { connectFour } from "@openturn/example-connect-four-game";
import { connectFourBotRegistry } from "@openturn/example-connect-four-bots";

const [rawSession] = useState(() => createLocalSession(connectFour, { match: { players: connectFour.playerIDs } }));
const facade = useBotAttachOnTransition({
  channel,
  game: connectFour,
  registry: connectFourBotRegistry,
  session: rawSession,
});
const session = facade ?? rawSession;
```

This is the simplest of the three patterns documented in `play-against-bots.mdx`. Bot moves dispatch through the matchStore so the inspector timeline shows them next to human moves.

### Accessibility

- Each column is a `<button>` element with `aria-label="Drop in column N (R empty cells remaining)"`.
- `role="grid"` on the board, `role="gridcell"` on each well, `aria-label="Row N Column M, [empty | red | yellow]"`.
- `StatusBanner` has `role="status"` and `aria-live="polite"`.
- Keyboard: `←` / `→` move a focus indicator across columns; `Enter` / `Space` drops; focus indicator is a `ring-2 ring-slate-400 ring-offset-2` on the column header.
- All interactive controls have a visible `focus-visible:ring-2 focus-visible:ring-slate-400` style.

### Dependencies (`app/package.json`)

```jsonc
{
  "dependencies": {
    "@openturn/example-connect-four-bots": "workspace:*",
    "@openturn/example-connect-four-game": "workspace:*",
    "@openturn/lobby": "workspace:*",
    "@openturn/react": "workspace:*",
    "@openturn/server": "workspace:*",
    "clsx": "^2.1.1",
    "framer-motion": "^11.18.0",
    "react": "^19.2.0",
    "react-dom": "^19.2.0",
    "tailwind-merge": "^3.0.0"
  },
  "devDependencies": {
    "@tailwindcss/vite": "^4.2.2",
    "@types/react": "^19.2.0",
    "@types/react-dom": "^19.2.0",
    "tailwindcss": "^4.2.2",
    "typescript": "^6.0.2"
  }
}
```

`hugeicons` and `class-variance-authority` (used by Splendor) are intentionally omitted — Connect Four needs neither icons nor button variants.

## 4. Cloud / runtime metadata

```ts
// app/app/openturn.ts
export const metadata = {
  name: "Connect Four",
  runtime: "multiplayer",
  multiplayer: { gameKey: "connect-four", schemaVersion: "1" },
};
```

App scripts (`app/package.json`):

```json
{
  "scripts": {
    "build": "bun run ../../../../packages/cli/src/index.ts build .",
    "deploy": "bun run ../../../../packages/cli/src/index.ts deploy . --project connect-four --name \"Connect Four\"",
    "dev": "bun run ../../../../packages/cli/src/index.ts dev . --port 3009",
    "start": "bun run ../../../../packages/cli/src/index.ts start . --port 3009",
    "typecheck": "bun x tsc -p tsconfig.json --pretty false"
  }
}
```

Port 3009 is one above Splendor's 3008 to avoid collisions when both run simultaneously.

The OSS dev server reads `game.bots` (set by `attachBots`) and populates `LobbyEnv.knownBots` automatically. The cloud Durable Object embeds `createHostedBotSupervisor` so bot moves dispatch through the same authoritative path humans do — no app glue beyond `attachBots(...)`.

## 5. Testing

### Game (`game/test/connect-four.test.ts`, `bun test`)

Use `createLocalSession` + `applyEvent` per the openturn skill's testing reference.

| Test | Setup | Assert |
|---|---|---|
| Vertical win | Setup with three reds in column 0, drop a fourth | `result.winner === "0"`, `winningLine` has 4 cells in column 0 |
| Horizontal win | Three reds in row 5, cols 1–3; drop red col 4 | winner red, `winningLine` is row 5 cols 1–4 |
| ╲ diagonal win | Manual setup; drop the closing piece | winner correct, `winningLine` is on the ╲ diagonal |
| ╱ diagonal win | Same, mirrored | winner correct, line on ╱ |
| Column full → invalid | Stack 6 alternating discs in col 3, attempt 7th | `move.invalid("column_full", { col: 3 })`, state unchanged |
| Draw | 42-move scripted log with no four-in-a-row | `result.draw === true`, no winner |
| Replay | Apply event log twice from `setup`; second pass | identical final snapshot (deep equal on `G`, `meta.result`, `meta.rng`) |

### Bots (`bots/test/bots.test.ts`, `bun test`)

| Test | Assert |
|---|---|
| Random — legal moves only | Over 1000 random snapshots, every returned action is in `legalActions` |
| Heuristic — find immediate win | 12 setups (one per win direction × 3 columns) where one drop wins; bot picks that column every time |
| Heuristic — block immediate threat | 12 setups where opponent wins on next move; bot picks the blocking column every time |
| Heuristic vs Random | 100 games; heuristic win rate ≥ 95% |
| Minimax (depth 6) — find immediate win | Same 12 setups as heuristic; bot picks the winning column |
| Minimax (depth 6) — block immediate threat | Same 12 setups; bot picks the blocking column |
| Minimax (depth 6) vs Heuristic | 20 games; minimax wins or draws every game |
| Minimax respects deadline | With `budgetMs: 50`, every `decide` call returns within 75ms (10ms tolerance for GC) |
| Determinism | Two `decide` calls on the same snapshot with the same forked `rng` return the same action |

### App (manual smoke per `play-against-bots.mdx` Step 4)

1. `bun --filter @openturn/example-connect-four-app dev`. Open the page, "Assign bot ▾ → Minimax" on seat 1, click Start. The bot plays, you finish a game.
2. Two browser tabs against the same dev server. Tab A takes seat 0. Tab B takes seat 1. Both see the game progress. Reload tab B mid-game; state restores from the room snapshot.
3. Seat 0 = human, seat 1 = Random bot. Verify the bot dropdown re-appears between matches.

## 6. Migration from current scaffold

Cutover, no compat shim, per `AGENTS.md` ("Cutover change is allowed and preferred and no migration/compatibility is needed"):

1. Delete `examples/games/connect-four/{app,package.json,tsconfig.json,bun.lock,node_modules}`. The tic-tac-toe code currently in `app/game.ts` (mismatched with the package name) goes away entirely.
2. Create the three new packages following Splendor's `package.json` / `tsconfig.json` shape exactly. Each gets its own `tsconfig.tsbuildinfo` in gitignore (already covered by the repo-root `.gitignore`'s `*.tsbuildinfo`).
3. Add a changeset `.md` under `.changeset/` documenting "Add Connect Four hosted-multiplayer example with bots". Per `AGENTS.md` this is required per PR.
4. Confirm the bun workspace globs (`workspaces` in the root `package.json`) already include `examples/games/*/{game,bots,app}` — Splendor uses the same pattern, so they should. If not, add the new package paths explicitly.
5. Add `.superpowers/` to `openturn/.gitignore` so visual-companion brainstorm artifacts don't get committed (currently missing; the brainstorm session for this spec wrote to `openturn/.superpowers/brainstorm/`).

## 7. Out-of-band

**Rough LOC budget:**

| Package | LOC (TS+TSX, incl. tests) |
|---|---|
| `game/` | ~200 |
| `bots/` | ~350 |
| `app/` | ~600 |
| **Total** | **~1150** |

Splendor totals roughly 3–4× this; Connect Four's smaller game state and simpler UI keep the budget tight without sacrificing polish.

**Performance notes:**
- `findWinningLine` runs in O(1) per move (only the cell just placed needs to be examined). Win detection over a 42-move game is ~42 × 16 cell reads.
- Minimax depth 6 with center-out move ordering and alpha-beta runs ~100k positions/sec in V8 on a modern laptop, well within `budgetMs: 2000` for the 100k–300k positions a depth-6 search visits.
- `framer-motion` drop animation is hardware-accelerated transform; even on a low-end mobile device the spring resolves in <250ms with no jank.

**Dev-loop sanity:**
- `bun --filter @openturn/example-connect-four-game test` for game logic.
- `bun --filter @openturn/example-connect-four-bots test` for bot logic.
- `bun --filter @openturn/example-connect-four-app dev` to open the lobby.
- The `?preview=local` URL param skips the lobby entirely for board-layout work.
- The openturn inspector (loaded by the dev server) shows the matchStore timeline including bot moves.
