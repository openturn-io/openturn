import { stdout } from "node:process";
import { createLocalSession } from "@openturn/core";
import { ticTacToe, ticTacToeGameID, ticTacToeMatch } from "@openturn/example-tic-tac-toe-game";
import { createSavedReplayFromSession, serializeSavedReplay } from "@openturn/replay";
const session = createLocalSession(ticTacToe, { match: ticTacToeMatch });
const lineReader = createLineReader();
const replayOutputPath = getReplayOutputPath(Bun.argv.slice(2));
console.log("Tic-tac-toe local game");
console.log("Enter moves as: row col");
console.log("Rows and columns are 0-based: 0, 1, 2");
if (replayOutputPath !== null) {
    console.log(`Replay output: ${replayOutputPath}`);
}
console.log("Enter q to quit.\n");
try {
    await play();
}
finally {
    await saveReplayIfRequested();
    await lineReader.close();
}
async function play() {
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
        const playerID = snapshot.derived.activePlayers[0];
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
function parseMove(inputValue) {
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
function formatMoveError(error) {
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
function playerMark(playerID) {
    return playerID === "0" ? "X" : "O";
}
function createLineReader() {
    const reader = Bun.stdin.stream().pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";
    return {
        async read(promptText) {
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
function getReplayOutputPath(args) {
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
function printBoard(board) {
    console.log("  0 1 2");
    board.forEach((row, index) => {
        console.log(`${index} ${row.map((cell) => cell ?? ".").join(" ")}`);
    });
    console.log("");
}
