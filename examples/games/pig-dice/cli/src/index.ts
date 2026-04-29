import { stdout } from "node:process";

import { createLocalSession, type PlayerID } from "@openturn/core";
import { PIG_DICE_TARGET_SCORE, pigDice } from "@openturn/example-pig-dice-game";

const session = createLocalSession(pigDice, { match: { players: pigDice.playerIDs } });
const lineReader = createLineReader();

console.log("Pig Dice local game");
console.log(`First player to ${PIG_DICE_TARGET_SCORE} wins.`);
console.log("Enter `roll`, `hold`, or `q` to quit. Rolls are generated locally by the CLI.\n");

try {
  await play();
} finally {
  await lineReader.close();
}

async function play(): Promise<void> {
  while (true) {
    const snapshot = session.getState();
    printState(snapshot);

    if (snapshot.meta.result?.winner) {
      console.log(`Winner: player ${snapshot.meta.result.winner}`);
      return;
    }

    const playerID = snapshot.derived.activePlayers[0]!;
    const answer = await lineReader.read(`Player ${playerID}, choose roll or hold: `);

    if (answer === null || answer.trim().toLowerCase() === "q") {
      console.log("Game ended.");
      return;
    }

    const command = answer.trim().toLowerCase();

    if (command !== "roll" && command !== "hold") {
      console.log("Invalid input. Enter `roll`, `hold`, or `q`.\n");
      continue;
    }

    const result = command === "roll"
      ? session.applyEvent(playerID, "roll", { value: randomDieValue() })
      : session.applyEvent(playerID, "hold", undefined);

    if (!result.ok) {
      console.log(formatMoveError(result.error));
      console.log("");
    }
  }
}

function printState(snapshot: ReturnType<typeof session.getState>): void {
  console.log(`Scores: P0=${snapshot.G.scores["0"]} P1=${snapshot.G.scores["1"]}`);
  console.log(`Turn total: ${snapshot.G.turnTotal}`);
  console.log(`Last roll: ${snapshot.G.lastRoll ?? "-"}`);
  console.log("");
}

function formatMoveError(error: string): string {
  switch (error) {
    case "inactive_player":
      return "It is not your turn.";
    case "invalid_event":
      return "That action is not allowed right now.";
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

function playerLabel(playerID: PlayerID): string {
  return `player ${playerID}`;
}

function randomDieValue(): number {
  return Math.floor(Math.random() * 6) + 1;
}
