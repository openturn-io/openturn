import { describe, expect, test } from "bun:test";

import { parseProtocolClientMessageText, parseProtocolServerMessageText, protocolizeGameGraph, protocolizeGameSnapshot } from "./index";
import type {
  ActionRejected,
  BatchApplied,
  ClientAction,
  MatchSnapshot,
  PlayerViewSnapshot,
  ProtocolActionRecord,
  ProtocolClientMessage,
  ProtocolErrorCode,
  ProtocolFlowState,
  ProtocolServerMessage,
  ProtocolValue,
  ResyncRequest,
  SyncRequest,
} from "./index";

describe("@openturn/protocol", () => {
  test("supports typed action envelopes with serializable args", () => {
    const action = {
      type: "action",
      matchID: "match_123",
      playerID: "0",
      moveName: "placeMark",
      args: [{ row: 1, col: 2 }, ["audit", 7]],
      clientActionID: "client_123",
      baseRevision: 4,
    } satisfies ClientAction<
      "placeMark",
      readonly [{ readonly row: number; readonly col: number }, readonly [string, number]]
    >;

    expect(action.type).toBe("action");
    expect(action.baseRevision).toBe(4);
  });

  test("represents snapshots with active players and windows", () => {
    const flow: ProtocolFlowState = {
      players: ["0", "1"],
      activePlayers: ["0", "1"],
      phase: "planning",
      turn: 3,
      window: {
        kind: "planning",
        opensAt: 1_000,
        closesAt: 31_000,
        requiredPlayers: ["0", "1"],
        actedPlayers: ["0"],
      },
    };

    const canonical = {
      matchID: "match_123",
      revision: 8,
      flow,
      G: {
        board: [
          ["X", null, null],
          [null, "O", null],
          [null, null, null],
        ],
      },
      result: null,
      log: [
        {
          actionID: "a_1",
          type: "move",
          at: 1_500,
          playerID: "0",
          moveName: "placeMark",
          args: [{ row: 0, col: 0 }],
          phase: "planning",
          turn: 3,
        },
      ],
    } satisfies MatchSnapshot;

    const playerView = {
      ...canonical,
      playerID: "1",
      G: {
        myHand: ["gold", "silver"],
        opponentHandCount: 2,
      },
    } satisfies PlayerViewSnapshot;

    expect(canonical.flow.activePlayers).toEqual(["0", "1"]);
    expect(playerView.playerID).toBe("1");
  });

  test("supports stable game-readable server batch results", () => {
    const applied = {
      type: "batch_applied",
      matchID: "match_123",
      revision: 10,
      ackClientActionID: "client_123",
      branch: {
        branchID: "main",
        createdAtActionID: null,
        createdAtRevision: 0,
        headActionID: "a_9",
        parentBranchID: null,
      },
      snapshot: {
        matchID: "match_123",
        revision: 10,
        flow: {
          players: ["0", "1"],
          activePlayers: ["1"],
          phase: "review",
          turn: 2,
          window: null,
        },
        G: {
          board: [
            ["X", null, null],
            [null, null, null],
            [null, null, null],
          ],
        },
        result: null,
        log: [
          {
            actionID: "a_9",
            type: "timeout",
            at: 30_000,
            phase: "planning",
            turn: 1,
            windowKind: "planning",
          },
        ],
      },
      steps: [
        {
          kind: "action",
          action: {
            actionID: "a_9",
            type: "timeout",
            at: 30_000,
            phase: "planning",
            turn: 1,
            windowKind: "planning",
          },
          effects: [
            {
              audience: "all",
              causedByActionID: "a_9",
              effectID: "a_9:e_1",
              kind: "turn",
              name: "turn.started",
              payload: {
                turn: 2,
              },
              queue: "default",
              sequence: 0,
            },
          ],
          snapshot: {
            matchID: "match_123",
            revision: 9,
            flow: {
              players: ["0", "1"],
              activePlayers: ["1"],
              phase: "review",
              turn: 2,
              window: null,
            },
            G: {
              board: [
                ["X", null, null],
                [null, null, null],
                [null, null, null],
              ],
            },
            result: null,
            log: [
              {
                actionID: "a_9",
                type: "timeout",
                at: 30_000,
                phase: "planning",
                turn: 1,
                windowKind: "planning",
              },
            ],
          },
        },
        {
          kind: "trigger",
          effects: [
            {
              audience: "all",
              causedByActionID: "a_9",
              effectID: "a_9:e_2",
              kind: "turn",
              name: "turn.triggered",
              payload: {
                turn: 2,
              },
              queue: "default",
              sequence: 1,
            },
          ],
          listenerID: "turn_started_listener",
          trigger: {
            causedByActionID: "a_9",
            iteration: 0,
            kind: "turn_started",
            payload: {
              turn: 2,
            },
            sequence: 0,
            triggerID: "a_9:t_1",
          },
          snapshot: {
            matchID: "match_123",
            revision: 10,
            flow: {
              players: ["0", "1"],
              activePlayers: ["1"],
              phase: "review",
              turn: 2,
              window: null,
            },
            G: {
              board: [
                ["X", null, null],
                [null, null, null],
                [null, null, null],
              ],
            },
            result: null,
            log: [
              {
                actionID: "a_9",
                type: "timeout",
                at: 30_000,
                phase: "planning",
                turn: 1,
                windowKind: "planning",
              },
            ],
          },
          trace: {
            canceled: false,
            depth: 1,
            directive: {
              type: "continue",
            },
            parentStepID: "a_9",
            payloadAfter: {
              turn: 2,
            },
            payloadBefore: {
              turn: 2,
            },
            retriggerCount: 0,
            stage: "react",
            stepID: "a_9:t_1:listener:turn_started_listener",
          },
        },
        {
          kind: "resolution",
          effects: [
            {
              audience: "all",
              causedByActionID: "a_9",
              effectID: "a_9:e_3",
              kind: "turn",
              name: "turn.resolved",
              payload: {
                turn: 2,
              },
              queue: "default",
              sequence: 2,
            },
          ],
          resolution: {
            causedByActionID: "a_9",
            kind: "resolveTurn",
            payload: {
              turn: 2,
            },
            resolutionID: "a_9:r_1",
            sequence: 0,
          },
          snapshot: {
            matchID: "match_123",
            revision: 10,
            flow: {
              players: ["0", "1"],
              activePlayers: ["1"],
              phase: "review",
              turn: 2,
              window: null,
            },
            G: {
              board: [
                ["X", null, null],
                [null, null, null],
                [null, null, null],
              ],
            },
            result: null,
            log: [
              {
                actionID: "a_9",
                type: "timeout",
                at: 30_000,
                phase: "planning",
                turn: 1,
                windowKind: "planning",
              },
            ],
          },
          trace: {
            depth: 2,
            parentStepID: "a_9:t_1:listener:turn_started_listener",
            stepID: "a_9:r_1",
            transactions: [],
          },
        },
      ],
    } satisfies BatchApplied;

    const rejected = {
      type: "action_rejected",
      matchID: "match_123",
      clientActionID: "client_124",
      detail: {
        code: "invalid_move",
        message: "Move rejected.",
      },
      error: "invalid_move",
      revision: 9,
    } satisfies ActionRejected;

    expect(applied.type).toBe("batch_applied");
    expect(rejected.error).toBe("invalid_move");
  });

  test("protocolizes game graph hierarchy metadata", () => {
    expect(protocolizeGameGraph({
      edges: [
        {
          event: "cancel",
          from: "interaction",
          resolver: null,
          to: "idle",
          turn: "preserve",
        },
      ],
      initial: "confirming",
      nodes: [
        {
          id: "root",
          kind: "compound",
          parent: null,
          path: ["root"],
        },
        {
          id: "interaction",
          kind: "compound",
          parent: "root",
          path: ["root", "interaction"],
        },
        {
          id: "confirming",
          kind: "leaf",
          parent: "interaction",
          path: ["root", "interaction", "confirming"],
        },
      ],
    })).toEqual({
      edges: [
        {
          event: "cancel",
          from: "interaction",
          resolver: null,
          to: "idle",
          turn: "preserve",
        },
      ],
      initial: "confirming",
      nodes: [
        {
          id: "root",
          kind: "compound",
          parent: null,
          path: ["root"],
        },
        {
          id: "interaction",
          kind: "compound",
          parent: "root",
          path: ["root", "interaction"],
        },
        {
          id: "confirming",
          kind: "leaf",
          parent: "interaction",
          path: ["root", "interaction", "confirming"],
        },
      ],
    });
  });

  test("protocolizes game derived control metadata", () => {
    expect(protocolizeGameSnapshot({
      G: {
        board: [["X"]],
      },
      position: {
        name: "play",
        path: ["play"],
        turn: 2,
      },
      derived: {
        activePlayers: ["1"],
        control: {
          status: "playing",
        },
        controlMeta: {
          deadline: 30,
          label: "Player 1 to play",
          metadata: [
            {
              key: "currentPlayer",
              value: "1",
            },
          ],
          pendingTargets: ["won", "drawn", "play"],
        },
        selectors: {
          winnerMark: null,
        },
      },
      meta: {
        log: [],
        match: {
          players: ["0", "1"],
        },
        now: 0,
        result: null,
        rng: {
          draws: 0,
          seed: "default",
          state: 1,
        },
        seed: "default",
      },
    }, {
      matchID: "match_machine",
      revision: 3,
    })).toEqual({
      derived: {
        activePlayers: ["1"],
        control: {
          status: "playing",
        },
        controlMeta: {
          deadline: 30,
          label: "Player 1 to play",
          metadata: [
            {
              key: "currentPlayer",
              value: "1",
            },
          ],
          pendingTargets: ["won", "drawn", "play"],
        },
        selectors: {
          winnerMark: null,
        },
      },
      G: {
        board: [["X"]],
      },
      log: [],
      position: {
        node: "play",
        path: ["play"],
        turn: 2,
      },
      matchID: "match_machine",
      result: null,
      revision: 3,
    });
  });

  test("exposes transport-neutral client and server unions", () => {
    const sync = {
      type: "sync",
      matchID: "match_123",
      playerID: "0",
    } satisfies SyncRequest;

    const resync = {
      type: "resync",
      matchID: "match_123",
      playerID: "0",
      sinceRevision: 7,
    } satisfies ResyncRequest;

    const clientMessages: readonly ProtocolClientMessage[] = [sync, resync];
    const serverMessages: readonly ProtocolServerMessage[] = [
      {
        type: "action_rejected",
        matchID: "match_123",
        clientActionID: "client_123",
        error: "stale_revision",
      },
    ];

    expect(clientMessages).toHaveLength(2);
    expect(serverMessages).toHaveLength(1);
  });

  test("keeps protocol values and logs serialization-safe", () => {
    const value: ProtocolValue = {
      nested: [1, "two", false, null, { ok: "yes" }],
    };
    const codes: readonly ProtocolErrorCode[] = [
      "inactive_player",
      "invalid_resolution",
      "invalid_trigger",
      "invalid_time",
      "invalid_transition",
      "unknown_move",
      "unknown_player",
    ];
    const log: readonly ProtocolActionRecord[] = [
      {
        actionID: "a_1",
        type: "move",
        at: 100,
        playerID: "0",
        moveName: "record",
        args: [{ nested: ["ok"] }],
        phase: null,
        turn: 1,
      },
    ];

    expect(value).toEqual({
      nested: [1, "two", false, null, { ok: "yes" }],
    });
    expect(codes).toContain("unknown_move");
    expect(codes).toContain("inactive_player");
    expect(log).toHaveLength(1);
  });

  test("parses protocol messages from raw json text", () => {
    expect(parseProtocolClientMessageText(JSON.stringify({
      type: "sync",
      matchID: "match_123",
      playerID: "0",
    }))).toEqual({
      type: "sync",
      matchID: "match_123",
      playerID: "0",
    });

    expect(parseProtocolServerMessageText(JSON.stringify({
      type: "action_rejected",
      clientActionID: "client_1",
      error: "stale_revision",
      matchID: "match_123",
      revision: 1,
    }))).toEqual({
      type: "action_rejected",
      clientActionID: "client_1",
      error: "stale_revision",
      matchID: "match_123",
      revision: 1,
    });
  });

  test("preserves player ids when parsing player-view snapshots", () => {
    expect(parseProtocolServerMessageText(JSON.stringify({
      derived: {
        activePlayers: ["0"],
        control: null,
        controlMeta: {
          deadline: null,
          label: null,
          metadata: [],
          pendingTargets: [],
        },
        selectors: {},
      },
      G: {
        board: [null, null, null],
      },
      log: [],
      matchID: "match_123",
      playerID: "0",
      position: {
        node: "play",
        path: ["play"],
        turn: 1,
      },
      result: null,
      revision: 1,
    }))).toMatchObject({
      matchID: "match_123",
      playerID: "0",
    });
  });
});
