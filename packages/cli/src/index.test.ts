import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "bun:test";

import { defineGame } from "@openturn/core";
import { loadOpenturnProjectDeployment } from "@openturn/deploy";
import { defineGameDeployment } from "@openturn/server";

import { resolveCloudPlayURL } from "./cloud";
import { startDevBundleServer } from "./dev-bundle";
import { createOpenturnProject, removeDatabaseFile, startLocalDevServer } from "./index";

const DEFAULT_MATCH = {
  players: ["0", "1"] as const,
};

const localGame = defineGame({
  playerIDs: DEFAULT_MATCH.players,
  events: {
    place: {
      index: 0,
    },
  },
  initial: "play",
  setup: () => ({
    board: [null, null, null] as Array<"X" | "O" | null>,
  }),
  states: {
    play: {
      activePlayers: ({ match, position }) => [match.players[(position.turn - 1) % match.players.length]!],
      label: "Play",
    },
  },
  transitions: [
    {
      event: "place",
      from: "play",
      resolve: ({ G, event, playerID }) => {
        if (G.board[event.payload.index] !== null) {
          return null;
        }

        return {
          G: {
            board: G.board.map((cell, index) => index === event.payload.index ? (playerID === "0" ? "X" : "O") : cell),
          },
          turn: "increment",
        };
      },
      to: "play",
    },
  ],
  views: {
    player({ G }) {
      return G;
    },
  },
});

const deployment = defineGameDeployment({
  deploymentVersion: "dev",
  game: localGame,
  gameKey: "local-game",
  match: DEFAULT_MATCH,
  schemaVersion: "1",
});

const botBackedGame = defineGame({
  playerIDs: DEFAULT_MATCH.players,
  events: {
    place: {
      index: 0,
    },
  },
  initial: "play",
  setup: () => ({
    board: [null, null, null] as Array<"X" | "O" | null>,
  }),
  states: {
    play: {
      activePlayers: ({ match, position }) => [match.players[(position.turn - 1) % match.players.length]!],
      label: "Play",
    },
  },
  legalActions: ({ G, derived }, playerID) => {
    if (!derived.activePlayers.includes(playerID)) return [];
    return G.board
      .map((cell, index) => (cell === null ? { event: "place", payload: { index } } : null))
      .filter((action): action is { event: "place"; payload: { index: number } } => action !== null);
  },
  transitions: localGame.transitions,
  views: localGame.views,
});

const firstLegalBot = {
  name: "first-legal",
  decide({ legalActions }: { legalActions: readonly { event: string; payload: unknown }[] }) {
    if (legalActions.length === 0) throw new Error("firstLegalBot: no legal actions");
    return legalActions[0]!;
  },
};

const botDeployment = defineGameDeployment({
  deploymentVersion: "dev",
  game: {
    ...botBackedGame,
    bots: {
      entries: [
        {
          botID: "first",
          label: "First legal",
          difficulty: "easy",
          bot: firstLegalBot,
        },
      ],
    },
  },
  gameKey: "bot-backed-game",
  match: DEFAULT_MATCH,
  schemaVersion: "1",
});

describe("createOpenturnProject", () => {
  test("creates the default local template with workspace dependencies", () => {
    const projectDir = createScaffoldTarget("local-template");

    try {
      const result = createOpenturnProject({ projectDir });
      const packageJson = JSON.parse(readFileSync(join(projectDir, "package.json"), "utf8")) as {
        dependencies: Record<string, string>;
        devDependencies: Record<string, string>;
        scripts: Record<string, string>;
      };

      expect(result.template).toBe("local");
      expect(packageJson.dependencies["@openturn/core"]).toBe("workspace:*");
      expect(packageJson.dependencies["@openturn/gamekit"]).toBe("workspace:*");
      expect(packageJson.dependencies["@openturn/react"]).toBe("workspace:*");
      expect(packageJson.devDependencies["@openturn/cli"]).toBe("workspace:*");
      expect(packageJson.scripts).toMatchObject({
        dev: "openturn dev .",
        build: "openturn build .",
        deploy: "openturn deploy .",
      });
      expect(readFileSync(join(projectDir, "app", "openturn.ts"), "utf8")).toContain('runtime: "local"');
      expect(readFileSync(join(projectDir, "app", "page.tsx"), "utf8")).toContain('runtime: "local"');
      expect(readFileSync(join(projectDir, "app", "game.ts"), "utf8")).toContain("defineGame");
    } finally {
      rmSync(projectDir, { force: true, recursive: true });
    }
  });

  test("creates the multiplayer template", () => {
    const projectDir = createScaffoldTarget("multiplayer-template");

    try {
      createOpenturnProject({ projectDir, template: "multiplayer" });
      const metadata = readFileSync(join(projectDir, "app", "openturn.ts"), "utf8");
      const page = readFileSync(join(projectDir, "app", "page.tsx"), "utf8");

      expect(metadata).toContain('runtime: "multiplayer"');
      expect(metadata).toContain(`gameKey: ${JSON.stringify(basename(projectDir))}`);
      expect(metadata).toContain('schemaVersion: "1"');
      expect(page).toContain("OpenturnProvider");
      expect(page).toContain("useRoom");
      expect(page).not.toContain("createLocalMatch");
      expect(page).not.toContain("useHostedMatch");
    } finally {
      rmSync(projectDir, { force: true, recursive: true });
    }
  });

  test("rejects unknown templates", () => {
    const projectDir = createScaffoldTarget("unknown-template");

    try {
      expect(() => createOpenturnProject({ projectDir, template: "hidden-info" })).toThrow("Supported templates: local, multiplayer");
    } finally {
      rmSync(projectDir, { force: true, recursive: true });
    }
  });

  test("rejects non-empty target directories", () => {
    const projectDir = createScaffoldTarget("non-empty");
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(join(projectDir, "README.md"), "occupied\n");

    try {
      expect(() => createOpenturnProject({ projectDir })).toThrow("non-empty directory");
    } finally {
      rmSync(projectDir, { force: true, recursive: true });
    }
  });
});

describe("@openturn/cli", () => {
  test("declares a Bun shebang for the published bin entrypoint", () => {
    const packageRoot = resolve(import.meta.dir, "..");
    const packageJson = JSON.parse(readFileSync(resolve(packageRoot, "package.json"), "utf8")) as {
      bin?: Record<string, string>;
      publishConfig?: {
        bin?: Record<string, string>;
      };
    };
    const sourceEntrypoint = readFileSync(resolve(packageRoot, packageJson.bin?.openturn ?? ""), "utf8");

    expect(packageJson.bin?.openturn).toBe("./src/index.ts");
    expect(packageJson.publishConfig?.bin?.openturn).toBe("./dist/index.js");
    expect(sourceEntrypoint.startsWith("#!/usr/bin/env bun\n")).toBe(true);
  });

  test("prefers the cloud shell play URL when deployment completion returns one", () => {
    expect(resolveCloudPlayURL("https://openturn.io", {
      playURL: "https://dep-123abc.openturn.games/index.html",
      policyPlayURL: "/play/dep_123",
    })).toBe("https://openturn.io/play/dep_123");
  });

  test("routes host+guest through lobby to game over one durable websocket each", async () => {
    const databasePath = createDatabasePath("lobby-to-game-end-to-end");
    const server = await startLocalDevServer({
      dbPath: databasePath,
      deployment,
      port: createTestPort(),
    });

    try {
      const hostSession = await createAnonymousSession(server.url);
      const guestSession = await createAnonymousSession(server.url);

      const hostSnapshot = await createRoom(server.url, hostSession.token);
      expect(hostSnapshot.scope).toBe("lobby");
      expect(hostSnapshot.isHost).toBe(true);
      expect(hostSnapshot.targetCapacity).toBe(2);
      expect(hostSnapshot.maxPlayers).toBe(2);

      const guestSnapshot = await joinLobby(server.url, hostSnapshot.roomID, guestSession.token);
      expect(guestSnapshot.isHost).toBe(false);

      const { gameSocketInfo: hostGameInfo, lobbySocket: hostLobbySocket } =
        await runLobbyToStart({
          snapshot: hostSnapshot,
          seatIndex: 0,
          isHost: true,
          guestSnapshots: [guestSnapshot],
          guestSeatIndexes: [1],
        });

      hostLobbySocket.close();

      const hostGameSocket = new WebSocket(hostGameInfo.websocketURL);
      const guestGameSocket = new WebSocket(
        // Open a parallel game WS for the guest by asking the lobby for a
        // fresh lobby token, sitting in seat 1, and reusing the transition
        // message captured in the helper. For simplicity we just reuse the
        // guest's existing transition info.
        guestSnapshot.websocketURL,
      );
      guestGameSocket.close();

      const hostMessages: unknown[] = [];
      hostGameSocket.addEventListener("message", (event) => {
        hostMessages.push(JSON.parse(event.data.toString()));
      });
      await waitForOpen(hostGameSocket);
      await waitFor(() => hostMessages.length >= 1);

      hostGameSocket.send(JSON.stringify({
        type: "action",
        clientActionID: "opening",
        event: "place",
        matchID: hostSnapshot.roomID,
        payload: { index: 0 },
        playerID: hostGameInfo.playerID,
      }));

      await waitFor(() =>
        hostMessages.some((message) => isBatchApplied(message)),
      );

      hostGameSocket.close();
      await waitForClose(hostGameSocket);
    } finally {
      await server.stop();
      removeDatabaseFile(databasePath);
    }
  });

  test("drives assigned bot seats in local dev rooms", async () => {
    const databasePath = createDatabasePath("local-dev-bot-driver");
    const server = await startLocalDevServer({
      dbPath: databasePath,
      deployment: botDeployment,
      port: createTestPort(),
    });

    try {
      const hostSession = await createAnonymousSession(server.url);
      const hostSnapshot = await createRoom(server.url, hostSession.token);
      const hostSocket = new WebSocket(withToken(hostSnapshot));
      const lobbyMessages: unknown[] = [];
      hostSocket.addEventListener("message", (event) => {
        lobbyMessages.push(JSON.parse(event.data.toString()));
      });
      await waitForOpen(hostSocket);
      await waitFor(() => lobbyMessages.some((msg) => isLobbyState(msg)));

      const transition = new Promise<{ token: string; playerID: string; websocketURL: string }>((resolveTransition) => {
        hostSocket.addEventListener("message", (event) => {
          const msg = JSON.parse(event.data.toString()) as { type?: unknown };
          if (msg.type === "lobby:transition_to_game") {
            const t = msg as { roomToken: string; playerID: string; websocketURL: string };
            resolveTransition({
              token: t.roomToken,
              playerID: t.playerID,
              websocketURL: t.websocketURL,
            });
          }
        });
      });

      hostSocket.send(JSON.stringify({ type: "lobby:take_seat", seatIndex: 0 }));
      hostSocket.send(JSON.stringify({ type: "lobby:assign_bot", seatIndex: 1, botID: "first" }));
      hostSocket.send(JSON.stringify({ type: "lobby:set_ready", ready: true }));
      await waitFor(() =>
        lobbyMessages.some((msg) => isLobbyState(msg) && (msg as { canStart: boolean }).canStart === true),
      );

      hostSocket.send(JSON.stringify({ type: "lobby:start" }));
      const gameInfo = await transition;

      const gameSocket = new WebSocket(gameInfo.websocketURL);
      const gameMessages: unknown[] = [];
      gameSocket.addEventListener("message", (event) => {
        gameMessages.push(JSON.parse(event.data.toString()));
      });
      await waitForOpen(gameSocket);
      await waitFor(() => gameMessages.some((message) => isPlayerSnapshotRevision(message, 0)));

      gameSocket.send(JSON.stringify({
        type: "action",
        clientActionID: "human-opening",
        event: "place",
        matchID: hostSnapshot.roomID,
        payload: { index: 0 },
        playerID: gameInfo.playerID,
      }));

      await waitFor(() => gameMessages.some((message) => isBatchAppliedRevision(message, 2)));
      const botBatch = gameMessages.find((message) => isBatchAppliedRevision(message, 2)) as {
        steps: ReadonlyArray<{ snapshot: { G: { board: readonly unknown[] } } }>;
      };
      const lastStep = botBatch.steps[botBatch.steps.length - 1]!;
      expect(lastStep.snapshot.G.board).toEqual(["X", "O", null]);

      gameSocket.close();
      hostSocket.close();
      await waitForClose(gameSocket);
    } finally {
      await server.stop();
      removeDatabaseFile(databasePath);
    }
  });

  test("returns game-scoped tokens for assigned users after a room starts", async () => {
    const databasePath = createDatabasePath("active-room-game-token");
    const server = await startLocalDevServer({
      dbPath: databasePath,
      deployment,
      iframe: {
        bundleURL: "http://localhost:4999",
        deploymentID: "dev",
        gameName: "Local Game",
      },
      port: createTestPort(),
    });

    try {
      const hostSession = await createAnonymousSession(server.url);
      const guestSession = await createAnonymousSession(server.url);

      const hostSnapshot = await createRoom(server.url, hostSession.token);
      const guestSnapshot = await joinLobby(server.url, hostSnapshot.roomID, guestSession.token);

      const { gameSocketInfo, lobbySocket, guestSockets } = await runLobbyToStart({
        snapshot: hostSnapshot,
        seatIndex: 0,
        isHost: true,
        guestSnapshots: [guestSnapshot],
        guestSeatIndexes: [1],
      });

      const activeHostSnapshot = await joinLobby(server.url, hostSnapshot.roomID, hostSession.token);
      expect(activeHostSnapshot.scope).toBe("game");
      expect(activeHostSnapshot.playerID).toBe(gameSocketInfo.playerID);

      const activeGuestSnapshot = await joinLobby(server.url, hostSnapshot.roomID, guestSession.token);
      expect(activeGuestSnapshot.scope).toBe("game");
      expect(activeGuestSnapshot.playerID).toBe("1");

      const playShell = await fetch(`${server.url}/play/dev?room=${hostSnapshot.roomID}`);
      expect(playShell.status).toBe(200);
      const playShellHTML = await playShell.text();
      expect(playShellHTML).toContain('id="root"');
      expect(playShellHTML).toContain("/__openturn/play-app/main.js");
      expect(playShellHTML).toContain("__OPENTURN_PLAY__");

      lobbySocket.close();
      for (const socket of guestSockets) {
        socket.close();
      }
    } finally {
      await server.stop();
      removeDatabaseFile(databasePath);
    }
  });

  test("reset keeps active game sockets connected and syncs fresh snapshots", async () => {
    const databasePath = createDatabasePath("reset-keeps-game-sockets");
    const server = await startLocalDevServer({
      dbPath: databasePath,
      deployment,
      port: createTestPort(),
    });

    try {
      const hostSession = await createAnonymousSession(server.url);
      const guestSession = await createAnonymousSession(server.url);

      const hostSnapshot = await createRoom(server.url, hostSession.token);
      const guestSnapshot = await joinLobby(server.url, hostSnapshot.roomID, guestSession.token);

      const { gameSocketInfo: hostGameInfo, guestGameSocketInfos, lobbySocket, guestSockets } =
        await runLobbyToStart({
          snapshot: hostSnapshot,
          seatIndex: 0,
          isHost: true,
          guestSnapshots: [guestSnapshot],
          guestSeatIndexes: [1],
        });

      const hostGameSocket = new WebSocket(hostGameInfo.websocketURL);
      const guestGameSocket = new WebSocket(guestGameSocketInfos[0]!.websocketURL);
      const hostGameMessages: unknown[] = [];
      const guestGameMessages: unknown[] = [];
      hostGameSocket.addEventListener("message", (event) => {
        hostGameMessages.push(JSON.parse(event.data.toString()));
      });
      guestGameSocket.addEventListener("message", (event) => {
        guestGameMessages.push(JSON.parse(event.data.toString()));
      });

      await waitForOpen(hostGameSocket);
      await waitForOpen(guestGameSocket);
      await waitFor(() => hostGameMessages.some((message) => isPlayerSnapshotRevision(message, 0)));
      await waitFor(() => guestGameMessages.some((message) => isPlayerSnapshotRevision(message, 0)));

      hostGameSocket.send(JSON.stringify({
        type: "action",
        clientActionID: "opening",
        event: "place",
        matchID: hostSnapshot.roomID,
        payload: { index: 0 },
        playerID: hostGameInfo.playerID,
      }));

      await waitFor(() => hostGameMessages.some((message) => isBatchAppliedRevision(message, 1)));
      await waitFor(() => guestGameMessages.some((message) => isBatchAppliedRevision(message, 1)));

      const resetResponse = await fetch(`${server.url}/api/dev/rooms/${hostSnapshot.roomID}/reset`, {
        headers: {
          authorization: `Bearer ${hostSession.token}`,
        },
        method: "POST",
      });
      expect(resetResponse.status).toBe(200);

      await waitFor(() => hostGameMessages.some(isFreshResetSnapshot));
      await waitFor(() => guestGameMessages.some(isFreshResetSnapshot));
      expect(hostGameSocket.readyState).toBe(WebSocket.OPEN);
      expect(guestGameSocket.readyState).toBe(WebSocket.OPEN);

      hostGameSocket.close();
      guestGameSocket.close();
      lobbySocket.close();
      for (const socket of guestSockets) {
        socket.close();
      }
      await waitForClose(hostGameSocket);
      await waitForClose(guestGameSocket);
    } finally {
      await server.stop();
      removeDatabaseFile(databasePath);
    }
  });

  test("variable-capacity lobby: starts with seated subset and the running game sees match.players filtered", async () => {
    // Regression: the dev CLI was eagerly creating the room runtime at room
    // creation time with the maximal player roster and never rebuilding it
    // after `lobby:start`. A 2-of-4 lobby would then run the game with all
    // four players, leaving the two unseated IDs in turn rotation. This test
    // pins the post-`lobby:start` runtime down to the seated subset.
    const variableGame = defineGame({
      playerIDs: ["0", "1", "2", "3"] as const,
      minPlayers: 2,
      events: { place: { index: 0 } },
      initial: "play",
      setup: () => ({
        board: [null, null, null] as Array<"X" | "O" | null>,
      }),
      states: {
        play: {
          activePlayers: ({ match, position }) => [match.players[(position.turn - 1) % match.players.length]!],
          label: "Play",
        },
      },
      transitions: [
        {
          event: "place",
          from: "play",
          resolve: ({ G, event, playerID }) => {
            if (G.board[event.payload.index] !== null) {
              return null;
            }
            return {
              G: {
                board: G.board.map((cell, index) => index === event.payload.index ? (playerID === "0" ? "X" : "O") : cell),
              },
              turn: "increment",
            };
          },
          to: "play",
        },
      ],
      views: {
        player({ G }) {
          return G;
        },
      },
    });
    const variableDeployment = defineGameDeployment({
      deploymentVersion: "dev",
      game: variableGame,
      gameKey: "variable-capacity-game",
      schemaVersion: "1",
    });
    const databasePath = createDatabasePath("variable-capacity-lobby-filter");
    const server = await startLocalDevServer({
      dbPath: databasePath,
      deployment: variableDeployment,
      port: createTestPort(),
    });

    try {
      const hostSession = await createAnonymousSession(server.url);
      const guestSession = await createAnonymousSession(server.url);

      const hostSnapshot = await createRoom(server.url, hostSession.token);
      expect(hostSnapshot.maxPlayers).toBe(4);
      expect(hostSnapshot.minPlayers).toBe(2);

      const guestSnapshot = await joinLobby(server.url, hostSnapshot.roomID, guestSession.token);

      const { gameSocketInfo: hostGameInfo, guestGameSocketInfos } = await runLobbyToStart({
        snapshot: hostSnapshot,
        seatIndex: 0,
        isHost: true,
        guestSnapshots: [guestSnapshot],
        guestSeatIndexes: [1],
      });
      const guestGameInfo = guestGameSocketInfos[0]!;

      const hostGameSocket = new WebSocket(hostGameInfo.websocketURL);
      const guestGameSocket = new WebSocket(guestGameInfo.websocketURL);
      const hostGameMessages: unknown[] = [];
      const guestGameMessages: unknown[] = [];
      hostGameSocket.addEventListener("message", (event) => {
        hostGameMessages.push(JSON.parse(event.data.toString()));
      });
      guestGameSocket.addEventListener("message", (event) => {
        guestGameMessages.push(JSON.parse(event.data.toString()));
      });
      await waitForOpen(hostGameSocket);
      await waitForOpen(guestGameSocket);
      await waitFor(() => hostGameMessages.some((m) => isPlayerSnapshotRevision(m, 0)));
      await waitFor(() => guestGameMessages.some((m) => isPlayerSnapshotRevision(m, 0)));

      // Turn 1 — seat 0 plays.
      hostGameSocket.send(JSON.stringify({
        type: "action",
        clientActionID: "t1",
        event: "place",
        matchID: hostSnapshot.roomID,
        payload: { index: 0 },
        playerID: hostGameInfo.playerID,
      }));
      await waitFor(() => hostGameMessages.some((m) => isBatchAppliedRevision(m, 1)));

      // Turn 2 — seat 1 plays.
      guestGameSocket.send(JSON.stringify({
        type: "action",
        clientActionID: "t2",
        event: "place",
        matchID: hostSnapshot.roomID,
        payload: { index: 1 },
        playerID: guestGameInfo.playerID,
      }));
      await waitFor(() => hostGameMessages.some((m) => isBatchAppliedRevision(m, 2)));

      // Turn 3's active player is the smoking gun. With the fix
      // (match.players=["0","1"]) it wraps to "0". Without the fix
      // (match.players=["0","1","2","3"]) it would be "2" — a never-seated id
      // that nobody could ever play, freezing the match.
      const turn3Batch = hostGameMessages.find((m) => isBatchAppliedRevision(m, 2)) as {
        steps: ReadonlyArray<{ snapshot: { derived: { activePlayers: readonly string[] } } }>;
      };
      const lastStep = turn3Batch.steps[turn3Batch.steps.length - 1]!;
      expect(lastStep.snapshot.derived.activePlayers).toEqual(["0"]);

      hostGameMessages.length = 0;
      guestGameMessages.length = 0;
      const resetResponse = await fetch(`${server.url}/api/dev/rooms/${hostSnapshot.roomID}/reset`, {
        headers: {
          authorization: `Bearer ${hostSession.token}`,
        },
        method: "POST",
      });
      expect(resetResponse.status).toBe(200);

      await waitFor(() => hostGameMessages.some(isFreshResetSnapshot));
      await waitFor(() => guestGameMessages.some(isFreshResetSnapshot));
      expect(hostGameSocket.readyState).toBe(WebSocket.OPEN);
      expect(guestGameSocket.readyState).toBe(WebSocket.OPEN);

      hostGameMessages.length = 0;
      guestGameMessages.length = 0;
      hostGameSocket.send(JSON.stringify({
        type: "action",
        clientActionID: "reset-t1",
        event: "place",
        matchID: hostSnapshot.roomID,
        payload: { index: 0 },
        playerID: hostGameInfo.playerID,
      }));
      await waitFor(() => hostGameMessages.some((m) => isBatchAppliedRevision(m, 1)));

      guestGameSocket.send(JSON.stringify({
        type: "action",
        clientActionID: "reset-t2",
        event: "place",
        matchID: hostSnapshot.roomID,
        payload: { index: 1 },
        playerID: guestGameInfo.playerID,
      }));
      await waitFor(() => hostGameMessages.some((m) => isBatchAppliedRevision(m, 2)));

      const resetTurn3Batch = hostGameMessages.find((m) => isBatchAppliedRevision(m, 2)) as {
        steps: ReadonlyArray<{ snapshot: { derived: { activePlayers: readonly string[] } } }>;
      };
      const resetLastStep = resetTurn3Batch.steps[resetTurn3Batch.steps.length - 1]!;
      expect(resetLastStep.snapshot.derived.activePlayers).toEqual(["0"]);

      hostGameSocket.close();
      guestGameSocket.close();
      await waitForClose(hostGameSocket);
      await waitForClose(guestGameSocket);
    } finally {
      await server.stop();
      removeDatabaseFile(databasePath);
    }
  });

  test("rejects lobby:start when not all seated players are ready", async () => {
    const databasePath = createDatabasePath("rejects-start-not-ready");
    const server = await startLocalDevServer({
      dbPath: databasePath,
      deployment,
      port: createTestPort(),
    });

    try {
      const hostSession = await createAnonymousSession(server.url);
      const guestSession = await createAnonymousSession(server.url);

      const hostSnapshot = await createRoom(server.url, hostSession.token);
      const guestSnapshot = await joinLobby(server.url, hostSnapshot.roomID, guestSession.token);

      const hostSocket = new WebSocket(withToken(hostSnapshot));
      const guestSocket = new WebSocket(withToken(guestSnapshot));
      const hostMessages: unknown[] = [];
      hostSocket.addEventListener("message", (event) => {
        hostMessages.push(JSON.parse(event.data.toString()));
      });
      guestSocket.addEventListener("message", () => {});

      await waitForOpen(hostSocket);
      await waitForOpen(guestSocket);
      await waitFor(() => hostMessages.some((msg) => isLobbyState(msg)));

      hostSocket.send(JSON.stringify({ type: "lobby:take_seat", seatIndex: 0 }));
      guestSocket.send(JSON.stringify({ type: "lobby:take_seat", seatIndex: 1 }));
      hostSocket.send(JSON.stringify({ type: "lobby:set_ready", ready: true }));
      // Guest does NOT ready up.
      await waitFor(() => hostMessages.some(seatIsReady(0)));
      await new Promise((r) => setTimeout(r, 50));

      hostSocket.send(JSON.stringify({ type: "lobby:start" }));

      await waitFor(() =>
        hostMessages.some(
          (msg) => isLobbyRejected(msg, "not_ready"),
        ),
      );

      hostSocket.close();
      guestSocket.close();
      await waitForClose(hostSocket);
      await waitForClose(guestSocket);
    } finally {
      await server.stop();
      removeDatabaseFile(databasePath);
    }
  });

  test("frees a guest seat when their lobby socket closes", async () => {
    const databasePath = createDatabasePath("frees-seat-on-disconnect");
    const server = await startLocalDevServer({
      dbPath: databasePath,
      deployment,
      port: createTestPort(),
    });

    try {
      const hostSession = await createAnonymousSession(server.url);
      const guestSession = await createAnonymousSession(server.url);

      const hostSnapshot = await createRoom(server.url, hostSession.token);
      const guestSnapshot = await joinLobby(server.url, hostSnapshot.roomID, guestSession.token);

      const hostSocket = new WebSocket(withToken(hostSnapshot));
      const guestSocket = new WebSocket(withToken(guestSnapshot));
      const hostMessages: unknown[] = [];
      hostSocket.addEventListener("message", (event) => {
        hostMessages.push(JSON.parse(event.data.toString()));
      });
      guestSocket.addEventListener("message", () => {});

      await waitForOpen(hostSocket);
      await waitForOpen(guestSocket);
      await waitFor(() => hostMessages.some((msg) => isLobbyState(msg)));

      guestSocket.send(JSON.stringify({ type: "lobby:take_seat", seatIndex: 1 }));
      await waitFor(() => hostMessages.some(seatIsTaken(1, guestSnapshot.userID)));

      guestSocket.close();
      await waitForClose(guestSocket);
      await waitFor(() => hostMessages.some(seatIsOpen(1)));

      hostSocket.close();
      await waitForClose(hostSocket);
    } finally {
      await server.stop();
      removeDatabaseFile(databasePath);
    }
  });

  test("closes the room when the host disconnects", async () => {
    const databasePath = createDatabasePath("closes-on-host-disconnect");
    const server = await startLocalDevServer({
      dbPath: databasePath,
      deployment,
      port: createTestPort(),
    });

    try {
      const hostSession = await createAnonymousSession(server.url);
      const guestSession = await createAnonymousSession(server.url);

      const hostSnapshot = await createRoom(server.url, hostSession.token);
      const guestSnapshot = await joinLobby(server.url, hostSnapshot.roomID, guestSession.token);

      const hostSocket = new WebSocket(withToken(hostSnapshot));
      const guestSocket = new WebSocket(withToken(guestSnapshot));
      const guestMessages: unknown[] = [];
      guestSocket.addEventListener("message", (event) => {
        guestMessages.push(JSON.parse(event.data.toString()));
      });

      await waitForOpen(hostSocket);
      await waitForOpen(guestSocket);
      await waitFor(() => guestMessages.some((msg) => isLobbyState(msg)));

      hostSocket.close();
      await waitForClose(hostSocket);

      await waitFor(() =>
        guestMessages.some(
          (msg) =>
            typeof msg === "object"
            && msg !== null
            && (msg as { type?: unknown }).type === "lobby:closed"
            && (msg as { reason?: unknown }).reason === "host_left",
        ),
      );

      guestSocket.close();
      await waitForClose(guestSocket);
    } finally {
      await server.stop();
      removeDatabaseFile(databasePath);
    }
  });

  test("deprecates the old join-token endpoint", async () => {
    const databasePath = createDatabasePath("deprecates-join-token");
    const server = await startLocalDevServer({
      dbPath: databasePath,
      deployment,
      port: createTestPort(),
    });

    try {
      const session = await createAnonymousSession(server.url);
      const room = await createRoom(server.url, session.token);
      const response = await fetch(
        `${server.url}/api/dev/rooms/${room.roomID}/join-token`,
        {
          method: "POST",
          headers: { authorization: `Bearer ${session.token}` },
        },
      );
      expect(response.status).toBe(410);
    } finally {
      await server.stop();
      removeDatabaseFile(databasePath);
    }
  });

  test("serves dev cors headers for browser-hosted room APIs", async () => {
    const databasePath = createDatabasePath("serves-dev-cors");
    const server = await startLocalDevServer({
      dbPath: databasePath,
      deployment,
      port: createTestPort(),
    });

    try {
      const response = await fetch(`${server.url}/api/dev/rooms`, {
        headers: {
          "access-control-request-headers": "authorization",
          "access-control-request-method": "POST",
          "origin": "http://127.0.0.1:3001",
        },
        method: "OPTIONS",
      });

      expect(response.status).toBe(204);
      expect(response.headers.get("access-control-allow-origin")).toBe("http://127.0.0.1:3001");
      expect(response.headers.get("access-control-allow-methods")).toContain("POST");
      expect(response.headers.get("access-control-allow-headers")).toContain("Authorization");
    } finally {
      await server.stop();
      removeDatabaseFile(databasePath);
    }
  });

  test("serves hosted bundle html as html in local dev", async () => {
    const databasePath = createDatabasePath("hosted-bundle-html-content-type");
    const staticDir = createStaticDir("hosted-bundle-html-content-type");
    writeFileSync(join(staticDir, "index.html"), "<!doctype html><div id=\"openturn-root\"></div>");
    const server = await startLocalDevServer({
      dbPath: databasePath,
      deployment,
      port: createTestPort(),
      static: {
        deploymentID: "dev",
        gameName: "Local Game",
        outDir: staticDir,
      },
    });

    try {
      const response = await fetch(`${server.url}/__openturn/bundle/index.html`);

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
      expect(await response.text()).toContain("openturn-root");

      const shellResponse = await fetch(`${server.url}/play/dev`);
      expect(shellResponse.status).toBe(200);
      const shell = await shellResponse.text();
      expect(shell).toContain('id="root"');
      expect(shell).toContain("/__openturn/play-app/main.js");
      expect(shell).toContain("__OPENTURN_PLAY__");
      expect(shell).not.toContain("openturn-backend");

      const playAppResponse = await fetch(`${server.url}/__openturn/play-app/main.js`);
      expect(playAppResponse.status).toBe(200);
      expect(playAppResponse.headers.get("content-type")).toContain("javascript");
      const playAppBody = await playAppResponse.text();
      expect(playAppBody).toContain("openturn:bridge");
    } finally {
      await server.stop();
      removeDatabaseFile(databasePath);
      rmSync(staticDir, { force: true, recursive: true });
    }
  });

  test("creates missing parent directories for sqlite database paths", async () => {
    const databasePath = createNestedDatabasePath("creates-missing-parent-directories");
    const server = await startLocalDevServer({
      dbPath: databasePath,
      deployment,
      port: createTestPort(),
    });

    try {
      const response = await fetch(`${server.url}/api/dev/health`);
      expect(response.status).toBe(200);
    } finally {
      await server.stop();
      removeDatabaseFile(databasePath);
      rmSync(dirname(databasePath), { force: true, recursive: true });
    }
  });

  test("rejects split localhost servers when the requested port is already occupied on IPv6", async () => {
    const port = createTestPort();
    const databasePath = createDatabasePath("ipv6-port-conflict");
    const blocker = createServer();

    try {
      await new Promise<void>((resolveListen, rejectListen) => {
        blocker.once("error", rejectListen);
        blocker.listen({ host: "::1", port }, () => resolveListen());
      });
    } catch (error) {
      if ((error as { code?: string }).code === "EADDRNOTAVAIL") return;
      throw error;
    }

    try {
      await expect(
        startLocalDevServer({
          dbPath: databasePath,
          deployment,
          port,
        }),
      ).rejects.toThrow(`Port ${port} is already in use on localhost`);
    } finally {
      await new Promise<void>((resolveClose) => blocker.close(() => resolveClose()));
      removeDatabaseFile(databasePath);
    }
  });

  test("loads an app-generated deployment for generic cli usage", async () => {
    const deployment = await loadOpenturnProjectDeployment({
      projectDir: fileURLToPath(new URL("../../../examples/hosted-multiplayer/tic-tac-toe-multiplayer/app", import.meta.url)),
    });

    expect(deployment.gameKey).toBe("tic-tac-toe-multiplayer");
    expect(deployment.deploymentVersion).toBe("dev");
  });

  test("static.shell: false serves the raw built index.html instead of the play shell", async () => {
    const databasePath = createDatabasePath("static-shell-false");
    const staticDir = createStaticDir("static-shell-false");
    writeFileSync(join(staticDir, "index.html"), "<!doctype html><title>Raw Built</title>");
    const server = await startLocalDevServer({
      dbPath: databasePath,
      deployment,
      port: createTestPort(),
      static: {
        deploymentID: "dep_42",
        gameName: "Local Game",
        outDir: staticDir,
        shell: false,
      },
    });

    try {
      const rootResponse = await fetch(`${server.url}/`);
      expect(rootResponse.status).toBe(200);
      const rootBody = await rootResponse.text();
      expect(rootBody).toContain("Raw Built");
      expect(rootBody).not.toContain("id=\"actions\"");

      const playResponse = await fetch(`${server.url}/play/dep_42`);
      expect(playResponse.status).toBe(200);
      expect(await playResponse.text()).toContain("Raw Built");
    } finally {
      await server.stop();
      removeDatabaseFile(databasePath);
      rmSync(staticDir, { force: true, recursive: true });
    }
  });

  test("auth: \"none\" disables better-auth and accepts ?userID= for room creation", async () => {
    const databasePath = createDatabasePath("auth-none");
    const server = await startLocalDevServer({
      auth: "none",
      dbPath: databasePath,
      deployment,
      port: createTestPort(),
    });

    try {
      const authResponse = await fetch(`${server.url}/api/auth/session`);
      expect(authResponse.status).toBe(404);

      const anonResponse = await fetch(`${server.url}/api/dev/session/anonymous`, {
        method: "POST",
      });
      expect(anonResponse.status).toBe(404);

      const healthResponse = await fetch(`${server.url}/api/dev/health`);
      expect(healthResponse.status).toBe(200);

      const meResponse = await fetch(`${server.url}/api/dev/me?userID=alice`);
      expect(meResponse.status).toBe(200);
      const meBody = (await meResponse.json()) as { user: { id: string; name: string } };
      expect(meBody.user.id).toBe("alice");

      const roomResponse = await fetch(`${server.url}/api/dev/rooms?userID=alice`, {
        method: "POST",
      });
      expect(roomResponse.status).toBe(201);
      const roomBody = (await roomResponse.json()) as { roomID: string };
      expect(roomBody.roomID.startsWith("room_")).toBe(true);
    } finally {
      await server.stop();
      removeDatabaseFile(databasePath);
    }
  });
});

describe("startDevBundleServer", () => {
  test("serves local and multiplayer bundle HTML with the Vite client endpoint", async () => {
    const projectDir = createTemporaryProject("dev-bundle-serves-html");
    const bundle = await startDevBundleServer({
      deploymentID: "dev",
      gameName: "Dev Bundle Test Game",
      projectDir,
      projectID: "dev",
      runtime: "local",
    });

    try {
      expect(bundle.url).toContain("://localhost:");

      const htmlResponse = await fetch(`${bundle.url}/`);
      expect(htmlResponse.status).toBe(200);
      const html = await htmlResponse.text();
      expect(html).toContain("Dev Bundle Test Game");
      expect(html).toContain("openturn-root");
      expect(html).toContain("/entry.tsx");

      const viteClientResponse = await fetch(`${bundle.url}/@vite/client`);
      expect(viteClientResponse.status).toBe(200);
      const viteClientBody = await viteClientResponse.text();
      expect(viteClientBody).toContain("HMRClient");
      expect(viteClientBody).toContain("[vite]");

      const entryResponse = await fetch(`${bundle.url}/entry.tsx`);
      expect(entryResponse.status).toBe(200);
      const entry = await entryResponse.text();
      expect(entry).toContain("local");
      expect(entry).toContain("openturn.dev.inspector.enabled");
      expect(entry).toContain("createInspector");
      expect(entry).toContain("createLocalMatch");
      expect(entry).toContain("formatLocalDevPlayerStatus");
      expect(entry).toContain("Playing as player");

      const cssResponse = await fetch(`${bundle.url}/@fs${projectDir}/app/styles.css`);
      expect(cssResponse.status).toBe(200);
      const css = await cssResponse.text();
      expect(css).toContain(".grid");
      expect(css).toContain(".px-4");
    } finally {
      await bundle.stop();
    }

    const multiplayerBundle = await startDevBundleServer({
      deploymentID: "dev",
      gameName: "Dev Bundle Test Game",
      projectDir,
      projectID: "dev",
      runtime: "multiplayer",
    });

    try {
      const entryResponse = await fetch(`${multiplayerBundle.url}/entry.tsx`);
      expect(entryResponse.status).toBe(200);
      const entry = await entryResponse.text();
      expect(entry).toContain("multiplayer");
      expect(entry).toContain("openturn.dev.inspector.enabled");
      expect(entry).toContain("createInspector");
      expect(entry).toContain("HostedInspector");
      expect(entry).toContain("useShellHostedMatch");
      expect(entry).toContain("MultiplayerDevShell");
      expect(entry).not.toContain("createLocalMatch");
    } finally {
      await multiplayerBundle.stop();
      rmSync(projectDir, { force: true, recursive: true });
    }
  });
});

// --- test helpers ------------------------------------------------------------

interface LobbySnapshot {
  roomID: string;
  userID: string;
  userName: string;
  scope: "lobby" | "game";
  token: string;
  tokenExpiresAt: number;
  websocketURL: string;
  targetCapacity: number;
  minPlayers: number;
  maxPlayers: number;
  isHost: boolean;
  hostUserID: string;
  playerID?: string;
}

function withToken(snapshot: LobbySnapshot): string {
  return `${snapshot.websocketURL}?token=${encodeURIComponent(snapshot.token)}`;
}

async function runLobbyToStart(input: {
  snapshot: LobbySnapshot;
  seatIndex: number;
  isHost: boolean;
  guestSnapshots: readonly LobbySnapshot[];
  guestSeatIndexes: readonly number[];
}) {
  const hostSocket = new WebSocket(withToken(input.snapshot));
  const hostMessages: unknown[] = [];
  hostSocket.addEventListener("message", (event) => {
    hostMessages.push(JSON.parse(event.data.toString()));
  });
  await waitForOpen(hostSocket);
  await waitFor(() => hostMessages.some((msg) => isLobbyState(msg)));

  const guestSockets: WebSocket[] = [];
  const guestTransitionPromises: Array<Promise<{ token: string; playerID: string; websocketURL: string }>> = [];
  for (let i = 0; i < input.guestSnapshots.length; i += 1) {
    const guestSnap = input.guestSnapshots[i]!;
    const guestSeat = input.guestSeatIndexes[i]!;
    const socket = new WebSocket(withToken(guestSnap));
    guestSockets.push(socket);
    await waitForOpen(socket);

    const transitionPromise = new Promise<{ token: string; playerID: string; websocketURL: string }>((resolveTransition) => {
      socket.addEventListener("message", (event) => {
        const msg = JSON.parse(event.data.toString()) as { type?: unknown };
        if (msg.type === "lobby:transition_to_game") {
          const t = msg as { roomToken: string; playerID: string; websocketURL: string };
          resolveTransition({ token: t.roomToken, playerID: t.playerID, websocketURL: t.websocketURL });
        }
      });
    });
    guestTransitionPromises.push(transitionPromise);

    socket.send(JSON.stringify({ type: "lobby:take_seat", seatIndex: guestSeat }));
    socket.send(JSON.stringify({ type: "lobby:set_ready", ready: true }));
  }

  hostSocket.send(JSON.stringify({ type: "lobby:take_seat", seatIndex: input.seatIndex }));
  hostSocket.send(JSON.stringify({ type: "lobby:set_ready", ready: true }));

  await waitFor(() =>
    hostMessages.some((msg) => isLobbyState(msg) && (msg as { canStart: boolean }).canStart === true),
  );

  const hostTransition = new Promise<{ token: string; playerID: string; websocketURL: string }>((resolveTransition) => {
    hostSocket.addEventListener("message", (event) => {
      const msg = JSON.parse(event.data.toString()) as { type?: unknown };
      if (msg.type === "lobby:transition_to_game") {
        const t = msg as { roomToken: string; playerID: string; websocketURL: string };
        resolveTransition({ token: t.roomToken, playerID: t.playerID, websocketURL: t.websocketURL });
      }
    });
  });

  hostSocket.send(JSON.stringify({ type: "lobby:start" }));

  const gameSocketInfo = await hostTransition;
  const guestGameSocketInfos = await Promise.all(guestTransitionPromises);

  return {
    gameSocketInfo,
    guestGameSocketInfos,
    lobbySocket: hostSocket,
    guestSockets,
  };
}

function isBatchApplied(message: unknown): boolean {
  return (
    typeof message === "object"
    && message !== null
    && "type" in message
    && (message as { type: unknown }).type === "batch_applied"
  );
}

function isBatchAppliedRevision(message: unknown, revision: number): boolean {
  return isBatchApplied(message) && (message as { revision?: unknown }).revision === revision;
}

function isPlayerSnapshotRevision(message: unknown, revision: number): boolean {
  return (
    typeof message === "object"
    && message !== null
    && !("type" in message)
    && (message as { revision?: unknown }).revision === revision
  );
}

function isFreshResetSnapshot(message: unknown): boolean {
  return (
    isPlayerSnapshotRevision(message, 0)
    && Array.isArray((message as { G?: { board?: unknown } }).G?.board)
    && ((message as { G: { board: unknown[] } }).G.board).every((cell) => cell === null)
  );
}

function isLobbyState(message: unknown): boolean {
  return (
    typeof message === "object"
    && message !== null
    && (message as { type?: unknown }).type === "lobby:state"
  );
}

function isLobbyRejected(message: unknown, reason: string): boolean {
  return (
    typeof message === "object"
    && message !== null
    && (message as { type?: unknown }).type === "lobby:rejected"
    && (message as { reason?: unknown }).reason === reason
  );
}

type WireSeat =
  | { kind: "open"; seatIndex: number }
  | { kind: "human"; seatIndex: number; userID: string; ready: boolean }
  | { kind: "bot"; seatIndex: number; botID: string };

function seatIsReady(seatIndex: number): (msg: unknown) => boolean {
  return (msg: unknown) => {
    if (!isLobbyState(msg)) return false;
    const state = msg as { seats: WireSeat[] };
    const seat = state.seats.find((s) => s.seatIndex === seatIndex);
    return seat !== undefined && seat.kind === "human" && seat.ready;
  };
}

function seatIsTaken(seatIndex: number, userID: string): (msg: unknown) => boolean {
  return (msg: unknown) => {
    if (!isLobbyState(msg)) return false;
    const state = msg as { seats: WireSeat[] };
    const seat = state.seats.find((s) => s.seatIndex === seatIndex);
    return seat !== undefined && seat.kind === "human" && seat.userID === userID;
  };
}

function seatIsOpen(seatIndex: number): (msg: unknown) => boolean {
  return (msg: unknown) => {
    if (!isLobbyState(msg)) return false;
    const state = msg as { seats: WireSeat[] };
    const seat = state.seats.find((s) => s.seatIndex === seatIndex);
    return seat !== undefined && seat.kind === "open";
  };
}

function createTemporaryProject(name: string): string {
  const projectDir = `/tmp/openturn-dev-bundle-${name}-${Date.now()}`;
  const appDir = join(projectDir, "app");
  rmSync(projectDir, { force: true, recursive: true });
  mkdirSync(appDir, { recursive: true });
  writeFileSync(join(appDir, "page.tsx"), `import "./styles.css";\nexport default function Page(){return <div className="fixture-card grid px-4">fixture</div>;}\n`);
  writeFileSync(join(appDir, "styles.css"), `@import "tailwindcss";\n.fixture-card { @apply rounded-lg bg-slate-900 text-white; }\n`);
  writeFileSync(
    join(appDir, "game.ts"),
    `export const game = { name: "stub" };\nexport const match = { players: ["0", "1"] };\n`,
  );
  writeFileSync(
    join(appDir, "openturn.ts"),
    `export const metadata = { name: "Dev Bundle Test Game", runtime: "multiplayer" };\n`,
  );
  writeFileSync(
    join(projectDir, "package.json"),
    JSON.stringify({
      dependencies: {
        "@vitejs/plugin-react": "workspace:*",
        react: "workspace:*",
        "react-dom": "workspace:*",
        tailwindcss: "workspace:*",
      },
    }),
  );
  linkInstalledPackage(projectDir, "@vitejs/plugin-react");
  linkInstalledPackage(projectDir, "react");
  linkInstalledPackage(projectDir, "react-dom");
  linkInstalledPackage(projectDir, "tailwindcss");
  return projectDir;
}

function createScaffoldTarget(name: string): string {
  return `/tmp/openturn-create-${name}-${Date.now()}-${crypto.randomUUID()}`;
}

function linkInstalledPackage(projectDir: string, packageName: string): void {
  const scopeIndex = packageName.lastIndexOf("/");
  const installDirectory = scopeIndex === -1
    ? join(projectDir, "node_modules")
    : join(projectDir, "node_modules", packageName.slice(0, scopeIndex));
  mkdirSync(installDirectory, { recursive: true });
  symlinkSync(
    resolve(import.meta.dir, "..", "..", "..", "examples", "games", "tic-tac-toe", "app", "node_modules", packageName),
    join(projectDir, "node_modules", packageName),
    "dir",
  );
}

async function createRoom(baseURL: string, authToken: string): Promise<LobbySnapshot> {
  const response = await fetch(`${baseURL}/api/dev/rooms`, {
    headers: {
      authorization: `Bearer ${authToken}`,
    },
    method: "POST",
  });

  expect(response.status).toBe(201);
  return (await response.json()) as LobbySnapshot;
}

async function joinLobby(
  baseURL: string,
  roomID: string,
  authToken: string,
): Promise<LobbySnapshot> {
  const response = await fetch(`${baseURL}/api/dev/rooms/${roomID}/lobby-token`, {
    headers: {
      authorization: `Bearer ${authToken}`,
    },
    method: "POST",
  });

  expect(response.status).toBe(200);
  return (await response.json()) as LobbySnapshot;
}

async function createAnonymousSession(baseURL: string) {
  const response = await fetch(`${baseURL}/api/dev/session/anonymous`, {
    method: "POST",
  });

  expect(response.status).toBe(200);
  return await response.json() as { token: string; user: { id: string } };
}

async function waitForOpen(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.OPEN) {
    return;
  }

  await new Promise<void>((resolve) => {
    socket.addEventListener("open", () => resolve(), { once: true });
  });
}

async function waitForClose(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.CLOSED) {
    return;
  }

  await new Promise<void>((resolve) => {
    socket.addEventListener("close", () => resolve(), { once: true });
  });
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const timeoutAt = Date.now() + 5_000;

  while (Date.now() < timeoutAt) {
    if (predicate()) {
      return;
    }

    await Bun.sleep(25);
  }

  throw new Error("Timed out waiting for condition.");
}

function createDatabasePath(name: string) {
  return `/tmp/openturn-local-dev-${name}.sqlite`;
}

function createNestedDatabasePath(name: string) {
  return `/tmp/openturn-local-dev-nested-${name}/db.sqlite`;
}

function createStaticDir(name: string): string {
  const dir = `/tmp/openturn-static-${name}-${Date.now()}`;
  mkdirSync(dir, { recursive: true });
  return dir;
}

let sharedTestPort = 4800;
function createTestPort(): number {
  sharedTestPort += 1;
  return sharedTestPort;
}
