// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useEffect, useRef, useState } from "react";
import { afterEach, describe, expect, test } from "vitest";

import { defineGame } from "@openturn/core";
import type { HostedMatchState } from "@openturn/react";

import { createOpenturnBindings } from "@openturn/react";

import { createInspector } from "./index";
import { useInspector } from "./inspector-context";

if (typeof window !== "undefined" && typeof window.ResizeObserver === "undefined") {
  class ResizeObserverStub {
    disconnect() {}
    observe() {}
    unobserve() {}
  }

  window.ResizeObserver = ResizeObserverStub as typeof window.ResizeObserver;
}

if (typeof globalThis !== "undefined" && typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = window.ResizeObserver;
}

const MATCH = { players: ["0", "1"] as const };

const hostedGame = defineGame({
  playerIDs: MATCH.players,
  events: {
    ping: {},
  },
  initial: "play",
  setup: () => ({ total: 0 }),
  states: {
    play: {
      activePlayers: ({ match, position }) => [match.players[(position.turn - 1) % match.players.length]!],
      label: "Play",
    },
  },
  transitions: [
    {
      event: "ping",
      from: "play",
      resolve: ({ G }) => ({ G: { total: G.total + 1 }, turn: "increment" }),
      to: "play",
    },
  ],
});

function createIdleHostedState(): HostedMatchState<typeof hostedGame> {
  return {
    activePlayers: [],
    batchHistory: [],
    canAct: () => false,
    canDispatch: { ping: false } as HostedMatchState<typeof hostedGame>["canDispatch"],
    disconnect() {},
    dispatch: {
      ping: () => ({ ok: false, error: "idle" }),
    } as unknown as HostedMatchState<typeof hostedGame>["dispatch"],
    error: null,
    initialSnapshot: null,
    isActivePlayer: false,
    isFinished: false,
    lastAcknowledgedActionID: null,
    lastBatch: null,
    playerID: null,
    async reconnect() {},
    requestResync() {},
    requestSync() {},
    result: null,
    roomID: null,
    self: null,
    snapshot: null,
    status: "idle",
  };
}

afterEach(() => {
  cleanup();
});

describe("createInspector().HostedInspector", () => {
  test("renders children when the hosted state has no initial snapshot", () => {
    const { HostedInspector } = createInspector(createOpenturnBindings(hostedGame, { runtime: "multiplayer" }));
    const hostedState = createIdleHostedState();

    render(
      <HostedInspector active hostedState={hostedState} >
        <div data-testid="page">hello</div>
      </HostedInspector>,
    );

    expect(screen.getByTestId("page").textContent).toBe("hello");
  });

  test("children survive live <-> replay mode transitions without remounting", () => {
    const { HostedInspector } = createInspector(createOpenturnBindings(hostedGame, { runtime: "multiplayer" }));

    const initialSnapshot = {
      derived: { activePlayers: ["0"], control: null, controlMeta: { deadline: null, label: "Play", metadata: [], pendingTargets: ["play"] }, selectors: {} },
      G: { total: 0 },
      log: [],
      matchID: "room",
      playerID: "0",
      position: { node: "play", path: ["play"], turn: 1 },
      result: null,
      revision: 0,
    } as unknown as NonNullable<HostedMatchState<typeof hostedGame>["initialSnapshot"]>;

    const batchStep = {
      kind: "action" as const,
      event: {
        actionID: "a1",
        event: "ping",
        payload: null,
        type: "event" as const,
        playerID: "0",
      },
      snapshot: {
        ...initialSnapshot,
        G: { total: 1 },
        position: { ...initialSnapshot.position, turn: 2 },
        revision: 1,
      },
      transition: {
        from: "play",
        to: "play",
        resolver: "ping",
        evaluations: [],
        rng: null,
      },
    };

    const batchHistory = [
      {
        revision: 1,
        ackClientActionID: "a1",
        steps: [batchStep],
      } as unknown as HostedMatchState<typeof hostedGame>["batchHistory"][number],
    ];

    const hostedState: HostedMatchState<typeof hostedGame> = {
      ...createIdleHostedState(),
      status: "connected",
      initialSnapshot,
      batchHistory,
      snapshot: batchStep.snapshot as unknown as HostedMatchState<typeof hostedGame>["snapshot"],
      playerID: "0",
      roomID: "room",
      activePlayers: ["0"],
      isActivePlayer: true,
    };

    const mountEvents: string[] = [];
    function MountProbe() {
      const id = useRef(`probe-${Math.random().toString(36).slice(2)}`);
      useEffect(() => {
        mountEvents.push(`mount:${id.current}`);
        return () => {
          mountEvents.push(`unmount:${id.current}`);
        };
      }, []);
      return <div data-testid="probe">probe</div>;
    }

    let triggerSelectRevision: (() => void) | null = null;
    let triggerReturnToLive: (() => void) | null = null;
    function InspectorDriver() {
      const { dispatch } = useInspector();
      triggerSelectRevision = () => dispatch({ type: "SELECT_REVISION", revision: 1 });
      triggerReturnToLive = () => dispatch({ type: "RETURN_TO_LIVE" });
      return null;
    }

    render(
      <HostedInspector active hostedState={hostedState} >
        <MountProbe />
        <InspectorDriver />
      </HostedInspector>,
    );

    expect(mountEvents.filter((e) => e.startsWith("mount:")).length).toBe(1);

    act(() => {
      triggerSelectRevision?.();
    });
    act(() => {
      triggerReturnToLive?.();
    });
    act(() => {
      triggerSelectRevision?.();
    });

    expect(mountEvents.filter((e) => e.startsWith("mount:")).length).toBe(1);
    expect(mountEvents.filter((e) => e.startsWith("unmount:")).length).toBe(0);
  });

  test("mounts the inspector shell once an initial snapshot is present", () => {
    const { HostedInspector } = createInspector(createOpenturnBindings(hostedGame, { runtime: "multiplayer" }));
    const hostedState: HostedMatchState<typeof hostedGame> = {
      ...createIdleHostedState(),
      status: "connected",
      initialSnapshot: {
        derived: { activePlayers: ["0"], control: null, controlMeta: { deadline: null, label: "Play", metadata: [], pendingTargets: ["play"] }, selectors: {} },
        G: { total: 0 },
        log: [],
        matchID: "room",
        playerID: "0",
        position: { node: "play", path: ["play"], turn: 1 },
        result: null,
        revision: 0,
      } as unknown as HostedMatchState<typeof hostedGame>["initialSnapshot"],
      batchHistory: [],
    };

    const { container } = render(
      <HostedInspector active hostedState={hostedState} >
        <div data-testid="page">surface</div>
      </HostedInspector>,
    );

    expect(screen.getByTestId("page").textContent).toBe("surface");
    expect(container.querySelector(".ot-inspector-dock-slot")).not.toBeNull();
  });
});
