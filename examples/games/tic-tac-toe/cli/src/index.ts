import { stdout } from "node:process";

import { attachLocalBots, type Bot } from "@openturn/bot";
import { createLocalSession, type PlayerID } from "@openturn/core";
import { minimaxBot, randomBot } from "@openturn/example-tic-tac-toe-bots";
import { ticTacToe, ticTacToeGameID } from "@openturn/example-tic-tac-toe-game";
import { createSavedReplayFromSession, serializeSavedReplay } from "@openturn/replay";

const cliArgs = Bun.argv.slice(2);
const replayOutputPath = getReplayOutputPath(cliArgs);
const botFlags = parseBotFlags(cliArgs);

const rawSession = createLocalSession(ticTacToe, { match: { players: ticTacToe.playerIDs } });

const bots: Partial<Record<PlayerID, Bot<typeof ticTacToe>>> = {};
for (const [seat, name] of Object.entries(botFlags)) {
  const bot = resolveBot(name);
  if (bot === null) {
    console.error(`Unknown bot "${name}" for seat ${seat}. Available bots: random, minimax.`);
    process.exit(1);
  }
  bots[seat] = bot;
}

const { session, isBot, whenIdle, detachAll } = attachLocalBots({
  session: rawSession,
  game: ticTacToe,
  bots,
});

const lineReader = createLineReader();

console.log("Tic-tac-toe local game");
console.log("Enter moves as: row col");
console.log("Rows and columns are 0-based: 0, 1, 2");
if (replayOutputPath !== null) {
  console.log(`Replay output: ${replayOutputPath}`);
}
const botSeats = Object.keys(botFlags);
if (botSeats.length > 0) {
  console.log(`Bots: ${botSeats.map((seat) => `seat ${seat}=${botFlags[seat]}`).join(", ")}`);
}
console.log("Enter q to quit.\n");

try {
  await play();
} finally {
  detachAll();
  await saveReplayIfRequested();
  await lineReader.close();
}

async function play(): Promise<void> {
  while (true) {
    const snapshot = session.getState();

    printBoard(snapshot.G.board);

    if (snapshot.meta.result?.winner) {
      console.log(`Winner: player ${snapshot.meta.result.winner} (${playerMark(snapshot.meta.result.winner)})`);
      return;
    }

    if (snapshot.meta.result?.draw) {
      console.log("Result: draw");
      return;
    }

    const playerID = snapshot.derived.activePlayers[0]!;

    if (isBot(playerID)) {
      const beforeTurn = snapshot.position.turn;
      console.log(`Player ${playerID} (${playerMark(playerID)}) [${botFlags[playerID]}] is thinking...`);
      await whenIdle(playerID);
      const after = session.getState();
      if (after.position.turn === beforeTurn && (after.meta.result === null || after.meta.result === undefined)) {
        // Bot did not produce a move (deadline + no fallback). Bail out instead of looping forever.
        console.log("Bot failed to produce a move. Stopping.");
        return;
      }
      continue;
    }

    const answer = await lineReader.read(`Player ${playerID} (${playerMark(playerID)}), enter your move: `);

    if (answer === null || answer.trim().toLowerCase() === "q") {
      console.log("Game ended.");
      return;
    }

    const move = parseMove(answer);

    if (move === null) {
      console.log("Invalid input. Use `row col` with values 0, 1, or 2.\n");
      continue;
    }

    const result = session.applyEvent(playerID, "placeMark", move);

    if (!result.ok) {
      console.log(formatMoveError(result.error));
      console.log("");
      continue;
    }
  }
}

function parseMove(inputValue: string): { row: number; col: number } | null {
  const parts = inputValue.trim().split(/\s+/);

  if (parts.length !== 2) {
    return null;
  }

  const row = Number(parts[0]);
  const col = Number(parts[1]);

  if (!Number.isInteger(row) || !Number.isInteger(col)) {
    return null;
  }

  if (row < 0 || row > 2 || col < 0 || col > 2) {
    return null;
  }

  return { row, col };
}

function formatMoveError(error: string): string {
  switch (error) {
    case "inactive_player":
      return "It is not your turn.";
    case "invalid_event":
      return "That square is already occupied.";
    case "ambiguous_transition":
      return "The authored game flow is ambiguous.";
    case "game_over":
      return "The game is already over.";
    case "unknown_player":
      return "That player seat does not exist.";
    default:
      return "Unknown move.";
  }
}

function playerMark(playerID: PlayerID): "X" | "O" {
  return playerID === "0" ? "X" : "O";
}

function resolveBot(name: string): Bot<typeof ticTacToe> | null {
  if (name === "random") return randomBot;
  if (name === "minimax") return minimaxBot;
  return null;
}

function parseBotFlags(args: readonly string[]): Record<PlayerID, string> {
  const flags: Record<PlayerID, string> = {};
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] !== "--bot") continue;
    const value = args[i + 1];
    if (value === undefined) {
      throw new Error("Expected `<seat>=<botName>` after --bot");
    }
    const eq = value.indexOf("=");
    if (eq < 0) {
      throw new Error(`Invalid --bot value "${value}". Expected "<seat>=<botName>".`);
    }
    const seat = value.slice(0, eq);
    const botName = value.slice(eq + 1);
    if (seat.length === 0 || botName.length === 0) {
      throw new Error(`Invalid --bot value "${value}". Expected "<seat>=<botName>".`);
    }
    flags[seat] = botName;
  }
  return flags;
}

function createLineReader(): {
  read(promptText: string): Promise<string | null>;
  close(): Promise<void>;
} {
  const reader = Bun.stdin.stream().pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";

  return {
    async read(promptText: string) {
      stdout.write(promptText);

      while (true) {
        const newlineIndex = buffer.indexOf("\n");

        if (newlineIndex >= 0) {
          const line = buffer.slice(0, newlineIndex).replace(/\r$/, "");
          buffer = buffer.slice(newlineIndex + 1);
          return line;
        }

        const chunk = await reader.read();

        if (chunk.done) {
          const remaining = buffer.replace(/\r$/, "").trim();
          buffer = "";
          return remaining.length > 0 ? remaining : null;
        }

        buffer += chunk.value;
      }
    },
    async close() {
      buffer = "";
      await reader.cancel();
    },
  };
}

async function saveReplayIfRequested() {
  if (replayOutputPath === null) {
    return;
  }

  const envelope = createSavedReplayFromSession({
    gameID: ticTacToeGameID,
    playerID: "0",
    session,
  });

  await Bun.write(replayOutputPath, serializeSavedReplay(envelope));
  console.log(`Saved replay to ${replayOutputPath}`);
}

function getReplayOutputPath(args: readonly string[]): string | null {
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== "--save-replay") {
      continue;
    }

    const nextValue = args[index + 1];
    if (nextValue === undefined || nextValue.length === 0) {
      throw new Error("Expected a file path after --save-replay");
    }

    return nextValue;
  }

  return null;
}

function printBoard(board: ReadonlyArray<ReadonlyArray<string | null>>): void {
  console.log("  0 1 2");
  board.forEach((row, index) => {
    console.log(`${index} ${row.map((cell) => cell ?? ".").join(" ")}`);
  });
  console.log("");
}
