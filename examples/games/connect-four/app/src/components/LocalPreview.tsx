import { useMemo } from "react";
import type { Mark } from "@openturn/example-connect-four-game";

import { OpenturnProvider, createLocalMatch, useMatch } from "../lib/bindings";
import { Match } from "./Match";

interface ResultLike { winner?: string; draw?: boolean }

// Local-mode preview — no lobby, no websocket. Both seats sit at this browser
// tab. Wired only when the URL includes `?preview=local`. Uses the shared
// multiplayer bindings with an explicit `match` prop on OpenturnProvider —
// which forces local mode for just this subtree without spawning a second
// bindings instance (which the per-game cache in `createOpenturnBindings`
// would silently swallow).
export function LocalPreview(): React.ReactElement {
  const matchStore = useMemo(
    () => createLocalMatch({ match: { players: ["0", "1"] } }),
    [],
  );
  return (
    <OpenturnProvider match={matchStore}>
      <main className="min-h-screen bg-slate-50 text-slate-950">
        <PreviewBoard />
      </main>
    </OpenturnProvider>
  );
}

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
