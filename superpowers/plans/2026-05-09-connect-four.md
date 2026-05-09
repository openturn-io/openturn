# Connect Four Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current single-package `examples/games/connect-four/` scaffold (which still contains tic-tac-toe game logic) with a Splendor-tier Connect Four example: three workspace packages (`game/`, `bots/`, `app/`), three difficulty-tiered bots in the lobby, modern-minimalist Tailwind v4 UI with framer-motion drop animations, deployable to Openturn Cloud.

**Architecture:** Mirror Splendor's three-package layout exactly. `game/` (worker runtime) defines `defineGame(...)`, helpers, and views. `bots/` (worker runtime) declares the registry and `attachBots(connectFour, registry)` to produce `connectFourWithBots`. `app/` (browser runtime) renders `<LobbyWithBots>` for seat/bot selection and a board with `useBotAttachOnTransition` for in-process bot driving. Local dev and Openturn Cloud share the same code path.

**Tech Stack:** TypeScript (strict), `@openturn/{core,gamekit,bot,lobby,react,server}` (workspace), `bun:test`, React 19, Tailwind v4, `framer-motion`, `clsx`, `tailwind-merge`. Worker tsconfig for game/ + bots/, browser tsconfig for app/.

**Spec:** `openturn/superpowers/specs/2026-05-09-connect-four-design.md`

---

## Working directory

All paths are relative to the openturn monorepo: `/Users/jameszhang_work/Github/openturn/openturn/`. The connect-four sub-tree lives at `examples/games/connect-four/`. Run all `bun` commands from the openturn root unless noted.

## Reference packages

When you're unsure how a Splendor pattern looks in concrete code, read these files:

- Splendor game shape: `examples/games/splendor/game/{package.json,tsconfig.json,src/index.ts,src/splendor.test.ts}`
- Splendor bots shape: `examples/games/splendor/bots/{package.json,tsconfig.json,src/index.ts,src/index.test.ts}`
- Splendor app shape: `examples/games/splendor/app/{package.json,tsconfig.json,app/page.tsx,app/openturn.ts,src/lib/utils.ts,src/styles.css}`
- Tic-tac-toe bots reference (cleaner than Splendor's): `examples/games/tic-tac-toe/bots/src/{index.ts,random.ts,minimax.ts,index.test.ts}`
- pig-dice tests (concise reference): `examples/games/pig-dice/game/src/pig-dice.test.ts`

The openturn skill at `skills/openturn/SKILL.md` covers the gamekit idioms; the bots reference at `skills/openturn/references/bots.md` covers the bot decide contract.

---

## Phase 0 — Cutover prep

### Task 1: Delete the existing single-package scaffold

**Files:**
- Delete: `examples/games/connect-four/app/`
- Delete: `examples/games/connect-four/package.json`
- Delete: `examples/games/connect-four/tsconfig.json`
- Delete: `examples/games/connect-four/bun.lock`
- Delete: `examples/games/connect-four/node_modules/`

The current scaffold has tic-tac-toe code in `app/game.ts` despite being named connect-four. Per `AGENTS.md`, cutover is preferred — no migration shim, no compatibility layer.

- [ ] **Step 1: Confirm what's there**

Run from repo root:
```bash
ls examples/games/connect-four/
```
Expected: `app  node_modules  bun.lock  package.json  tsconfig.json`

- [ ] **Step 2: Delete the scaffold contents**

```bash
rm -rf examples/games/connect-four/app
rm -f examples/games/connect-four/package.json
rm -f examples/games/connect-four/tsconfig.json
rm -f examples/games/connect-four/bun.lock
rm -rf examples/games/connect-four/node_modules
```

- [ ] **Step 3: Verify the directory is empty**

```bash
ls examples/games/connect-four/
```
Expected: empty output (or just `.DS_Store` on macOS).

- [ ] **Step 4: Commit**

```bash
git add -A examples/games/connect-four/
git commit -m "refactor(connect-four): remove single-package scaffold (was tic-tac-toe code)"
```

---

### Task 2: Add `.superpowers/` to gitignore

**Files:**
- Modify: `.gitignore`

The brainstorm session for this spec wrote artifacts under `.superpowers/brainstorm/`. The directory isn't in gitignore yet.

- [ ] **Step 1: Read the current gitignore**

```bash
cat .gitignore
```

- [ ] **Step 2: Add the entry**

Append `.superpowers/` to `.gitignore`. The file should now contain a section like:

```
# Superpowers brainstorm/plan artifacts
.superpowers/
```

- [ ] **Step 3: Verify**

```bash
git status
```
Expected: `.superpowers/` no longer appears as untracked.

- [ ] **Step 4: Commit**

```bash
git add .gitignore
git commit -m "chore: ignore .superpowers/ brainstorm artifacts"
```

---

### Task 3: Wire the new package names into the root typecheck scripts

**Files:**
- Modify: `package.json` (root) — `scripts.typecheck:worker` and `scripts.typecheck:browser`

The root `package.json` lists every example package by name in `typecheck:worker` and `typecheck:browser`. The `typecheck:examples` script uses a glob and covers our new packages automatically, but the per-runtime scripts must be updated explicitly to match the existing pattern.

- [ ] **Step 1: Locate the lines**

Open `package.json`. Find `"typecheck:worker"` (long single-line script ending in `'@openturn/example-splendor-bots'`) and `"typecheck:browser"` (ending in `'@openturn/example-battleship-app'`).

- [ ] **Step 2: Append the connect-four entries**

In `typecheck:worker`, append after the `splendor-bots` clause:

```
 && bun run --filter '@openturn/example-connect-four-game' --if-present typecheck && bun run --filter '@openturn/example-connect-four-bots' --if-present typecheck
```

In `typecheck:browser`, append after the `battleship-app` clause:

```
 && bun run --filter '@openturn/example-connect-four-app' --if-present typecheck
```

- [ ] **Step 3: Verify the JSON still parses**

```bash
bun -e 'JSON.parse(require("fs").readFileSync("package.json","utf8"))'
```
Expected: silent (no output) on success; an error if the JSON is malformed.

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "chore(scripts): register connect-four packages in typecheck:{worker,browser}"
```

---

## Phase 1 — `game/` package

### Task 4: Scaffold the `game/` package

**Files:**
- Create: `examples/games/connect-four/game/package.json`
- Create: `examples/games/connect-four/game/tsconfig.json`
- Create: `examples/games/connect-four/game/src/index.ts` (skeleton; filled in over later tasks)

- [ ] **Step 1: Create `package.json`**

`examples/games/connect-four/game/package.json`:

```json
{
  "name": "@openturn/example-connect-four-game",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "openturn": {
    "runtime": "worker"
  },
  "exports": {
    ".": "./src/index.ts"
  },
  "types": "./src/index.ts",
  "scripts": {
    "test": "bun test",
    "typecheck": "bun x tsc -p tsconfig.json --pretty false"
  },
  "dependencies": {
    "@openturn/core": "workspace:*",
    "@openturn/gamekit": "workspace:*"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

`examples/games/connect-four/game/tsconfig.json`:

```json
{
  "extends": "../../../../tsconfig.worker.json",
  "compilerOptions": {
    "composite": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["src/**/*.test.ts"]
}
```

- [ ] **Step 3: Create the `src/index.ts` stub**

`examples/games/connect-four/game/src/index.ts`:

```ts
export type Mark = "0" | "1";
export type Cell = Mark | null;
export type Board = Cell[][];

export const ROWS = 6;
export const COLS = 7;
```

- [ ] **Step 4: Install workspace deps**

From the openturn root:

```bash
bun install
```
Expected: `bun install` resolves successfully and reports the new workspace package.

- [ ] **Step 5: Verify typecheck passes**

```bash
bun --filter @openturn/example-connect-four-game typecheck
```
Expected: exits 0 with no errors.

- [ ] **Step 6: Commit**

```bash
git add examples/games/connect-four/game/ bun.lock
git commit -m "feat(connect-four): scaffold game/ package"
```

---

### Task 5: TDD `lowestEmptyRow` helper

**Files:**
- Create: `examples/games/connect-four/game/src/board.ts`
- Create: `examples/games/connect-four/game/src/connect-four.test.ts`
- Modify: `examples/games/connect-four/game/src/index.ts`

The convention: `board[0]` is the top row, `board[5]` is the bottom. Drop physics scan rows 5→0 looking for the first empty cell.

- [ ] **Step 1: Write the failing tests**

Create `examples/games/connect-four/game/src/connect-four.test.ts`:

```ts
import { describe, expect, test } from "bun:test";

import { lowestEmptyRow } from "./board";
import type { Board } from "./index";

function emptyBoard(): Board {
  return Array.from({ length: 6 }, () => Array(7).fill(null));
}

describe("lowestEmptyRow", () => {
  test("returns 5 (bottom) for an empty column", () => {
    const board = emptyBoard();
    expect(lowestEmptyRow(board, 3)).toBe(5);
  });

  test("returns 4 when bottom row has a disc in that column", () => {
    const board = emptyBoard();
    board[5]![3] = "0";
    expect(lowestEmptyRow(board, 3)).toBe(4);
  });

  test("returns 0 (top) when only the top row in that column is empty", () => {
    const board = emptyBoard();
    for (let r = 5; r >= 1; r -= 1) board[r]![2] = r % 2 === 0 ? "0" : "1";
    expect(lowestEmptyRow(board, 2)).toBe(0);
  });

  test("returns -1 when the column is full", () => {
    const board = emptyBoard();
    for (let r = 5; r >= 0; r -= 1) board[r]![1] = "0";
    expect(lowestEmptyRow(board, 1)).toBe(-1);
  });
});
```

- [ ] **Step 2: Run the test — expect failure**

```bash
bun --filter @openturn/example-connect-four-game test
```
Expected: FAIL with `Cannot find module './board'` (or similar import error).

- [ ] **Step 3: Implement `board.ts`**

Create `examples/games/connect-four/game/src/board.ts`:

```ts
import type { Board, Cell, Mark } from "./index";

/**
 * Returns the row index (0-5) where a disc dropped into `col` would land.
 * Returns -1 when the column is full. board[0] is the top row.
 */
export function lowestEmptyRow(board: Board, col: number): number {
  for (let r = board.length - 1; r >= 0; r -= 1) {
    if (board[r]![col] === null) return r;
  }
  return -1;
}
```

- [ ] **Step 4: Re-export from `index.ts`**

Append to `examples/games/connect-four/game/src/index.ts`:

```ts
export { lowestEmptyRow } from "./board";
```

- [ ] **Step 5: Run the test — expect pass**

```bash
bun --filter @openturn/example-connect-four-game test
```
Expected: 4 tests pass.

- [ ] **Step 6: Commit**

```bash
git add examples/games/connect-four/game/
git commit -m "feat(connect-four/game): add lowestEmptyRow helper"
```

---

### Task 6: TDD `withDisc` helper

**Files:**
- Modify: `examples/games/connect-four/game/src/board.ts`
- Modify: `examples/games/connect-four/game/src/connect-four.test.ts`
- Modify: `examples/games/connect-four/game/src/index.ts`

- [ ] **Step 1: Add the failing tests**

Append to `connect-four.test.ts`:

```ts
import { withDisc } from "./board";

describe("withDisc", () => {
  test("places a disc at (r, c) and returns a new array (immutable)", () => {
    const before = emptyBoard();
    const after = withDisc(before, 5, 3, "0");
    expect(after[5]![3]).toBe("0");
    expect(before[5]![3]).toBeNull();
    expect(after).not.toBe(before);
  });

  test("preserves other cells exactly", () => {
    const before = emptyBoard();
    before[5]![0] = "1";
    const after = withDisc(before, 4, 0, "0");
    expect(after[5]![0]).toBe("1");
    expect(after[4]![0]).toBe("0");
    expect(after[3]![0]).toBeNull();
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
bun --filter @openturn/example-connect-four-game test
```
Expected: FAIL with `withDisc is not exported`.

- [ ] **Step 3: Implement**

Append to `board.ts`:

```ts
/**
 * Returns a new board with `mark` placed at (r, c). The other rows are
 * reference-shared; only the row at `r` is rebuilt.
 */
export function withDisc(board: Board, r: number, c: number, mark: Mark): Board {
  return board.map((row, rowIndex) =>
    rowIndex === r ? row.map((cell, colIndex) => (colIndex === c ? mark : cell)) : row,
  );
}
```

- [ ] **Step 4: Re-export**

Modify `index.ts`'s board re-export line to:

```ts
export { lowestEmptyRow, withDisc } from "./board";
```

- [ ] **Step 5: Run — expect pass**

```bash
bun --filter @openturn/example-connect-four-game test
```
Expected: 6 tests pass.

- [ ] **Step 6: Commit**

```bash
git add examples/games/connect-four/game/
git commit -m "feat(connect-four/game): add withDisc helper"
```

---

### Task 7: TDD `findWinningLine` — vertical, horizontal, both diagonals

**Files:**
- Modify: `examples/games/connect-four/game/src/board.ts`
- Modify: `examples/games/connect-four/game/src/connect-four.test.ts`
- Modify: `examples/games/connect-four/game/src/index.ts`

`findWinningLine(board, r, c)` is called immediately after a disc has been placed at `(r, c)`. It scans the four directions through `(r, c)` and returns the 4 winning cells, or `null` if no win.

- [ ] **Step 1: Add the failing tests**

Append to `connect-four.test.ts`:

```ts
import { findWinningLine } from "./board";

describe("findWinningLine", () => {
  test("vertical 4-in-a-row through (2, 3) for player 0", () => {
    const board = emptyBoard();
    board[2]![3] = "0";
    board[3]![3] = "0";
    board[4]![3] = "0";
    board[5]![3] = "0";
    const line = findWinningLine(board, 2, 3);
    expect(line).toEqual([
      { row: 2, col: 3 },
      { row: 3, col: 3 },
      { row: 4, col: 3 },
      { row: 5, col: 3 },
    ]);
  });

  test("horizontal 4-in-a-row through (5, 3) for player 1", () => {
    const board = emptyBoard();
    board[5]![1] = "1";
    board[5]![2] = "1";
    board[5]![3] = "1";
    board[5]![4] = "1";
    const line = findWinningLine(board, 5, 3);
    expect(line).toEqual([
      { row: 5, col: 1 },
      { row: 5, col: 2 },
      { row: 5, col: 3 },
      { row: 5, col: 4 },
    ]);
  });

  test("\\ diagonal win through (3, 3)", () => {
    const board = emptyBoard();
    board[2]![2] = "0";
    board[3]![3] = "0";
    board[4]![4] = "0";
    board[5]![5] = "0";
    const line = findWinningLine(board, 3, 3);
    expect(line).toEqual([
      { row: 2, col: 2 },
      { row: 3, col: 3 },
      { row: 4, col: 4 },
      { row: 5, col: 5 },
    ]);
  });

  test("/ diagonal win through (3, 3)", () => {
    const board = emptyBoard();
    board[5]![1] = "1";
    board[4]![2] = "1";
    board[3]![3] = "1";
    board[2]![4] = "1";
    const line = findWinningLine(board, 3, 3);
    expect(line).toEqual([
      { row: 2, col: 4 },
      { row: 3, col: 3 },
      { row: 4, col: 2 },
      { row: 5, col: 1 },
    ]);
  });

  test("3-in-a-row is NOT a win", () => {
    const board = emptyBoard();
    board[5]![1] = "0";
    board[5]![2] = "0";
    board[5]![3] = "0";
    expect(findWinningLine(board, 5, 2)).toBeNull();
  });

  test("returns null when (r, c) is empty", () => {
    const board = emptyBoard();
    expect(findWinningLine(board, 5, 0)).toBeNull();
  });

  test("does not span across mismatched marks", () => {
    const board = emptyBoard();
    board[5]![0] = "0";
    board[5]![1] = "0";
    board[5]![2] = "1";
    board[5]![3] = "0";
    board[5]![4] = "0";
    board[5]![5] = "0";
    expect(findWinningLine(board, 5, 0)).toBeNull();
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
bun --filter @openturn/example-connect-four-game test
```
Expected: FAIL with `findWinningLine is not exported`.

- [ ] **Step 3: Implement**

Append to `board.ts`:

```ts
export interface CellRef {
  row: number;
  col: number;
}

const DIRECTIONS: ReadonlyArray<readonly [dr: number, dc: number]> = [
  [0, 1],   // horizontal
  [1, 0],   // vertical
  [1, 1],   // \ diagonal (down-right)
  [1, -1],  // / diagonal (down-left)
] as const;

/**
 * Given that a disc was just placed at (r, c), check whether it completes
 * a 4-in-a-row in any of the four directions. Returns the 4 winning cells
 * (sorted by (row, col) ascending) or `null` if no win exists through (r, c).
 */
export function findWinningLine(board: Board, r: number, c: number): CellRef[] | null {
  const mark = board[r]?.[c];
  if (mark === null || mark === undefined) return null;

  for (const [dr, dc] of DIRECTIONS) {
    const cells: CellRef[] = [{ row: r, col: c }];
    // Walk forward
    let nr = r + dr;
    let nc = c + dc;
    while (board[nr]?.[nc] === mark) {
      cells.push({ row: nr, col: nc });
      nr += dr;
      nc += dc;
    }
    // Walk backward
    nr = r - dr;
    nc = c - dc;
    while (board[nr]?.[nc] === mark) {
      cells.push({ row: nr, col: nc });
      nr -= dr;
      nc -= dc;
    }
    if (cells.length >= 4) {
      const sorted = [...cells].sort((a, b) => (a.row - b.row) || (a.col - b.col));
      // Take the contiguous 4 that includes (r, c).
      return sorted.slice(0, 4);
    }
  }
  return null;
}
```

- [ ] **Step 4: Re-export**

Update the board re-export in `index.ts`:

```ts
export { lowestEmptyRow, withDisc, findWinningLine } from "./board";
export type { CellRef } from "./board";
```

- [ ] **Step 5: Run — expect pass**

```bash
bun --filter @openturn/example-connect-four-game test
```
Expected: all tests pass (13 total).

- [ ] **Step 6: Commit**

```bash
git add examples/games/connect-four/game/
git commit -m "feat(connect-four/game): add findWinningLine helper"
```

---

### Task 8: TDD initial setup of `defineGame(...)`

**Files:**
- Modify: `examples/games/connect-four/game/src/index.ts`
- Modify: `examples/games/connect-four/game/src/connect-four.test.ts`

- [ ] **Step 1: Add the failing test**

Append to `connect-four.test.ts`:

```ts
import { createLocalSession } from "@openturn/core";
import { connectFour } from "./index";

const connectFourMatch = { players: connectFour.playerIDs };

describe("connectFour setup", () => {
  test("starts with an empty 6x7 board, no last move, player 0 active", () => {
    const session = createLocalSession(connectFour, { match: connectFourMatch });
    const state = session.getState();
    expect(state.G.board).toEqual(
      Array.from({ length: 6 }, () => Array(7).fill(null)),
    );
    expect(state.G.lastMove).toBeNull();
    expect(state.derived.activePlayers).toEqual(["0"]);
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
bun --filter @openturn/example-connect-four-game test
```
Expected: FAIL — `connectFour is not exported from "./index"`.

- [ ] **Step 3: Implement `connectFour` in `index.ts`**

Replace the contents of `examples/games/connect-four/game/src/index.ts` with:

```ts
import { defineGame, turn } from "@openturn/gamekit";

export type Mark = "0" | "1";
export type Cell = Mark | null;
export type Board = Cell[][];

export const ROWS = 6;
export const COLS = 7;

export interface ConnectFourState {
  board: Board;
  lastMove: { col: number; row: number; player: Mark } | null;
}

export interface DropDiscArgs {
  col: number;
}

export { lowestEmptyRow, withDisc, findWinningLine } from "./board";
export type { CellRef } from "./board";

export const connectFour = defineGame({
  playerIDs: ["0", "1"] as const,
  setup: (): ConnectFourState => ({
    board: Array.from({ length: ROWS }, () => Array<Cell>(COLS).fill(null)),
    lastMove: null,
  }),
  turn: turn.roundRobin(),
  moves: () => ({}),
});
```

- [ ] **Step 4: Run — expect pass**

```bash
bun --filter @openturn/example-connect-four-game test
```
Expected: setup test passes; existing helper tests still pass (14 total).

- [ ] **Step 5: Commit**

```bash
git add examples/games/connect-four/game/
git commit -m "feat(connect-four/game): scaffold connectFour with empty moves"
```

---

### Task 9: TDD the `dropDisc` move — successful drop ends turn

**Files:**
- Modify: `examples/games/connect-four/game/src/index.ts`
- Modify: `examples/games/connect-four/game/src/connect-four.test.ts`

- [ ] **Step 1: Add the failing test**

Append to `connect-four.test.ts`:

```ts
describe("dropDisc — happy path", () => {
  test("drops on an empty column, lands at row 5, ends the turn", () => {
    const session = createLocalSession(connectFour, { match: connectFourMatch });
    const result = session.applyEvent("0", "dropDisc", { col: 3 });
    expect(result.ok).toBe(true);

    const state = session.getState();
    expect(state.G.board[5]![3]).toBe("0");
    expect(state.G.board[4]![3]).toBeNull();
    expect(state.G.lastMove).toEqual({ col: 3, row: 5, player: "0" });
    expect(state.derived.activePlayers).toEqual(["1"]);
  });

  test("two consecutive drops in the same column stack 0 then 1", () => {
    const session = createLocalSession(connectFour, { match: connectFourMatch });
    session.applyEvent("0", "dropDisc", { col: 3 });
    session.applyEvent("1", "dropDisc", { col: 3 });
    const state = session.getState();
    expect(state.G.board[5]![3]).toBe("0");
    expect(state.G.board[4]![3]).toBe("1");
    expect(state.G.lastMove).toEqual({ col: 3, row: 4, player: "1" });
    expect(state.derived.activePlayers).toEqual(["0"]);
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
bun --filter @openturn/example-connect-four-game test
```
Expected: FAIL — applyEvent for `dropDisc` returns an error because the move isn't defined yet.

- [ ] **Step 3: Implement the `dropDisc` move**

Replace the `moves: () => ({})` line in `index.ts` with the full game definition. The complete `index.ts` after this step:

```ts
import { defineGame, turn } from "@openturn/gamekit";

import { findWinningLine, lowestEmptyRow, withDisc } from "./board";

export type Mark = "0" | "1";
export type Cell = Mark | null;
export type Board = Cell[][];

export const ROWS = 6;
export const COLS = 7;

export interface ConnectFourState {
  board: Board;
  lastMove: { col: number; row: number; player: Mark } | null;
}

export interface DropDiscArgs {
  col: number;
}

export { lowestEmptyRow, withDisc, findWinningLine } from "./board";
export type { CellRef } from "./board";

export const connectFour = defineGame({
  playerIDs: ["0", "1"] as const,
  setup: (): ConnectFourState => ({
    board: Array.from({ length: ROWS }, () => Array<Cell>(COLS).fill(null)),
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
    return Array.from({ length: COLS }, (_, col) => col)
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
    public: ({ G, turn: t, derived }) => ({
      board: G.board,
      lastMove: G.lastMove,
      currentPlayer: t.currentPlayer,
      winningLine: derived.winningLine,
    }),
    player: ({ G, turn: t, derived }) => ({
      board: G.board,
      lastMove: G.lastMove,
      currentPlayer: t.currentPlayer,
      winningLine: derived.winningLine,
    }),
  },
});
```

- [ ] **Step 4: Run — expect pass**

```bash
bun --filter @openturn/example-connect-four-game test
```
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add examples/games/connect-four/game/
git commit -m "feat(connect-four/game): implement dropDisc move"
```

---

### Task 10: TDD `dropDisc` rejection paths — column full

**Files:**
- Modify: `examples/games/connect-four/game/src/connect-four.test.ts`

- [ ] **Step 1: Add the failing test**

Append to `connect-four.test.ts`:

```ts
describe("dropDisc — rejections", () => {
  test("drop into a full column returns invalid_event with column_full reason", () => {
    const session = createLocalSession(connectFour, { match: connectFourMatch });
    // Stack 6 alternating discs in column 0.
    for (let i = 0; i < 6; i += 1) {
      const player = i % 2 === 0 ? "0" : "1";
      session.applyEvent(player, "dropDisc", { col: 0 });
    }
    const result = session.applyEvent("0", "dropDisc", { col: 0 });
    expect(result).toEqual({
      details: { col: 0 },
      error: "invalid_event",
      ok: false,
      reason: "column_full",
    });
  });

  test("drop by the wrong player is rejected as not-active", () => {
    const session = createLocalSession(connectFour, { match: connectFourMatch });
    const result = session.applyEvent("1", "dropDisc", { col: 3 });
    expect(result.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run — expect pass on the column_full test (already implemented by Task 9), and the wrong-player test should also pass because the engine rejects events from non-active players**

```bash
bun --filter @openturn/example-connect-four-game test
```
Expected: all tests pass. (If the wrong-player test fails because the engine returns a different shape, adjust the assertion to `expect(result.ok).toBe(false)` only — leave the column_full assertion strict.)

- [ ] **Step 3: Commit**

```bash
git add examples/games/connect-four/game/
git commit -m "test(connect-four/game): cover dropDisc rejection paths"
```

---

### Task 11: TDD win detection in each direction via real session play

**Files:**
- Modify: `examples/games/connect-four/game/src/connect-four.test.ts`

- [ ] **Step 1: Add the failing tests**

Append to `connect-four.test.ts`:

```ts
describe("dropDisc — win detection", () => {
  function play(session: ReturnType<typeof createLocalSession>, moves: ReadonlyArray<readonly [Mark, number]>): void {
    for (const [player, col] of moves) {
      const result = session.applyEvent(player, "dropDisc", { col });
      if (!result.ok) throw new Error(`unexpected reject: ${JSON.stringify(result)}`);
    }
  }

  test("vertical win for player 0 — 4 reds in column 3", () => {
    const session = createLocalSession(connectFour, { match: connectFourMatch });
    play(session, [
      ["0", 3], ["1", 4],
      ["0", 3], ["1", 4],
      ["0", 3], ["1", 4],
      ["0", 3],
    ]);
    expect(session.getResult()).toEqual({ winner: "0" });
  });

  test("horizontal win for player 1 — 4 yellows in row 5", () => {
    const session = createLocalSession(connectFour, { match: connectFourMatch });
    play(session, [
      ["0", 0], ["1", 1],
      ["0", 0], ["1", 2],
      ["0", 0], ["1", 3],
      ["0", 1], ["1", 4],
    ]);
    expect(session.getResult()).toEqual({ winner: "1" });
  });

  test("\\ diagonal win for player 0", () => {
    const session = createLocalSession(connectFour, { match: connectFourMatch });
    play(session, [
      ["0", 0], ["1", 1],
      ["0", 1], ["1", 2],
      ["0", 3], ["1", 2],
      ["0", 2], ["1", 5],
      ["0", 3], ["1", 6],
      ["0", 3], ["1", 5],
      ["0", 3],
    ]);
    expect(session.getResult()).toEqual({ winner: "0" });
  });

  test("/ diagonal win for player 0", () => {
    const session = createLocalSession(connectFour, { match: connectFourMatch });
    play(session, [
      ["0", 3], ["1", 2],
      ["0", 2], ["1", 1],
      ["0", 1], ["1", 0],
      ["0", 0], ["1", 1],
      ["0", 0], ["1", 0],
      ["0", 0],
    ]);
    expect(session.getResult()).toEqual({ winner: "0" });
  });
});
```

- [ ] **Step 2: Run — expect pass**

```bash
bun --filter @openturn/example-connect-four-game test
```
Expected: 4 win-detection tests pass. If any test fails because the script doesn't actually create a 4-in-a-row, fix the move sequence in the test by drawing it on paper first; the expected outcome is `{ winner }`. Both diagonal scripts above are constructed so the named player completes the diagonal; if you adjust them, recompute and update.

- [ ] **Step 3: Commit**

```bash
git add examples/games/connect-four/game/
git commit -m "test(connect-four/game): cover win detection in all four directions"
```

---

### Task 12: TDD `legalActions` enumeration

**Files:**
- Modify: `examples/games/connect-four/game/src/connect-four.test.ts`

- [ ] **Step 1: Add the failing test**

Append to `connect-four.test.ts`:

```ts
describe("legalActions", () => {
  test("enumerates all 7 columns at game start for the active player", () => {
    const session = createLocalSession(connectFour, { match: connectFourMatch });
    const actions = connectFour.legalActions!(session.getState() as never, "0" as never);
    expect(actions).toHaveLength(7);
    expect(actions.map((a) => (a.payload as DropDiscArgs).col).sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  test("returns empty for the non-active player", () => {
    const session = createLocalSession(connectFour, { match: connectFourMatch });
    const actions = connectFour.legalActions!(session.getState() as never, "1" as never);
    expect(actions).toEqual([]);
  });

  test("excludes a column once it's been filled to the top", () => {
    const session = createLocalSession(connectFour, { match: connectFourMatch });
    for (let i = 0; i < 6; i += 1) {
      const player = i % 2 === 0 ? "0" : "1";
      session.applyEvent(player, "dropDisc", { col: 0 });
    }
    // Now whoever's active should not have col 0 in their legal actions.
    const active = session.getState().derived.activePlayers[0]! as Mark;
    const actions = connectFour.legalActions!(session.getState() as never, active as never);
    expect(actions.map((a) => (a.payload as DropDiscArgs).col)).not.toContain(0);
  });
});
```

- [ ] **Step 2: Run — expect pass (legalActions was added in Task 9)**

```bash
bun --filter @openturn/example-connect-four-game test
```
Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add examples/games/connect-four/game/
git commit -m "test(connect-four/game): cover legalActions enumeration"
```

---

### Task 13: TDD draw outcome

**Files:**
- Modify: `examples/games/connect-four/game/src/connect-four.test.ts`

- [ ] **Step 1: Add the failing test**

Append to `connect-four.test.ts`:

```ts
describe("dropDisc — draw", () => {
  test("filling the board without a 4-in-a-row finishes with draw: true", () => {
    const session = createLocalSession(connectFour, { match: connectFourMatch });

    // A scripted 42-move sequence that fills the board without any 4-in-a-row.
    // Pattern: pairs of columns rotated to break alignments.
    // We build it programmatically: for each column 0..6, alternate the colour pattern
    // by column index parity so vertical wins are impossible, and stagger horizontal
    // pairs by row parity so horizontal wins are impossible.
    const script: ReadonlyArray<readonly [Mark, number]> = [
      // Bottom rows: 0 0 1 1 0 0 1
      ["0", 0], ["1", 2],
      ["0", 1], ["1", 3],
      ["0", 4], ["1", 5],
      ["0", 5], ["1", 0],
      ["0", 1], ["1", 4],
      ["0", 2], ["1", 6],
      ["0", 6], ["1", 1],
      ["0", 3], ["1", 0],
      ["0", 4], ["1", 1],
      ["0", 0], ["1", 3],
      ["0", 2], ["1", 4],
      ["0", 5], ["1", 2],
      ["0", 6], ["1", 5],
      ["0", 6], ["1", 3],
      ["0", 5], ["1", 2],
      ["0", 6], ["1", 4],
      ["0", 3], ["1", 6],
      ["0", 4], ["1", 5],
      ["0", 0], ["1", 1],
      ["0", 2], ["1", 3],
      ["0", 0], ["1", 1],
    ];

    for (const [player, col] of script) {
      const r = session.applyEvent(player, "dropDisc", { col });
      // If the script produces an early win/draw or invalid, fail informatively.
      if (!r.ok) {
        const result = session.getResult();
        if (result !== null && result !== undefined) {
          throw new Error(`script ended early with result ${JSON.stringify(result)}`);
        }
        throw new Error(`unexpected reject ${JSON.stringify(r)}`);
      }
    }

    const result = session.getResult();
    // Either the script produces a draw (preferred) or a winner; if a winner,
    // the script needs adjustment. If you see a winner here, swap two
    // adjacent moves in the script and recompute.
    expect(result).not.toBeNull();
    if (result !== null && "winner" in (result ?? {})) {
      throw new Error(`script produced winner ${JSON.stringify(result)} — adjust the move order`);
    }
    expect(result).toEqual({ draw: true });
  });
});
```

> **Note:** the move order is an example. If running it produces an early win, swap adjacent moves in the script and re-run until you get a draw. The point of the test is "42 moves, no four-in-a-row, finishes with `{ draw: true }`" — the specific script is incidental.

- [ ] **Step 2: Run — iterate until pass**

```bash
bun --filter @openturn/example-connect-four-game test
```
Expected: the draw test passes. If it fails because of an early win, adjust the script and re-run.

- [ ] **Step 3: Commit**

```bash
git add examples/games/connect-four/game/
git commit -m "test(connect-four/game): cover draw outcome on a full board"
```

---

### Task 14: Verify game/ typecheck and finalize Phase 1

**Files:**
- (none modified)

- [ ] **Step 1: Run typecheck**

```bash
bun --filter @openturn/example-connect-four-game typecheck
```
Expected: exits 0 with no errors.

- [ ] **Step 2: Run the full game test suite**

```bash
bun --filter @openturn/example-connect-four-game test
```
Expected: all tests pass.

- [ ] **Step 3: Run the runtime-boundary check**

```bash
bun run check:runtimes
```
Expected: exits 0 with no violations. The game package must not import Bun/Node globals.

- [ ] **Step 4: No commit needed if everything is green** (these are verifications only; if any fix is required, commit it before moving on).

---

## Phase 2 — `bots/` package

### Task 15: Scaffold the `bots/` package

**Files:**
- Create: `examples/games/connect-four/bots/package.json`
- Create: `examples/games/connect-four/bots/tsconfig.json`
- Create: `examples/games/connect-four/bots/src/index.ts` (skeleton)

- [ ] **Step 1: Create `package.json`**

`examples/games/connect-four/bots/package.json`:

```json
{
  "name": "@openturn/example-connect-four-bots",
  "private": true,
  "type": "module",
  "openturn": {
    "runtime": "worker"
  },
  "exports": {
    ".": "./src/index.ts"
  },
  "types": "./src/index.ts",
  "scripts": {
    "test": "bun test",
    "typecheck": "bun x tsc -p tsconfig.json --pretty false"
  },
  "dependencies": {
    "@openturn/bot": "workspace:*",
    "@openturn/core": "workspace:*",
    "@openturn/example-connect-four-game": "workspace:*",
    "@openturn/lobby": "workspace:*"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

`examples/games/connect-four/bots/tsconfig.json`:

```json
{
  "extends": "../../../../tsconfig.worker.json",
  "compilerOptions": {
    "composite": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["src/**/*.test.ts"]
}
```

- [ ] **Step 3: Create the stub**

`examples/games/connect-four/bots/src/index.ts`:

```ts
export {};
```

- [ ] **Step 4: Install workspace deps**

From the repo root:

```bash
bun install
```

- [ ] **Step 5: Verify typecheck**

```bash
bun --filter @openturn/example-connect-four-bots typecheck
```
Expected: exits 0.

- [ ] **Step 6: Commit**

```bash
git add examples/games/connect-four/bots/ bun.lock
git commit -m "feat(connect-four): scaffold bots/ package"
```

---

### Task 16: TDD the random bot

**Files:**
- Create: `examples/games/connect-four/bots/src/random.ts`
- Create: `examples/games/connect-four/bots/src/index.test.ts`

- [ ] **Step 1: Write the failing test**

Create `examples/games/connect-four/bots/src/index.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { createDeterministicRng } from "@openturn/core";
import { connectFour, type DropDiscArgs } from "@openturn/example-connect-four-game";
import type { LegalAction } from "@openturn/bot";

import { randomBot } from "./random";

const playerView = {
  board: Array.from({ length: 6 }, () => Array(7).fill(null)),
  lastMove: null,
  currentPlayer: "0" as const,
  winningLine: null,
};

const fiveLegalCols: LegalAction[] = [0, 2, 3, 4, 6].map((col) => ({
  event: "dropDisc",
  payload: { col },
  label: `Col ${col + 1}`,
}));

describe("randomBot", () => {
  test("picks a legal action only", async () => {
    const rng = createDeterministicRng("seed-1");
    const action = await randomBot.decide({
      playerID: "0" as never,
      view: playerView as never,
      snapshot: { G: { board: playerView.board, lastMove: null }, derived: { activePlayers: ["0"] } } as never,
      legalActions: fiveLegalCols,
      rng,
      deadline: { remainingMs: () => 1000, expired: () => false },
      signal: new AbortController().signal,
      simulate: () => { throw new Error("randomBot must not call simulate"); },
    });
    expect(fiveLegalCols).toContainEqual(action);
  });

  test("two calls with the same seed return the same action", async () => {
    const args = (rng: ReturnType<typeof createDeterministicRng>) => ({
      playerID: "0" as never,
      view: playerView as never,
      snapshot: { G: { board: playerView.board, lastMove: null }, derived: { activePlayers: ["0"] } } as never,
      legalActions: fiveLegalCols,
      rng,
      deadline: { remainingMs: () => 1000, expired: () => false },
      signal: new AbortController().signal,
      simulate: () => { throw new Error("must not be called"); },
    });
    const a = await randomBot.decide(args(createDeterministicRng("same-seed")));
    const b = await randomBot.decide(args(createDeterministicRng("same-seed")));
    expect(a).toEqual(b);
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
bun --filter @openturn/example-connect-four-bots test
```
Expected: FAIL — `Cannot find module './random'`.

- [ ] **Step 3: Implement `random.ts`**

Create `examples/games/connect-four/bots/src/random.ts`:

```ts
import { defineBot } from "@openturn/bot";
import type { connectFour } from "@openturn/example-connect-four-game";

export const randomBot = defineBot<typeof connectFour>({
  name: "random",
  decide({ legalActions, rng }) {
    if (legalActions.length === 0) {
      throw new Error("randomBot: no legal actions available");
    }
    return rng.pick(legalActions);
  },
});
```

- [ ] **Step 4: Run — expect pass**

```bash
bun --filter @openturn/example-connect-four-bots test
```
Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add examples/games/connect-four/bots/
git commit -m "feat(connect-four/bots): add randomBot"
```

---

### Task 17: TDD the heuristic bot — immediate win + immediate block

**Files:**
- Create: `examples/games/connect-four/bots/src/heuristic.ts`
- Modify: `examples/games/connect-four/bots/src/index.test.ts`

The heuristic scores each legal column:
1. Drop here makes 4-in-a-row → score `Infinity`.
2. Opponent dropping here would make 4-in-a-row → score `10_000` (block).
3. Center bias `[3, 4, 5, 7, 5, 4, 3]` per column.
4. Tie-break: `rng.pick` over the maximum.

- [ ] **Step 1: Write the failing tests**

Append to `index.test.ts`:

```ts
import { lowestEmptyRow, withDisc, type Board, type Mark } from "@openturn/example-connect-four-game";
import { heuristicBot } from "./heuristic";

function viewFor(board: Board, currentPlayer: Mark = "0") {
  return {
    board,
    lastMove: null,
    currentPlayer,
    winningLine: null,
  };
}

function legalForBoard(board: Board): LegalAction[] {
  const out: LegalAction[] = [];
  for (let col = 0; col < 7; col += 1) {
    if (board[0]![col] === null) {
      out.push({ event: "dropDisc", payload: { col }, label: `Col ${col + 1}` });
    }
  }
  return out;
}

async function decide(bot: typeof heuristicBot, board: Board, me: Mark = "0") {
  const rng = createDeterministicRng(`heur-${me}-${board.flat().join("")}`);
  return bot.decide({
    playerID: me as never,
    view: viewFor(board, me) as never,
    snapshot: { G: { board, lastMove: null }, derived: { activePlayers: [me] } } as never,
    legalActions: legalForBoard(board),
    rng,
    deadline: { remainingMs: () => 1000, expired: () => false },
    signal: new AbortController().signal,
    simulate: () => { throw new Error("must not be called"); },
  });
}

function emptyBoard(): Board {
  return Array.from({ length: 6 }, () => Array(7).fill(null));
}

describe("heuristicBot — immediate win", () => {
  test("plays a vertical winning move when 3 own discs are stacked", async () => {
    let board = emptyBoard();
    board = withDisc(board, lowestEmptyRow(board, 3), 3, "0");
    board = withDisc(board, lowestEmptyRow(board, 3), 3, "0");
    board = withDisc(board, lowestEmptyRow(board, 3), 3, "0");
    const action = await decide(heuristicBot, board, "0");
    expect((action.payload as DropDiscArgs).col).toBe(3);
  });

  test("plays a horizontal winning move when 3 own discs are aligned", async () => {
    let board = emptyBoard();
    // Build floor support so disc lands at row 5.
    board = withDisc(board, 5, 1, "0");
    board = withDisc(board, 5, 2, "0");
    board = withDisc(board, 5, 3, "0");
    const action = await decide(heuristicBot, board, "0");
    expect([0, 4]).toContain((action.payload as DropDiscArgs).col);
  });
});

describe("heuristicBot — immediate block", () => {
  test("blocks an opponent's vertical 3-in-a-row", async () => {
    let board = emptyBoard();
    board = withDisc(board, lowestEmptyRow(board, 4), 4, "1");
    board = withDisc(board, lowestEmptyRow(board, 4), 4, "1");
    board = withDisc(board, lowestEmptyRow(board, 4), 4, "1");
    const action = await decide(heuristicBot, board, "0");
    expect((action.payload as DropDiscArgs).col).toBe(4);
  });

  test("blocks an opponent's horizontal 3-in-a-row when no own win is available", async () => {
    let board = emptyBoard();
    board = withDisc(board, 5, 2, "1");
    board = withDisc(board, 5, 3, "1");
    board = withDisc(board, 5, 4, "1");
    const action = await decide(heuristicBot, board, "0");
    expect([1, 5]).toContain((action.payload as DropDiscArgs).col);
  });
});

describe("heuristicBot — center bias", () => {
  test("prefers the center on an empty board", async () => {
    const board = emptyBoard();
    const action = await decide(heuristicBot, board, "0");
    expect((action.payload as DropDiscArgs).col).toBe(3);
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
bun --filter @openturn/example-connect-four-bots test
```
Expected: FAIL — `Cannot find module './heuristic'`.

- [ ] **Step 3: Implement `heuristic.ts`**

Create `examples/games/connect-four/bots/src/heuristic.ts`:

```ts
import { defineBot, type LegalAction } from "@openturn/bot";
import {
  connectFour,
  findWinningLine,
  lowestEmptyRow,
  withDisc,
  type Board,
  type DropDiscArgs,
  type Mark,
} from "@openturn/example-connect-four-game";

const CENTER_BIAS = [3, 4, 5, 7, 5, 4, 3] as const;

function opponentOf(me: Mark): Mark {
  return me === "0" ? "1" : "0";
}

function wouldWin(board: Board, col: number, mark: Mark): boolean {
  const row = lowestEmptyRow(board, col);
  if (row < 0) return false;
  const next = withDisc(board, row, col, mark);
  return findWinningLine(next, row, col) !== null;
}

function scoreForCol(board: Board, col: number, me: Mark): number {
  if (wouldWin(board, col, me)) return Number.POSITIVE_INFINITY;
  if (wouldWin(board, col, opponentOf(me))) return 10_000;
  return CENTER_BIAS[col] ?? 0;
}

export const heuristicBot = defineBot<typeof connectFour>({
  name: "heuristic",
  decide({ view, playerID, legalActions, rng }) {
    const me = playerID as Mark;
    let bestScore = Number.NEGATIVE_INFINITY;
    let bestActions: LegalAction[] = [];
    for (const action of legalActions) {
      const col = (action.payload as DropDiscArgs).col;
      const score = scoreForCol(view.board, col, me);
      if (score > bestScore) {
        bestScore = score;
        bestActions = [action];
      } else if (score === bestScore) {
        bestActions.push(action);
      }
    }
    if (bestActions.length === 0) return rng.pick(legalActions);
    return rng.pick(bestActions);
  },
});
```

- [ ] **Step 4: Run — expect pass**

```bash
bun --filter @openturn/example-connect-four-bots test
```
Expected: all heuristic tests pass.

- [ ] **Step 5: Commit**

```bash
git add examples/games/connect-four/bots/
git commit -m "feat(connect-four/bots): add heuristicBot with win/block/center-bias"
```

---

### Task 18: Integration test — heuristic dominates random

**Files:**
- Modify: `examples/games/connect-four/bots/src/index.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `index.test.ts`:

```ts
import { attachLocalBots, type Bot } from "@openturn/bot";
import { createLocalSession } from "@openturn/core";

const connectFourMatch = { players: connectFour.playerIDs };

interface ResultLike {
  winner?: string;
  draw?: boolean;
}

async function playToCompletion(
  rawSession: ReturnType<typeof createLocalSession<typeof connectFour, typeof connectFourMatch>>,
  bots: { "0": Bot<typeof connectFour>; "1": Bot<typeof connectFour> },
): Promise<ResultLike | null> {
  const { session, isBot, whenIdle, detachAll } = attachLocalBots({
    session: rawSession,
    game: connectFour,
    bots,
  });

  for (let step = 0; step < 50; step += 1) {
    const snap = session.getState();
    const result = snap.meta.result as ResultLike | null;
    if (result !== null && result !== undefined) break;
    const active = snap.derived.activePlayers[0]!;
    if (isBot(active)) await whenIdle(active);
  }

  const final = session.getState().meta.result as ResultLike | null;
  detachAll();
  return final;
}

describe("heuristicBot vs randomBot integration", () => {
  test("heuristic wins or draws every match across 20 games", async () => {
    let losses = 0;
    for (let i = 0; i < 20; i += 1) {
      const session = createLocalSession(connectFour, { match: connectFourMatch, seed: `heur-rand-${i}` });
      const result = await playToCompletion(session, { "0": heuristicBot, "1": randomBot });
      if (result?.winner === "1") losses += 1;
    }
    // Heuristic should rarely if ever lose to random over 20 games.
    expect(losses).toBeLessThanOrEqual(1);
  }, 60_000);
});
```

- [ ] **Step 2: Run — expect pass (heuristic should win convincingly)**

```bash
bun --filter @openturn/example-connect-four-bots test
```
Expected: all bot tests pass; the integration test takes ~5–20 seconds.

- [ ] **Step 3: Commit**

```bash
git add examples/games/connect-four/bots/
git commit -m "test(connect-four/bots): heuristic dominates random across 20 matches"
```

---

### Task 19: TDD the minimax bot — wins immediate threats

**Files:**
- Create: `examples/games/connect-four/bots/src/minimax.ts`
- Modify: `examples/games/connect-four/bots/src/index.test.ts`

The minimax operates on the `view.board` only — it never calls `simulate`. This keeps the bot topology-independent.

- [ ] **Step 1: Write the failing tests**

Append to `index.test.ts`:

```ts
import { makeMinimaxBot } from "./minimax";

describe("minimaxBot — tactical correctness", () => {
  const bot = makeMinimaxBot({ depth: 4, budgetMs: 5_000 });

  test("plays an immediate vertical win", async () => {
    let board = emptyBoard();
    board = withDisc(board, lowestEmptyRow(board, 3), 3, "0");
    board = withDisc(board, lowestEmptyRow(board, 3), 3, "0");
    board = withDisc(board, lowestEmptyRow(board, 3), 3, "0");
    const action = await decide(bot, board, "0");
    expect((action.payload as DropDiscArgs).col).toBe(3);
  });

  test("blocks an opponent's vertical 3-in-a-row", async () => {
    let board = emptyBoard();
    board = withDisc(board, lowestEmptyRow(board, 4), 4, "1");
    board = withDisc(board, lowestEmptyRow(board, 4), 4, "1");
    board = withDisc(board, lowestEmptyRow(board, 4), 4, "1");
    const action = await decide(bot, board, "0");
    expect((action.payload as DropDiscArgs).col).toBe(4);
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
bun --filter @openturn/example-connect-four-bots test
```
Expected: FAIL — `Cannot find module './minimax'`.

- [ ] **Step 3: Implement `minimax.ts`**

Create `examples/games/connect-four/bots/src/minimax.ts`:

```ts
import { defineBot, type LegalAction } from "@openturn/bot";
import {
  COLS,
  ROWS,
  connectFour,
  findWinningLine,
  lowestEmptyRow,
  withDisc,
  type Board,
  type DropDiscArgs,
  type Mark,
} from "@openturn/example-connect-four-game";

const COL_ORDER = [3, 2, 4, 1, 5, 0, 6] as const;
const WIN_SCORE = 1_000_000;

function opponentOf(me: Mark): Mark {
  return me === "0" ? "1" : "0";
}

/** Count how many lines of 4 cells in the board contain `count` of `mark` and 0 of the opponent. */
function countOpenLines(board: Board, mark: Mark, count: number): number {
  const opp = opponentOf(mark);
  let total = 0;
  const directions: ReadonlyArray<readonly [number, number]> = [
    [0, 1], [1, 0], [1, 1], [1, -1],
  ];
  for (let r = 0; r < ROWS; r += 1) {
    for (let c = 0; c < COLS; c += 1) {
      for (const [dr, dc] of directions) {
        const er = r + 3 * dr;
        const ec = c + 3 * dc;
        if (er < 0 || er >= ROWS || ec < 0 || ec >= COLS) continue;
        let mine = 0;
        let theirs = 0;
        for (let k = 0; k < 4; k += 1) {
          const cell = board[r + k * dr]![c + k * dc];
          if (cell === mark) mine += 1;
          else if (cell === opp) theirs += 1;
        }
        if (theirs === 0 && mine === count) total += 1;
      }
    }
  }
  return total;
}

function evaluate(board: Board, me: Mark): number {
  const opp = opponentOf(me);
  const my3 = countOpenLines(board, me, 3);
  const my2 = countOpenLines(board, me, 2);
  const opp3 = countOpenLines(board, opp, 3);
  const opp2 = countOpenLines(board, opp, 2);
  return my3 * 100 + my2 * 10 - opp3 * 100 - opp2 * 10;
}

interface SearchResult {
  bestCol: number;
  score: number;
}

interface DeadlineLike {
  expired: () => boolean;
}

function legalCols(board: Board): number[] {
  return COL_ORDER.filter((c) => board[0]![c] === null);
}

function alphabeta(
  board: Board,
  toMove: Mark,
  me: Mark,
  depth: number,
  alpha: number,
  beta: number,
  deadline: DeadlineLike,
): number {
  if (deadline.expired()) return evaluate(board, me);
  if (depth === 0) return evaluate(board, me);

  const cols = legalCols(board);
  if (cols.length === 0) return evaluate(board, me);

  const opp = opponentOf(toMove);
  const isMaxing = toMove === me;
  let best = isMaxing ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
  for (const col of cols) {
    const row = lowestEmptyRow(board, col);
    const next = withDisc(board, row, col, toMove);
    const win = findWinningLine(next, row, col);
    let value: number;
    if (win !== null) {
      value = isMaxing ? WIN_SCORE - (12 - depth) : -(WIN_SCORE - (12 - depth));
    } else {
      value = alphabeta(next, opp, me, depth - 1, alpha, beta, deadline);
    }
    if (isMaxing) {
      if (value > best) best = value;
      if (best > alpha) alpha = best;
    } else {
      if (value < best) best = value;
      if (best < beta) beta = best;
    }
    if (beta <= alpha) break;
  }
  return best;
}

function searchAtDepth(board: Board, me: Mark, depth: number, deadline: DeadlineLike): SearchResult | null {
  const cols = legalCols(board);
  if (cols.length === 0) return null;
  let bestCol = cols[0]!;
  let bestScore = Number.NEGATIVE_INFINITY;
  let alpha = Number.NEGATIVE_INFINITY;
  const beta = Number.POSITIVE_INFINITY;
  for (const col of cols) {
    if (deadline.expired()) return null;
    const row = lowestEmptyRow(board, col);
    const next = withDisc(board, row, col, me);
    const win = findWinningLine(next, row, col);
    let value: number;
    if (win !== null) {
      value = WIN_SCORE - (12 - depth);
    } else {
      value = alphabeta(next, opponentOf(me), me, depth - 1, alpha, beta, deadline);
    }
    if (value > bestScore) {
      bestScore = value;
      bestCol = col;
    }
    if (bestScore > alpha) alpha = bestScore;
  }
  return { bestCol, score: bestScore };
}

export interface MinimaxBotOptions {
  depth: number;
  budgetMs?: number;
}

export function makeMinimaxBot({ depth, budgetMs = 2_000 }: MinimaxBotOptions) {
  return defineBot<typeof connectFour>({
    name: `minimax-d${depth}`,
    thinkingBudgetMs: budgetMs,
    decide({ view, playerID, legalActions, deadline, rng }) {
      const me = playerID as Mark;
      let best: SearchResult | null = null;
      for (let d = 1; d <= depth; d += 1) {
        const r = searchAtDepth(view.board, me, d, deadline);
        if (r === null) break;
        best = r;
      }
      if (best === null) return rng.pick(legalActions);
      const action = legalActions.find(
        (a) => (a.payload as DropDiscArgs).col === best.bestCol,
      ) as LegalAction | undefined;
      return action ?? rng.pick(legalActions);
    },
  });
}

export const minimaxBot = makeMinimaxBot({ depth: 6 });
```

- [ ] **Step 4: Run — expect pass**

```bash
bun --filter @openturn/example-connect-four-bots test
```
Expected: minimax tactical tests pass; existing tests still pass.

- [ ] **Step 5: Commit**

```bash
git add examples/games/connect-four/bots/
git commit -m "feat(connect-four/bots): add minimaxBot with alpha-beta + iterative deepening"
```

---

### Task 20: TDD minimax respects deadline

**Files:**
- Modify: `examples/games/connect-four/bots/src/index.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `index.test.ts`:

```ts
describe("minimaxBot — deadline", () => {
  test("returns within ~75ms when budgetMs is 50", async () => {
    const bot = makeMinimaxBot({ depth: 8, budgetMs: 50 });
    const board = emptyBoard();
    const start = performance.now();

    let expired = false;
    const deadline = {
      remainingMs: () => Math.max(0, 50 - (performance.now() - start)),
      expired: () => {
        if (!expired && performance.now() - start >= 50) expired = true;
        return expired;
      },
    };

    const rng = createDeterministicRng("deadline");
    await bot.decide({
      playerID: "0" as never,
      view: viewFor(board, "0") as never,
      snapshot: { G: { board, lastMove: null }, derived: { activePlayers: ["0"] } } as never,
      legalActions: legalForBoard(board),
      rng,
      deadline,
      signal: new AbortController().signal,
      simulate: () => { throw new Error("must not be called"); },
    });
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(150);
  });
});
```

- [ ] **Step 2: Run — expect pass**

```bash
bun --filter @openturn/example-connect-four-bots test
```
Expected: pass.

- [ ] **Step 3: Commit**

```bash
git add examples/games/connect-four/bots/
git commit -m "test(connect-four/bots): minimax respects deadline"
```

---

### Task 21: Wire `defineBotRegistry` and `attachBots`

**Files:**
- Modify: `examples/games/connect-four/bots/src/index.ts`
- Modify: `examples/games/connect-four/bots/src/index.test.ts`

- [ ] **Step 1: Write the registry test**

Append to `index.test.ts`:

```ts
import { connectFourBotRegistry, connectFourWithBots } from "./index";

describe("connectFourBotRegistry", () => {
  test("declares random, heuristic, minimax in that order", () => {
    const ids = connectFourBotRegistry.bots.map((b) => b.botID);
    expect(ids).toEqual(["random", "heuristic", "minimax"]);
  });

  test("connectFourWithBots exposes bots on game.bots", () => {
    expect(connectFourWithBots.bots).toBe(connectFourBotRegistry);
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
bun --filter @openturn/example-connect-four-bots test
```
Expected: FAIL — `connectFourBotRegistry is not exported`.

- [ ] **Step 3: Implement `index.ts`**

Replace the contents of `examples/games/connect-four/bots/src/index.ts` with:

```ts
import { attachBots, defineBotRegistry, type BotRegistry } from "@openturn/lobby/registry";
import { connectFour } from "@openturn/example-connect-four-game";

import { heuristicBot } from "./heuristic";
import { makeMinimaxBot, minimaxBot } from "./minimax";
import { randomBot } from "./random";

export { heuristicBot } from "./heuristic";
export { makeMinimaxBot, minimaxBot } from "./minimax";
export { randomBot } from "./random";

/**
 * Bot catalog for Connect Four. The `botID`s are stable wire identifiers
 * used by the lobby's per-seat dropdown and the in-DO bot driver.
 */
export const connectFourBotRegistry: BotRegistry<typeof connectFour> = defineBotRegistry([
  {
    botID: "random",
    label: "Random",
    description: "Picks a uniformly random legal move.",
    difficulty: "easy",
    bot: randomBot,
  },
  {
    botID: "heuristic",
    label: "Heuristic",
    description: "One-ply: takes immediate wins, blocks immediate threats, prefers the center.",
    difficulty: "medium",
    bot: heuristicBot,
  },
  {
    botID: "minimax",
    label: "Minimax",
    description: "Alpha-beta search at depth 6 with iterative deepening.",
    difficulty: "hard",
    bot: minimaxBot,
  },
]);

/**
 * Connect Four pre-decorated with its bot registry. Apps that want lobby
 * bot picking import this instead of the bare `connectFour`.
 */
export const connectFourWithBots = attachBots(connectFour, connectFourBotRegistry);
```

- [ ] **Step 4: Run — expect pass**

```bash
bun --filter @openturn/example-connect-four-bots test
```
Expected: registry tests pass; everything else still passes.

- [ ] **Step 5: Verify typecheck**

```bash
bun --filter @openturn/example-connect-four-bots typecheck
```
Expected: exits 0.

- [ ] **Step 6: Commit**

```bash
git add examples/games/connect-four/bots/
git commit -m "feat(connect-four/bots): expose registry and connectFourWithBots"
```

---

### Task 22: Verify bots/ runtime boundary + finalize Phase 2

**Files:**
- (none modified)

- [ ] **Step 1: Run runtime check**

```bash
bun run check:runtimes
```
Expected: exits 0.

- [ ] **Step 2: Run full bots test suite**

```bash
bun --filter @openturn/example-connect-four-bots test
```
Expected: all tests pass.

- [ ] **Step 3: No commit needed if green.**

---

## Phase 3 — `app/` package: scaffolding

### Task 23: Scaffold the `app/` package

**Files:**
- Create: `examples/games/connect-four/app/package.json`
- Create: `examples/games/connect-four/app/tsconfig.json`
- Create: `examples/games/connect-four/app/components.json`
- Create: `examples/games/connect-four/app/app/page.tsx`
- Create: `examples/games/connect-four/app/app/openturn.ts`
- Create: `examples/games/connect-four/app/src/styles.css`
- Create: `examples/games/connect-four/app/src/lib/utils.ts`
- Create: `examples/games/connect-four/app/src/lib/halo.ts`
- Create: `examples/games/connect-four/app/src/css.d.ts`

- [ ] **Step 1: `app/package.json`**

```json
{
  "name": "@openturn/example-connect-four-app",
  "private": true,
  "type": "module",
  "openturn": {
    "runtime": "browser"
  },
  "scripts": {
    "build": "bun run ../../../../packages/cli/src/index.ts build .",
    "deploy": "bun run ../../../../packages/cli/src/index.ts deploy . --project connect-four --name \"Connect Four\"",
    "dev": "bun run ../../../../packages/cli/src/index.ts dev . --port 3009",
    "start": "bun run ../../../../packages/cli/src/index.ts start . --port 3009",
    "typecheck": "bun x tsc -p tsconfig.json --pretty false"
  },
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

- [ ] **Step 2: `app/tsconfig.json`**

```json
{
  "extends": "../../../../tsconfig.browser.json",
  "compilerOptions": {
    "composite": true,
    "jsx": "react-jsx",
    "ignoreDeprecations": "6.0",
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": [
    "app/**/*.ts",
    "app/**/*.tsx",
    "src/**/*.ts",
    "src/**/*.tsx",
    "src/**/*.d.ts"
  ]
}
```

- [ ] **Step 3: `app/components.json`** (matches Splendor; informational for shadcn-style tooling)

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "src/styles.css",
    "baseColor": "slate",
    "cssVariables": false,
    "prefix": ""
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils"
  }
}
```

- [ ] **Step 4: `app/app/openturn.ts`**

```ts
export const metadata = {
  name: "Connect Four",
  runtime: "multiplayer",
  multiplayer: { gameKey: "connect-four", schemaVersion: "1" },
};
```

- [ ] **Step 5: `app/src/styles.css`**

```css
@import "tailwindcss";
```

- [ ] **Step 6: `app/src/css.d.ts`** (so importing `./styles.css` typechecks)

```ts
declare module "*.css";
```

- [ ] **Step 7: `app/src/lib/utils.ts`**

```ts
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 8: `app/src/lib/halo.ts`**

```ts
/**
 * Tailwind v4 arbitrary-shadow utility for the soft-halo "last move"
 * highlight. Reset the cell border to transparent so nothing competes
 * with the halo.
 */
export const LAST_MOVE_HALO =
  "border-transparent shadow-[0_0_0_3px_rgba(15,23,42,0.05),0_0_14px_rgba(15,23,42,0.08),0_1px_2px_rgba(15,23,42,0.12)]";
```

- [ ] **Step 9: `app/app/page.tsx`** (placeholder; finalized in Task 35)

```tsx
import "../src/styles.css";

export default function Page() {
  return <main className="min-h-screen bg-slate-50 grid place-items-center text-slate-600">Connect Four — initializing</main>;
}
```

- [ ] **Step 10: Install workspace deps**

From the repo root:

```bash
bun install
```
Expected: success.

- [ ] **Step 11: Verify typecheck**

```bash
bun --filter @openturn/example-connect-four-app typecheck
```
Expected: exits 0.

- [ ] **Step 12: Commit**

```bash
git add examples/games/connect-four/app/ bun.lock
git commit -m "feat(connect-four): scaffold app/ package with placeholder page"
```

---

## Phase 4 — `app/` package: components

> **Component-development workflow:** UI components are not full TDD candidates — visual correctness is verified manually. The workflow per task is: write the component, ensure typecheck passes, then run the dev server and visually verify (Tasks 35–37 cover the smoke tests). Each component task ends with a commit.

### Task 24: `Disc.tsx` — animated single-cell disc

**Files:**
- Create: `examples/games/connect-four/app/src/components/Disc.tsx`

- [ ] **Step 1: Create the component**

```tsx
import { motion } from "framer-motion";

import { LAST_MOVE_HALO } from "@/lib/halo";
import { cn } from "@/lib/utils";

export type DiscProps = {
  mark: "0" | "1" | null;
  isLastMove?: boolean;
  /** Approximate pixels to drop from. Pass the column height in pixels for the spring start. */
  dropFrom?: number;
};

const COLOR_BY_MARK: Record<"0" | "1", string> = {
  "0": "bg-red-500",
  "1": "bg-amber-400",
};

export function Disc({ mark, isLastMove = false, dropFrom = 0 }: DiscProps): React.ReactElement {
  if (mark === null) {
    return (
      <div
        role="gridcell"
        aria-label="empty"
        className="aspect-square rounded-full bg-slate-100 border border-slate-200"
      />
    );
  }
  return (
    <motion.div
      role="gridcell"
      aria-label={mark === "0" ? "red" : "yellow"}
      initial={{ y: -dropFrom }}
      animate={{ y: 0, scaleY: [0.92, 1] }}
      transition={{ y: { type: "spring", stiffness: 380, damping: 24, mass: 1 }, scaleY: { duration: 0.12 } }}
      className={cn(
        "aspect-square rounded-full shadow-sm border border-slate-200/0",
        COLOR_BY_MARK[mark],
        isLastMove && LAST_MOVE_HALO,
      )}
    />
  );
}
```

- [ ] **Step 2: Verify typecheck**

```bash
bun --filter @openturn/example-connect-four-app typecheck
```
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add examples/games/connect-four/app/src/components/Disc.tsx
git commit -m "feat(connect-four/app): add Disc component"
```

---

### Task 25: `ColumnGhost.tsx` — hover preview disc

**Files:**
- Create: `examples/games/connect-four/app/src/components/ColumnGhost.tsx`

- [ ] **Step 1: Create the component**

```tsx
import { cn } from "@/lib/utils";

export type ColumnGhostProps = {
  /** Hovered column index, or null when no column is hovered. */
  hoverCol: number | null;
  activeMark: "0" | "1" | null;
};

const COLOR_BY_MARK: Record<"0" | "1", string> = {
  "0": "bg-red-500/30",
  "1": "bg-amber-400/30",
};

export function ColumnGhost({ hoverCol, activeMark }: ColumnGhostProps): React.ReactElement {
  return (
    <div aria-hidden className="grid grid-cols-7 gap-1.5 px-1 mb-1 transition-opacity">
      {Array.from({ length: 7 }, (_, col) => (
        <div
          key={col}
          className={cn(
            "aspect-square rounded-full",
            hoverCol === col && activeMark !== null ? COLOR_BY_MARK[activeMark] : "bg-transparent",
          )}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Verify typecheck**

```bash
bun --filter @openturn/example-connect-four-app typecheck
```
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add examples/games/connect-four/app/src/components/ColumnGhost.tsx
git commit -m "feat(connect-four/app): add ColumnGhost hover indicator"
```

---

### Task 26: `Board.tsx` — clickable 7×6 grid

**Files:**
- Create: `examples/games/connect-four/app/src/components/Board.tsx`

- [ ] **Step 1: Create the component**

```tsx
import { useState } from "react";
import type { Board as BoardType, Mark } from "@openturn/example-connect-four-game";

import { cn } from "@/lib/utils";
import { ColumnGhost } from "./ColumnGhost";
import { Disc } from "./Disc";

export type BoardProps = {
  board: BoardType;
  lastMove: { row: number; col: number; player: Mark } | null;
  /** Mark of the active local seat. null when not your turn or no local seat. */
  activeMark: Mark | null;
  /** True when the local seat may dispatch a move right now. */
  canPlay: boolean;
  /** Called when the user clicks a column. */
  onDrop: (col: number) => void;
};

export function Board({ board, lastMove, activeMark, canPlay, onDrop }: BoardProps): React.ReactElement {
  const [hoverCol, setHoverCol] = useState<number | null>(null);

  const handleClick = (col: number): void => {
    if (!canPlay) return;
    if (board[0]![col] !== null) return;
    onDrop(col);
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <ColumnGhost hoverCol={canPlay ? hoverCol : null} activeMark={activeMark} />
      <div role="grid" aria-label="Connect Four board" className="grid grid-cols-7 gap-1.5">
        {board.map((row, r) =>
          row.map((cell, c) => {
            const isLast = lastMove !== null && lastMove.row === r && lastMove.col === c;
            return (
              <button
                key={`${r}-${c}`}
                type="button"
                aria-label={`Drop in column ${c + 1}`}
                disabled={!canPlay || board[0]![c] !== null}
                onClick={() => handleClick(c)}
                onMouseEnter={() => setHoverCol(c)}
                onMouseLeave={() => setHoverCol((cur) => (cur === c ? null : cur))}
                onFocus={() => setHoverCol(c)}
                onBlur={() => setHoverCol((cur) => (cur === c ? null : cur))}
                className={cn(
                  "p-0 m-0 bg-transparent border-0 outline-0 focus-visible:ring-2 focus-visible:ring-slate-400 rounded-full disabled:cursor-not-allowed",
                )}
              >
                <Disc mark={cell} isLastMove={isLast} dropFrom={isLast ? 200 : 0} />
              </button>
            );
          }),
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify typecheck**

```bash
bun --filter @openturn/example-connect-four-app typecheck
```
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add examples/games/connect-four/app/src/components/Board.tsx
git commit -m "feat(connect-four/app): add Board component with column-click + hover ghost"
```

---

### Task 27: `StatusBanner.tsx` — small-caps status line

**Files:**
- Create: `examples/games/connect-four/app/src/components/StatusBanner.tsx`

- [ ] **Step 1: Create the component**

```tsx
export type StatusBannerProps = {
  text: string;
};

export function StatusBanner({ text }: StatusBannerProps): React.ReactElement {
  return (
    <p
      role="status"
      aria-live="polite"
      className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500 text-center min-h-5 mb-2"
    >
      {text}
    </p>
  );
}
```

- [ ] **Step 2: Verify typecheck and commit**

```bash
bun --filter @openturn/example-connect-four-app typecheck
git add examples/games/connect-four/app/src/components/StatusBanner.tsx
git commit -m "feat(connect-four/app): add StatusBanner"
```

---

### Task 28: `PlayerCard.tsx` — sidebar chip per seat

**Files:**
- Create: `examples/games/connect-four/app/src/components/PlayerCard.tsx`

- [ ] **Step 1: Create the component**

```tsx
import type { Mark } from "@openturn/example-connect-four-game";

import { cn } from "@/lib/utils";

export type PlayerCardProps = {
  mark: Mark;
  name: string;
  role: string;
  active: boolean;
};

const COLOR_BY_MARK: Record<Mark, string> = {
  "0": "bg-red-500",
  "1": "bg-amber-400",
};

const LABEL_BY_MARK: Record<Mark, string> = {
  "0": "Red",
  "1": "Yellow",
};

export function PlayerCard({ mark, name, role, active }: PlayerCardProps): React.ReactElement {
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3.5 py-3",
        active && "ring-1 ring-slate-300",
      )}
    >
      <div className={cn("w-7 h-7 rounded-full shadow-sm shrink-0", COLOR_BY_MARK[mark])} aria-hidden />
      <div className="flex flex-col gap-0.5 min-w-0">
        <div className="text-sm font-semibold leading-tight">{LABEL_BY_MARK[mark]}</div>
        <div className={cn("text-xs", active ? "text-slate-900 font-medium" : "text-slate-500")}>
          <span className="font-medium">{name}</span> · {role}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify and commit**

```bash
bun --filter @openturn/example-connect-four-app typecheck
git add examples/games/connect-four/app/src/components/PlayerCard.tsx
git commit -m "feat(connect-four/app): add PlayerCard"
```

---

### Task 29: `Sidebar.tsx` — composes the player cards + stats + new-match CTA

**Files:**
- Create: `examples/games/connect-four/app/src/components/Sidebar.tsx`

- [ ] **Step 1: Create the component**

```tsx
import type { Mark } from "@openturn/example-connect-four-game";

import { PlayerCard } from "./PlayerCard";

export type SeatInfo = {
  mark: Mark;
  name: string;
  role: string;
  active: boolean;
};

export type SidebarProps = {
  seats: readonly [SeatInfo, SeatInfo];
  turn: number;
  moves: number;
  isOver: boolean;
  onNewMatch: () => void;
};

export function Sidebar({ seats, turn, moves, isOver, onNewMatch }: SidebarProps): React.ReactElement {
  return (
    <aside className="flex flex-col gap-2.5">
      {seats.map((s) => (
        <PlayerCard key={s.mark} mark={s.mark} name={s.name} role={s.role} active={s.active} />
      ))}
      <div className="px-3.5 py-2 text-xs text-slate-500 flex flex-col gap-1">
        <div className="flex justify-between">
          <span className="uppercase tracking-[0.14em] text-[10px] text-slate-400">Turn</span>
          <span className="tabular-nums">{turn}</span>
        </div>
        <div className="flex justify-between">
          <span className="uppercase tracking-[0.14em] text-[10px] text-slate-400">Moves</span>
          <span className="tabular-nums">{moves}</span>
        </div>
      </div>
      {isOver && (
        <button
          type="button"
          onClick={onNewMatch}
          className="rounded-full border border-slate-300 bg-slate-950 px-5 py-2 text-sm font-medium text-white transition hover:bg-slate-800 focus-visible:ring-2 focus-visible:ring-slate-400"
        >
          New match
        </button>
      )}
    </aside>
  );
}
```

- [ ] **Step 2: Verify and commit**

```bash
bun --filter @openturn/example-connect-four-app typecheck
git add examples/games/connect-four/app/src/components/Sidebar.tsx
git commit -m "feat(connect-four/app): add Sidebar"
```

---

### Task 30: `Match.tsx` — the in-game layout (board + sidebar + status)

**Files:**
- Create: `examples/games/connect-four/app/src/components/Match.tsx`

- [ ] **Step 1: Create the component**

```tsx
import type { Mark } from "@openturn/example-connect-four-game";

import { Board, type BoardProps } from "./Board";
import { Sidebar, type SeatInfo } from "./Sidebar";
import { StatusBanner } from "./StatusBanner";

export type MatchProps = {
  board: BoardProps["board"];
  lastMove: BoardProps["lastMove"];
  activeMark: Mark | null;
  canPlay: boolean;
  onDrop: (col: number) => void;
  status: string;
  seats: readonly [SeatInfo, SeatInfo];
  turn: number;
  moves: number;
  isOver: boolean;
  onNewMatch: () => void;
};

export function Match(props: MatchProps): React.ReactElement {
  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <header className="flex items-baseline justify-between border-b border-slate-200 pb-4 mb-6">
        <div>
          <p className="text-[10px] uppercase tracking-[0.18em] font-medium text-slate-500 mb-1">
            Openturn · Hosted match
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">Connect Four</h1>
        </div>
      </header>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-[1fr_260px] items-start">
        <section>
          <StatusBanner text={props.status} />
          <Board
            board={props.board}
            lastMove={props.lastMove}
            activeMark={props.activeMark}
            canPlay={props.canPlay}
            onDrop={props.onDrop}
          />
        </section>
        <Sidebar
          seats={props.seats}
          turn={props.turn}
          moves={props.moves}
          isOver={props.isOver}
          onNewMatch={props.onNewMatch}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify and commit**

```bash
bun --filter @openturn/example-connect-four-app typecheck
git add examples/games/connect-four/app/src/components/Match.tsx
git commit -m "feat(connect-four/app): add Match layout"
```

---

### Task 31: `LocalPreview.tsx` — `?preview=local` hot-seat

**Files:**
- Create: `examples/games/connect-four/app/src/components/LocalPreview.tsx`

This bypasses the lobby entirely — both seats are human, no bot wiring. Useful for board-layout work without spinning up a hosted dev server.

- [ ] **Step 1: Create the component**

```tsx
import { createOpenturnBindings } from "@openturn/react";
import type { Mark } from "@openturn/example-connect-four-game";
import { connectFour } from "@openturn/example-connect-four-game";

import { Match } from "./Match";

const { OpenturnProvider, useMatch } = createOpenturnBindings(connectFour, {
  runtime: "local",
  match: { players: connectFour.playerIDs },
});

interface ResultLike { winner?: string; draw?: boolean }

function PreviewBoard(): React.ReactElement {
  const view = useMatch();
  if (view.mode !== "local") throw new Error("Local match required");
  const { dispatch, reset, snapshot } = view.state;

  const board = snapshot.G.board;
  const lastMove = snapshot.G.lastMove;
  const result = snapshot.meta.result as ResultLike | null;
  const isOver = result !== null;
  const active = (snapshot.derived.activePlayers[0] ?? "0") as Mark;
  const moves = snapshot.position.turn ?? 0;
  const turn = Math.floor(moves / 2) + 1;

  const status = isOver
    ? result!.draw
      ? "Draw"
      : result!.winner === "0"
        ? "Red wins"
        : "Yellow wins"
    : active === "0" ? "Red to move" : "Yellow to move";

  return (
    <Match
      board={board}
      lastMove={lastMove}
      activeMark={isOver ? null : active}
      canPlay={!isOver}
      onDrop={(col) => dispatch.dropDisc(active, { col })}
      status={status}
      seats={[
        { mark: "0", name: "Player 1", role: active === "0" && !isOver ? "Your turn" : "Waiting", active: !isOver && active === "0" },
        { mark: "1", name: "Player 2", role: active === "1" && !isOver ? "Your turn" : "Waiting", active: !isOver && active === "1" },
      ]}
      turn={turn}
      moves={moves}
      isOver={isOver}
      onNewMatch={reset}
    />
  );
}

export function LocalPreview(): React.ReactElement {
  return (
    <OpenturnProvider>
      <main className="min-h-screen bg-slate-50 text-slate-950">
        <PreviewBoard />
      </main>
    </OpenturnProvider>
  );
}
```

- [ ] **Step 2: Verify and commit**

```bash
bun --filter @openturn/example-connect-four-app typecheck
git add examples/games/connect-four/app/src/components/LocalPreview.tsx
git commit -m "feat(connect-four/app): add LocalPreview hot-seat"
```

---

### Task 32: `ConnectFourExperience.tsx` — lobby + hosted match phase

**Files:**
- Create: `examples/games/connect-four/app/src/components/ConnectFourExperience.tsx`

This is the production code path: lobby → hosted match with bot driver wired via `useBotAttachOnTransition`.

> **Lobby integration note:** The exact lobby hook and component names come from `@openturn/lobby/react`. If the imports below don't resolve at typecheck time, open `packages/lobby/src/react/index.ts` (or check Splendor's `app/src/components/SplendorExperience.tsx`) to find the current hook names and update the imports to match. The shape of the wiring — local lobby channel, view builder, transition-to-game, bot attach — does not change.

- [ ] **Step 1: Create the component**

```tsx
import { useState, type ReactNode } from "react";
import {
  LobbyWithBots,
  buildLobbyView,
  useBotAttachOnTransition,
  useLocalLobbyChannel,
} from "@openturn/lobby/react";
import { createLocalSession } from "@openturn/core";
import {
  connectFour,
  type Mark,
} from "@openturn/example-connect-four-game";
import {
  connectFourBotRegistry,
  connectFourWithBots,
} from "@openturn/example-connect-four-bots";

import { Match } from "./Match";

const HOST_USER_ID = "local-host";

interface ResultLike { winner?: string; draw?: boolean }

export function ConnectFourExperience(): React.ReactElement {
  const [phase, setPhase] = useState<"lobby" | "game">("lobby");
  const [botMap, setBotMap] = useState<Record<string, string>>({});

  const channel = useLocalLobbyChannel({
    game: connectFourWithBots,
    hostUserID: HOST_USER_ID,
    hostUserName: "You",
    registry: connectFourBotRegistry,
    onTransitionToGame: ({ assignments }) => {
      const next: Record<string, string> = {};
      for (const a of assignments) {
        if (a.kind === "bot" && a.botID !== null) next[a.playerID] = a.botID;
      }
      setBotMap(next);
      setPhase("game");
    },
  });

  if (phase === "lobby") {
    const view = buildLobbyView({
      channel,
      userID: HOST_USER_ID,
      capacityFallback: connectFourWithBots.playerIDs.length,
      minPlayersFallback: connectFourWithBots.minPlayers,
      hostUserIDFallback: HOST_USER_ID,
    });
    return (
      <main className="min-h-screen bg-slate-50 text-slate-950">
        <div className="mx-auto max-w-5xl px-6 py-8">
          <LobbyWithBots lobby={view} title="Connect Four" />
        </div>
      </main>
    );
  }

  return <GameRunner channel={channel} botMap={botMap} onLeave={() => setPhase("lobby")} />;
}

function GameRunner({
  channel,
  botMap,
  onLeave,
}: {
  channel: ReturnType<typeof useLocalLobbyChannel>;
  botMap: Record<string, string>;
  onLeave: () => void;
}): ReactNode {
  const [rawSession] = useState(() =>
    createLocalSession(connectFour, { match: { players: connectFour.playerIDs } }),
  );
  const facade = useBotAttachOnTransition({
    channel,
    game: connectFour,
    registry: connectFourBotRegistry,
    session: rawSession,
  });
  const session = facade ?? rawSession;
  const snapshot = session.getState();

  const board = snapshot.G.board;
  const lastMove = snapshot.G.lastMove;
  const result = snapshot.meta.result as ResultLike | null;
  const isOver = result !== null;
  const active = (snapshot.derived.activePlayers[0] ?? "0") as Mark;
  const moves = snapshot.position.turn ?? 0;
  const turn = Math.floor(moves / 2) + 1;

  const localActive = active in botMap ? null : active;
  const seats: readonly [
    { mark: Mark; name: string; role: string; active: boolean },
    { mark: Mark; name: string; role: string; active: boolean },
  ] = [
    {
      mark: "0",
      name: botMap["0"] ? `Bot · ${botMap["0"]}` : "You",
      role: isOver
        ? result!.winner === "0"
          ? "Won"
          : result!.draw
            ? "Draw"
            : "Lost"
        : active === "0"
          ? botMap["0"]
            ? "Thinking…"
            : "Your turn"
          : "Waiting",
      active: !isOver && active === "0",
    },
    {
      mark: "1",
      name: botMap["1"] ? `Bot · ${botMap["1"]}` : "You",
      role: isOver
        ? result!.winner === "1"
          ? "Won"
          : result!.draw
            ? "Draw"
            : "Lost"
        : active === "1"
          ? botMap["1"]
            ? "Thinking…"
            : "Your turn"
          : "Waiting",
      active: !isOver && active === "1",
    },
  ];

  const status = isOver
    ? result!.draw
      ? "Draw"
      : result!.winner === "0"
        ? "Red wins"
        : "Yellow wins"
    : active in botMap
      ? `${active === "0" ? "Red" : "Yellow"} is thinking…`
      : "Your turn — drop into a column";

  return (
    <main className="min-h-screen bg-slate-50 text-slate-950">
      <Match
        board={board}
        lastMove={lastMove}
        activeMark={localActive}
        canPlay={!isOver && localActive !== null}
        onDrop={(col) => session.applyEvent(active, "dropDisc", { col })}
        status={status}
        seats={seats}
        turn={turn}
        moves={moves}
        isOver={isOver}
        onNewMatch={onLeave}
      />
    </main>
  );
}
```

- [ ] **Step 2: Verify typecheck**

```bash
bun --filter @openturn/example-connect-four-app typecheck
```
Expected: exits 0. If it fails because `LobbyWithBots`, `buildLobbyView`, `useBotAttachOnTransition`, or `useLocalLobbyChannel` aren't exported under those names, open `packages/lobby/src/react/index.ts` to find the current names and update imports accordingly. Splendor's `app/src/components/SplendorExperience.tsx` is the canonical reference.

- [ ] **Step 3: Commit**

```bash
git add examples/games/connect-four/app/src/components/ConnectFourExperience.tsx
git commit -m "feat(connect-four/app): add ConnectFourExperience with lobby + bot wiring"
```

---

### Task 33: Wire `app/page.tsx` to route between LocalPreview and the experience

**Files:**
- Modify: `examples/games/connect-four/app/app/page.tsx`

- [ ] **Step 1: Replace the placeholder**

`examples/games/connect-four/app/app/page.tsx`:

```tsx
import "../src/styles.css";

import { ConnectFourExperience } from "../src/components/ConnectFourExperience";
import { LocalPreview } from "../src/components/LocalPreview";

export default function Page() {
  if (
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("preview") === "local"
  ) {
    return <LocalPreview />;
  }
  return <ConnectFourExperience />;
}
```

- [ ] **Step 2: Typecheck**

```bash
bun --filter @openturn/example-connect-four-app typecheck
```
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add examples/games/connect-four/app/app/page.tsx
git commit -m "feat(connect-four/app): wire page.tsx routing"
```

---

## Phase 5 — Smoke testing

### Task 34: Smoke — local hot-seat (`?preview=local`)

**Files:**
- (none modified)

This validates the board layout, drop animation, and last-move halo without involving the lobby or bots.

- [ ] **Step 1: Start the dev server**

From the repo root:

```bash
bun --filter @openturn/example-connect-four-app dev
```
Expected: the CLI prints a URL — likely `http://localhost:3009`.

- [ ] **Step 2: Open the preview URL**

Open `http://localhost:3009/?preview=local` in a browser.

- [ ] **Step 3: Manually verify**

Check each of these on the screen:
- Empty 6×7 board renders with light slate cells.
- Hovering column 4 shows a faded red ghost disc above the column.
- Clicking column 4 drops a red disc that springs to row 5; brief squash on landing.
- The freshly-placed disc shows the soft halo (subtle bloom; no double-edge).
- It's now yellow's turn; status banner reads "Yellow to move".
- Clicking a column drops yellow; halo moves to the new disc.
- Build a 4-in-a-row; status reads "Red wins" or "Yellow wins" and the "New match" button appears.
- "New match" returns to an empty board.
- Pressing Tab cycles focus through the column buttons; Enter drops a disc.

- [ ] **Step 4: Stop the dev server (Ctrl-C). No commit.**

If anything looks wrong, fix it and commit before continuing. (Common fixes: halo too subtle/strong → adjust `LAST_MOVE_HALO`; spring too bouncy → tune `damping`; ghost too faded → adjust `/30`.)

---

### Task 35: Smoke — local lobby with Minimax bot

**Files:**
- (none modified)

- [ ] **Step 1: Start the dev server**

```bash
bun --filter @openturn/example-connect-four-app dev
```

- [ ] **Step 2: Open the lobby URL**

Open `http://localhost:3009/` (no query string).

- [ ] **Step 3: Manually verify**

- The lobby shows two seats. You're auto-seated at seat 0.
- Seat 1 has an "Assign bot ▾" dropdown listing **Random**, **Heuristic**, **Minimax**.
- Pick **Minimax**, click **Start**.
- The match phase mounts. It's your turn (red).
- Drop a disc; status flips to "Yellow is thinking…", the bot drops within ~2 seconds (often <500ms early-game), status flips back to "Your turn".
- Play to completion. Status announces the winner and "New match" appears. Clicking it returns to the lobby.

- [ ] **Step 4: Stop the dev server. No commit unless fixes are needed.**

---

### Task 36: Smoke — hosted multiplayer (two browser tabs)

**Files:**
- (none modified)

- [ ] **Step 1: Start the dev server**

```bash
bun --filter @openturn/example-connect-four-app dev
```

- [ ] **Step 2: Open two browser tabs against the same dev server URL.**

In tab A, open the lobby. The tab takes seat 0 automatically. Note the room URL.

In tab B, open the same URL. Take seat 1 manually.

In tab A, click **Start**. Both tabs should transition to the match phase together.

- [ ] **Step 3: Manually verify**

- Drop a disc in tab A. The disc appears in both tabs.
- Drop a disc in tab B. Same.
- Reload tab B mid-game. State restores from the room snapshot; the match resumes.
- Play to completion in both tabs.

- [ ] **Step 4: Stop the dev server. No commit unless fixes are needed.**

---

### Task 37: Final verification — full repo typecheck and tests

**Files:**
- (none modified)

- [ ] **Step 1: Run repo-wide typecheck**

```bash
bun run typecheck
```
Expected: exits 0. The new connect-four packages are checked alongside everything else.

- [ ] **Step 2: Run repo-wide test suite**

```bash
bun run test
```
Expected: connect-four game and bots tests pass; nothing else regresses.

- [ ] **Step 3: Run runtime-boundary check**

```bash
bun run check:runtimes
```
Expected: exits 0.

- [ ] **Step 4: If any of the above fails, fix the issue and commit. Otherwise, the implementation is complete.**

---

## Self-review summary

Spec coverage check, run by the planning author after writing this plan:

| Spec section | Covered by |
|---|---|
| §Goal — Splendor-tier example | Phases 0–4 collectively |
| §Architecture — three packages | Tasks 4, 15, 23 |
| §1 Game definition — state, moves, computed, views, legalActions | Tasks 5–13 |
| §2 Bots — random, heuristic, minimax, registry | Tasks 16, 17, 19, 21 |
| §2 Bots — determinism | Tasks 16 (random determinism), 19 (minimax tactical), 20 (deadline) |
| §3 App — Tailwind v4, no inline style, no CSS-in-JS | Tasks 23 (styles.css, halo.ts), 24 (Disc Tailwind classes) |
| §3 App — Disc, ColumnGhost, Board, StatusBanner, PlayerCard, Sidebar, Match, LocalPreview, ConnectFourExperience, page routing | Tasks 24–33 |
| §3 App — accessibility (aria-labels, role=grid, focus-visible) | Tasks 26 (Board buttons), 27 (StatusBanner aria-live), 24 (Disc role=gridcell) |
| §3 App — bot driver wiring via useBotAttachOnTransition | Task 32 |
| §4 Cloud / runtime metadata | Task 23 step 4 (openturn.ts) and step 1 (dev/build/deploy scripts) |
| §5 Testing — game/bots unit tests + manual app smoke | Tasks 5–13 (game), 16–21 (bots), 34–36 (app smoke) |
| §6 Migration — cutover delete + .gitignore + workspace integration | Tasks 1, 2, 3 |
| §7 LOC budget, performance | Implicitly via the implementation; no separate task |
| WinningLineOverlay (mentioned in spec §3 App table) | **Not implemented in this plan.** The winning line is conveyed via the disc halo on the freshly-placed winner and the explicit status banner ("Red wins"). The spec listed `WinningLineOverlay` as a component; we explicitly defer it as YAGNI for v1 since the existing affordances communicate the win clearly. If desired later, it's a one-component addition: SVG line through the 4 cells of `view.winningLine`. |
| Move history (mentioned in spec §3 layout diagram) | **Not implemented in this plan.** The Sidebar shows turn + move counts only. A move history list adds complexity without changing playability. Defer to a follow-up if the user asks for it. |

The two deferred items are flagged here so the user can call them in or out before execution begins.

---

## Execution

Plan complete and saved to `openturn/superpowers/plans/2026-05-09-connect-four.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration with full test/typecheck verification at each commit.
2. **Inline Execution** — Execute tasks in this session using `executing-plans`, batch execution with periodic checkpoints for review.

Which approach would you like?
