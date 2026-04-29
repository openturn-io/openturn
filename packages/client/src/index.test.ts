import { describe, expect, test } from "bun:test";

import type { ProtocolClientMessage, ProtocolServerMessage } from "@openturn/protocol";

import {
  createHostedClient,
  type HostedConnectionDescriptor,
  type HostedSocket,
  type HostedSocketEventMap,
  type HostedTransport,
} from "./index";

describe("@openturn/client", () => {
  test("connects, requests sync, and dispatches strict-core events over an injected transport", async () => {
    const sentMessages: ProtocolClientMessage[] = [];
    const socket = new MockSocket((payload) => {
      sentMessages.push(JSON.parse(payload) as ProtocolClientMessage);
    });
    const connection: HostedConnectionDescriptor = {
      getRoomToken: async () => "token_123",
      playerID: "0",
      roomID: "room_123",
    };
    const client = createHostedClient({
      ...connection,
      transport: createMockTransport(socket),
    });

    await client.connect();
    socket.emit("open", {});

    void client.dispatchEvent("placeMark", { row: 0, col: 1 });

    expect(sentMessages[0]).toEqual({
      type: "sync",
      matchID: "room_123",
      playerID: "0",
    });
    expect(sentMessages[1]).toMatchObject({
      type: "action",
      event: "placeMark",
      matchID: "room_123",
      payload: {
        col: 1,
        row: 0,
      },
      playerID: "0",
    });
  });

  test("updates hosted state from snapshots and applied batches", async () => {
    const socket = new MockSocket(() => {});
    const client = createHostedClient({
      getRoomToken: async () => "token_123",
      playerID: "0",
      roomID: "room_123",
      transport: createMockTransport(socket),
    });

    await client.connect();
    socket.emit("open", {});
    socket.emit("message", {
      data: JSON.stringify({
        derived: {
          activePlayers: ["0"],
          control: null,
          controlMeta: {
            deadline: null,
            label: "Play",
            metadata: [],
            pendingTargets: ["play"],
          },
          selectors: {},
        },
        G: {
          board: [null, null, null],
        },
        log: [],
        position: {
          node: "play",
          path: ["play"],
          turn: 1,
        },
        matchID: "room_123",
        result: null,
        revision: 1,
      } satisfies ProtocolServerMessage),
    });

    expect(client.getState().snapshot?.revision).toBe(1);

    socket.emit("message", {
      data: JSON.stringify({
        type: "batch_applied",
        matchID: "room_123",
        revision: 2,
        ackClientActionID: "client_1",
        branch: {
          branchID: "main",
          createdAtActionID: null,
          createdAtRevision: 0,
          headActionID: "a_1",
          parentBranchID: null,
        },
        snapshot: {
          derived: {
            activePlayers: ["1"],
            control: null,
            controlMeta: {
              deadline: null,
              label: "Play",
              metadata: [],
              pendingTargets: ["play"],
            },
            selectors: {},
          },
          G: {
            board: ["X", null, null],
          },
          log: [
            {
              actionID: "a_1",
              at: 0,
              event: "placeMark",
              payload: {
                col: 0,
                row: 0,
              },
              playerID: "0",
              turn: 1,
              type: "event",
            },
          ],
          position: {
            node: "play",
            path: ["play"],
            turn: 2,
          },
          matchID: "room_123",
          playerID: "0",
          result: null,
          revision: 2,
        },
        steps: [
          {
            event: {
              actionID: "a_1",
              at: 0,
              event: "placeMark",
              payload: {
                col: 0,
                row: 0,
              },
              playerID: "0",
              turn: 1,
              type: "event",
            },
            kind: "action",
            snapshot: {
              derived: {
                activePlayers: ["1"],
                control: null,
                controlMeta: {
                  deadline: null,
                  label: "Play",
                  metadata: [],
                  pendingTargets: ["play"],
                },
                selectors: {},
              },
              G: {
                board: ["X", null, null],
              },
              log: [],
              position: {
                node: "play",
                path: ["play"],
                turn: 2,
              },
              matchID: "room_123",
              playerID: "0",
              result: null,
              revision: 2,
            },
            transition: {
              enqueued: [],
              evaluations: [],
              event: "placeMark",
              from: "play",
              fromPath: ["play"],
              matchedFrom: "play",
              matchedFromPath: ["play"],
              resolver: null,
              rng: null,
              to: "play",
              toPath: ["play"],
              turn: "preserve",
            },
          },
        ],
      } satisfies ProtocolServerMessage),
    });

    expect(client.getState().status).toBe("connected");
    expect(client.getState().snapshot?.revision).toBe(2);
    expect(client.getState().lastBatch?.steps[0]?.kind).toBe("action");
    expect(client.getState().lastBatch?.steps[0]?.event.actionID).toBe("a_1");
  });

  test("ignores out-of-band hosted server messages", async () => {
    const socket = new MockSocket(() => {});
    const client = createHostedClient({
      getRoomToken: async () => "token_123",
      playerID: "0",
      roomID: "room_123",
      transport: createMockTransport(socket),
    });

    await client.connect();
    socket.emit("open", {});
    socket.emit("message", {
      data: JSON.stringify({
        type: "openturn:presence",
        event: "joined",
        playerID: "1",
        connectedPlayers: ["0", "1"],
      }),
    });

    expect(client.getState().status).toBe("connected");
    expect(client.getState().error).toBeNull();
    expect(client.getState().snapshot).toBeNull();
  });

  test("tracks rejected actions as errors without dropping the last snapshot", async () => {
    const socket = new MockSocket(() => {});
    const client = createHostedClient({
      getRoomToken: async () => "token_123",
      playerID: "0",
      roomID: "room_123",
      transport: createMockTransport(socket),
    });

    await client.connect();
    socket.emit("open", {});
    socket.emit("message", {
      data: JSON.stringify({
        derived: {
          activePlayers: ["0"],
          control: null,
          controlMeta: {
            deadline: null,
            label: "Play",
            metadata: [],
            pendingTargets: ["play"],
          },
          selectors: {},
        },
        G: {
          board: [null, null, null],
        },
        log: [],
        position: {
          node: "play",
          path: ["play"],
          turn: 1,
        },
        matchID: "room_123",
        result: null,
        revision: 1,
      } satisfies ProtocolServerMessage),
    });
    socket.emit("message", {
      data: JSON.stringify({
        type: "action_rejected",
        clientActionID: "client_1",
        error: "stale_revision",
        matchID: "room_123",
        revision: 1,
      } satisfies ProtocolServerMessage),
    });

    expect(client.getState().error).toBe("stale_revision");
    expect(client.getState().snapshot?.revision).toBe(1);
  });

  test("surfaces token bootstrap failures as hosted client errors", async () => {
    const client = createHostedClient({
      getRoomToken: async () => {
        throw new Error("unauthorized");
      },
      playerID: "0",
      roomID: "room_123",
      transport: createMockTransport(new MockSocket(() => {})),
    });

    await client.connect();

    expect(client.getState()).toMatchObject({
      error: "unauthorized",
      status: "error",
    });
  });

  test("dispatchEvent resolves with ok:true when the server acks the action", async () => {
    const socket = new MockSocket(() => {});
    const client = createHostedClient({
      getRoomToken: async () => "token_123",
      playerID: "0",
      roomID: "room_123",
      transport: createMockTransport(socket),
    });

    await client.connect();
    socket.emit("open", {});

    const dispatchPromise = client.dispatchEvent("placeMark", { row: 0, col: 1 });

    socket.emit("message", {
      data: JSON.stringify({
        type: "batch_applied",
        matchID: "room_123",
        revision: 1,
        ackClientActionID: "client_1",
        snapshot: {
          derived: {
            activePlayers: ["1"],
            control: null,
            controlMeta: {
              deadline: null,
              label: "Play",
              metadata: [],
              pendingTargets: ["play"],
            },
            selectors: {},
          },
          G: {
            board: ["X", null, null],
          },
          log: [],
          position: {
            node: "play",
            path: ["play"],
            turn: 2,
          },
          matchID: "room_123",
          playerID: "0",
          result: null,
          revision: 1,
        },
        steps: [],
      } satisfies ProtocolServerMessage),
    });

    const outcome = await dispatchPromise;
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.clientActionID).toBe("client_1");
    expect(outcome.batch.revision).toBe(1);
    expect(client.getState().lastAcknowledgedActionID).toBe("client_1");
  });

  test("dispatchEvent resolves with ok:false when the server rejects the action", async () => {
    const socket = new MockSocket(() => {});
    const client = createHostedClient({
      getRoomToken: async () => "token_123",
      playerID: "0",
      roomID: "room_123",
      transport: createMockTransport(socket),
    });

    await client.connect();
    socket.emit("open", {});

    const dispatchPromise = client.dispatchEvent("placeMark", { row: 0, col: 1 });

    socket.emit("message", {
      data: JSON.stringify({
        type: "action_rejected",
        clientActionID: "client_1",
        details: {
          col: 1,
          row: 0,
        },
        error: "invalid_event",
        event: "placeMark",
        matchID: "room_123",
        reason: "occupied",
        revision: 2,
      }),
    });

    const outcome = await dispatchPromise;
    expect(outcome).toEqual({
      ok: false,
      clientActionID: "client_1",
      details: { col: 1, row: 0 },
      error: "invalid_event",
      event: "placeMark",
      reason: "occupied",
      revision: 2,
    });
    expect(client.getState().error).toBe("invalid_event");
  });

  test("dispatchEvent resolves with ok:false when the connection drops", async () => {
    const socket = new MockSocket(() => {});
    const client = createHostedClient({
      getRoomToken: async () => "token_123",
      playerID: "0",
      roomID: "room_123",
      transport: createMockTransport(socket),
    });

    await client.connect();
    socket.emit("open", {});

    const dispatchPromise = client.dispatchEvent("placeMark", { row: 0, col: 1 });
    socket.emit("close", { reason: "server_gone" });

    const outcome = await dispatchPromise;
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error).toBe("disconnected");
    expect(outcome.reason).toBe("server_gone");
  });

  test("retainBatchHistory accumulates batches and the initial snapshot", async () => {
    const socket = new MockSocket(() => {});
    const client = createHostedClient({
      getRoomToken: async () => "token_123",
      playerID: "0",
      retainBatchHistory: true,
      roomID: "room_123",
      transport: createMockTransport(socket),
    });

    await client.connect();
    socket.emit("open", {});

    const initialMessage = {
      derived: {
        activePlayers: ["0"],
        control: null,
        controlMeta: {
          deadline: null,
          label: "Play",
          metadata: [],
          pendingTargets: ["play"],
        },
        selectors: {},
      },
      G: { board: [null, null, null] },
      log: [],
      position: { node: "play", path: ["play"], turn: 1 },
      matchID: "room_123",
      playerID: "0",
      result: null,
      revision: 0,
    } satisfies ProtocolServerMessage;

    socket.emit("message", { data: JSON.stringify(initialMessage) });

    expect(client.getBatchHistory()).toHaveLength(0);
    expect(client.getInitialSnapshot()?.revision).toBe(0);

    const batchMessage = {
      type: "batch_applied",
      matchID: "room_123",
      revision: 1,
      ackClientActionID: "client_1",
      branch: {
        branchID: "main",
        createdAtActionID: null,
        createdAtRevision: 0,
        headActionID: "a_1",
        parentBranchID: null,
      },
      snapshot: {
        derived: {
          activePlayers: ["1"],
          control: null,
          controlMeta: { deadline: null, label: "Play", metadata: [], pendingTargets: ["play"] },
          selectors: {},
        },
        G: { board: ["X", null, null] },
        log: [],
        position: { node: "play", path: ["play"], turn: 2 },
        matchID: "room_123",
        playerID: "0",
        result: null,
        revision: 1,
      },
      steps: [
        {
          event: {
            actionID: "a_1",
            at: 0,
            event: "placeMark",
            payload: { col: 0, row: 0 },
            playerID: "0",
            turn: 1,
            type: "event",
          },
          kind: "action",
          snapshot: {
            derived: {
              activePlayers: ["1"],
              control: null,
              controlMeta: { deadline: null, label: "Play", metadata: [], pendingTargets: ["play"] },
              selectors: {},
            },
            G: { board: ["X", null, null] },
            log: [],
            position: { node: "play", path: ["play"], turn: 2 },
            matchID: "room_123",
            playerID: "0",
            result: null,
            revision: 1,
          },
          transition: {
            enqueued: [],
            evaluations: [],
            event: "placeMark",
            from: "play",
            fromPath: ["play"],
            matchedFrom: "play",
            matchedFromPath: ["play"],
            resolver: null,
            rng: null,
            to: "play",
            toPath: ["play"],
            turn: "preserve",
          },
        },
      ],
    } satisfies ProtocolServerMessage;

    socket.emit("message", { data: JSON.stringify(batchMessage) });
    socket.emit("message", { data: JSON.stringify(batchMessage) });

    expect(client.getBatchHistory()).toHaveLength(1);
    expect(client.getBatchHistory()[0]?.revision).toBe(1);
    expect(client.getInitialSnapshot()?.revision).toBe(0);
  });

  test("omitting retainBatchHistory keeps the accumulator empty", async () => {
    const socket = new MockSocket(() => {});
    const client = createHostedClient({
      getRoomToken: async () => "token_123",
      playerID: "0",
      roomID: "room_123",
      transport: createMockTransport(socket),
    });

    await client.connect();
    socket.emit("open", {});
    socket.emit("message", {
      data: JSON.stringify({
        derived: {
          activePlayers: ["0"],
          control: null,
          controlMeta: { deadline: null, label: "Play", metadata: [], pendingTargets: ["play"] },
          selectors: {},
        },
        G: { board: [null, null, null] },
        log: [],
        position: { node: "play", path: ["play"], turn: 1 },
        matchID: "room_123",
        playerID: "0",
        result: null,
        revision: 0,
      } satisfies ProtocolServerMessage),
    });

    expect(client.getBatchHistory()).toHaveLength(0);
    expect(client.getInitialSnapshot()).toBeNull();
  });

  test("disconnect cancels an in-flight connect before it opens a socket", async () => {
    let resolveToken: ((token: string) => void) | null = null;
    let createdSockets = 0;
    const tokenPromise = new Promise<string>((resolve) => {
      resolveToken = resolve;
    });
    const client = createHostedClient({
      getRoomToken: () => tokenPromise,
      playerID: "0",
      roomID: "room_123",
      transport: {
        createSocket() {
          createdSockets += 1;
          return new MockSocket(() => {});
        },
      },
    });

    const connectPromise = client.connect();
    client.disconnect();
    resolveToken?.("token_123");
    await connectPromise;

    expect(createdSockets).toBe(0);
    expect(client.getState().status).toBe("disconnected");
  });
});

function createMockTransport(socket: MockSocket): HostedTransport {
  return {
    createSocket() {
      return socket;
    },
  };
}

class MockSocket implements HostedSocket {
  readyState = 1;

  private readonly listeners = new Map<keyof HostedSocketEventMap, Set<(event: any) => void>>();

  constructor(private readonly onSend: (payload: string) => void) {}

  addEventListener<TType extends keyof HostedSocketEventMap>(
    type: TType,
    listener: (event: HostedSocketEventMap[TType]) => void,
  ): void {
    const nextListeners = this.listeners.get(type) ?? new Set();
    nextListeners.add(listener as (event: any) => void);
    this.listeners.set(type, nextListeners);
  }

  close(): void {
    this.readyState = 3;
  }

  emit<TType extends keyof HostedSocketEventMap>(
    type: TType,
    event: HostedSocketEventMap[TType],
  ) {
    const listeners = this.listeners.get(type);

    if (listeners === undefined) {
      return;
    }

    for (const listener of listeners) {
      listener(event);
    }
  }

  removeEventListener<TType extends keyof HostedSocketEventMap>(
    type: TType,
    listener: (event: HostedSocketEventMap[TType]) => void,
  ): void {
    this.listeners.get(type)?.delete(listener as (event: any) => void);
  }

  send(data: string): void {
    this.onSend(data);
  }
}
