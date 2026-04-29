// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { defineGame } from "@openturn/core";
import { createOpenturnBindings } from "@openturn/react";
import { createSavedReplayEnvelope } from "@openturn/replay";

import { createInspector } from "./index";
import { resolveReplayGame } from "./replay-registry";

const MATCH = {
  players: ["0", "1"] as const,
};

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

const replayGame = defineGame({
  playerIDs: MATCH.players,
  events: {
    claim: {
      index: 0,
    },
  },
  initial: "play",
  setup: () => ({
    cells: [null, null] as Array<"A" | "B" | null>,
    hands: {
      "0": ["sun", "moon"],
      "1": ["storm", "mist"],
    },
  }),
  states: {
    play: {
      activePlayers: ({ match, position }) => [match.players[(position.turn - 1) % match.players.length]!],
      label: "Play",
    },
  },
  transitions: [
    {
      event: "claim",
      from: "play",
      resolve: ({ G, event, playerID }) => {
        if (G.cells[event.payload.index] !== null) {
          return null;
        }

        return {
          G: {
            ...G,
            cells: G.cells.map((cell, index) => index === event.payload.index ? (playerID === "0" ? "A" : "B") : cell),
            hands: {
              ...G.hands,
              [playerID]: G.hands[playerID].slice(1),
            },
          },
          turn: "increment",
        };
      },
      to: "play",
    },
  ],
  views: {
    player: ({ G }, playerID) => ({
      myHand: G.hands[playerID as "0" | "1"],
    }),
  },
});

const replayBindings = createOpenturnBindings(replayGame, {
  runtime: "local",
  match: MATCH,
});
const { Inspector: ReplayInspector, ReplayInspector: SavedReplayInspector } = createInspector(replayBindings);

function createStorageMock(): Storage {
  const values = new Map<string, string>();

  return {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(values.keys())[index] ?? null;
    },
    removeItem(key: string) {
      values.delete(key);
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
  };
}

const storage = createStorageMock();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: storage,
});

function getShadowChromeRoot(container: HTMLElement, hostSelector: string): HTMLElement {
  const host = container.querySelector(hostSelector);
  const inner = host?.shadowRoot?.querySelector("[data-ot-chrome-root]");
  if (!(inner instanceof HTMLElement)) {
    throw new Error(`Shadow chrome root not found for selector: ${hostSelector}`);
  }
  return inner;
}

function dockRoot(container: HTMLElement): HTMLElement {
  return getShadowChromeRoot(container, ".ot-inspector-dock-slot .ot-inspector-shadow-host");
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  storage.clear();
});

describe("Inspector", () => {
  test("replay mode rewinds both snapshots and player views", () => {
    const localMatch = replayBindings.createLocalMatch({ match: MATCH });

    expect(localMatch.dispatch.claim("0", { index: 0 })).toEqual({ ok: true });
    expect(localMatch.dispatch.claim("1", { index: 1 })).toEqual({ ok: true });

    const { container } = render(
      <ReplayInspector matchStore={localMatch} match={MATCH} playerID="0">
        <ReplayHarness />
      </ReplayInspector>,
    );

    expect(screen.getByTestId("turn").textContent).toBe("3");
    expect(screen.getByTestId("cells").textContent).toBe("AB");
    expect(screen.getByTestId("hand-0").textContent).toBe("moon");
    expect(screen.getByTestId("hand-1").textContent).toBe("mist");

    fireEvent.click(within(dockRoot(container)).getByTitle("Jump to start"));

    expect(screen.getByTestId("turn").textContent).toBe("1");
    expect(screen.getByTestId("cells").textContent).toBe("--");
    expect(screen.getByTestId("hand-0").textContent).toBe("sun,moon");
    expect(screen.getByTestId("hand-1").textContent).toBe("storm,mist");
  });

  test("replay-only inspector renders without a live match store", () => {
    const localMatch = replayBindings.createLocalMatch({ match: MATCH });
    expect(localMatch.dispatch.claim("0", { index: 0 })).toEqual({ ok: true });
    expect(localMatch.dispatch.claim("1", { index: 1 })).toEqual({ ok: true });

    const envelope = createSavedReplayEnvelope({
      actions: localMatch.getSnapshot().meta.log,
      gameID: "tests/replay-game",
      match: MATCH,
      playerID: "0",
    });

    const { container } = render(
      <SavedReplayInspector replayEnvelope={envelope} playerID="0">
        <ReplayHarness />
      </SavedReplayInspector>,
    );

    expect(screen.getByTestId("turn").textContent).toBe("3");
    expect(screen.getByTestId("cells").textContent).toBe("AB");

    fireEvent.click(within(dockRoot(container)).getByTitle("Jump to start"));

    expect(screen.getByTestId("turn").textContent).toBe("1");
    expect(screen.getByTestId("cells").textContent).toBe("--");
    expect((within(dockRoot(container)).getByTitle("Return to live") as HTMLButtonElement).disabled).toBe(true);
  });

  test("replay registry resolves saved replays by game id", () => {
    const envelope = createSavedReplayEnvelope({
      actions: [],
      gameID: "tests/replay-game",
      match: MATCH,
    });

    expect(resolveReplayGame(envelope, [{
      Surface: ReplayHarness,
      bindings: replayBindings,
      gameID: "tests/replay-game",
      label: "Replay game",
    }]).label).toBe("Replay game");

    expect(() => resolveReplayGame(envelope, [])).toThrow('Unknown replay game "tests/replay-game"');
  });

  test("game surface stays in light DOM and devtools chrome mounts shadow roots", () => {
    const localMatch = replayBindings.createLocalMatch({ match: MATCH });

    const { container } = render(
      <ReplayInspector matchStore={localMatch} match={MATCH} playerID="0">
        <ReplayHarness />
      </ReplayInspector>,
    );

    const surface = container.querySelector(".ot-inspector__surface");
    const turn = screen.getByTestId("turn");
    expect(surface).toBeTruthy();
    expect(surface!.contains(turn)).toBe(true);
    expect(turn.getRootNode()).toBe(document);

    const hosts = container.querySelectorAll(".ot-inspector-shadow-host");
    expect(hosts.length).toBeGreaterThanOrEqual(1);
    for (const host of hosts) {
      expect(host.shadowRoot).toBeTruthy();
    }
  });

  test("inactive inspector can be activated after live history is loaded", () => {
    const localMatch = replayBindings.createLocalMatch({ match: MATCH });

    expect(localMatch.dispatch.claim("0", { index: 0 })).toEqual({ ok: true });

    const { container, rerender } = render(
      <ReplayInspector active={false} matchStore={localMatch} match={MATCH} playerID="0">
        <ReplayHarness />
      </ReplayInspector>,
    );

    expect(screen.getByTestId("turn").textContent).toBe("2");
    expect(screen.getByTestId("cells").textContent).toBe("A-");
    expect(container.querySelector(".ot-inspector-dock-slot")).toBeNull();

    rerender(
      <ReplayInspector active matchStore={localMatch} match={MATCH} playerID="0">
        <ReplayHarness />
      </ReplayInspector>,
    );

    expect(screen.getByTestId("turn").textContent).toBe("2");
    expect(screen.getByTestId("cells").textContent).toBe("A-");

    fireEvent.click(within(dockRoot(container)).getByTitle("Jump to start"));

    expect(screen.getByTestId("turn").textContent).toBe("1");
    expect(screen.getByTestId("cells").textContent).toBe("--");
  });

  test("left rail and right inspector can render together in separate shadow roots", () => {
    const localMatch = replayBindings.createLocalMatch({ match: MATCH });

    const { container } = render(
      <ReplayInspector matchStore={localMatch} match={MATCH} playerID="0">
        <ReplayHarness />
      </ReplayInspector>,
    );

    fireEvent.click(within(dockRoot(container)).getByTitle("Action Log"));
    fireEvent.click(within(dockRoot(container)).getByTitle("State Inspector"));

    const hosts = container.querySelectorAll(".ot-inspector-shadow-host");
    expect(hosts.length).toBeGreaterThanOrEqual(3);
    const leftRoot = getShadowChromeRoot(container, ".ot-inspector-resizable--left .ot-inspector-shadow-host");
    const rightRoot = getShadowChromeRoot(container, ".ot-inspector-resizable--right .ot-inspector-shadow-host");
    expect(within(leftRoot).getByText("Event Log")).toBeTruthy();
    expect(within(rightRoot).getByText(/Inspector — Rev/)).toBeTruthy();
  });

  test("graph toggle swaps the right rail from inspector to graph", () => {
    const localMatch = replayBindings.createLocalMatch({ match: MATCH });

    const { container } = render(
      <ReplayInspector matchStore={localMatch} match={MATCH} playerID="0">
        <ReplayHarness />
      </ReplayInspector>,
    );

    const controls = within(dockRoot(container));
    fireEvent.click(controls.getByTitle("State Inspector"));
    const rightChrome = () =>
      getShadowChromeRoot(container, ".ot-inspector-resizable--right .ot-inspector-shadow-host");
    expect(within(rightChrome()).getByText(/Inspector — Rev/)).toBeTruthy();

    fireEvent.click(controls.getByTitle("Graph view"));
    const right = rightChrome();
    expect(within(right).queryByText(/Inspector — Rev/)).toBeNull();
    const graphHeading = within(right).getByText("Game Graph");
    expect(graphHeading.getRootNode()).toBe(right.getRootNode());
  });

  test("hydrated left panel width is applied from localStorage after mount", async () => {
    storage.setItem("openturn.devtools.panel.width.left", "305");

    const localMatch = replayBindings.createLocalMatch({ match: MATCH });

    const { container } = render(
      <ReplayInspector matchStore={localMatch} match={MATCH} playerID="0">
        <ReplayHarness />
      </ReplayInspector>,
    );

    fireEvent.click(within(dockRoot(container)).getByTitle("Action Log"));
    const rail = container.querySelector(".ot-inspector-resizable--left") as HTMLElement | null;
    expect(rail).toBeTruthy();
    await waitFor(() => {
      expect(rail!.style.width).toBe("305px");
    });
  });

  test("graph view opens in a sidebar panel", () => {
    const localMatch = replayBindings.createLocalMatch({ match: MATCH });
    expect(localMatch.dispatch.claim("0", { index: 0 })).toEqual({ ok: true });

    const { container } = render(
      <ReplayInspector matchStore={localMatch} match={MATCH} playerID="0">
        <ReplayHarness />
      </ReplayInspector>,
    );

    fireEvent.click(within(dockRoot(container)).getByTitle("Graph view"));

    const right = getShadowChromeRoot(container, ".ot-inspector-resizable--right .ot-inspector-shadow-host");
    const graphScope = within(right);
    expect(graphScope.getByText("Game Graph")).toBeTruthy();
    expect(graphScope.getByTestId("graph-canvas")).toBeTruthy();
    expect(graphScope.getByTestId("rf__node-play")).toBeTruthy();
    expect(graphScope.getByTestId("graph-handoff-strip").textContent).toContain("Turn");
    expect(graphScope.getByTestId("graph-handoff-strip").textContent).toContain("P0");
    expect(graphScope.getByTestId("graph-handoff-strip").textContent).toContain("P1");
    expect(graphScope.getAllByText("P1").length).toBeGreaterThan(0);
    expect(graphScope.getByTestId("graph-handoff-strip").textContent).toContain("P0 -> P1");
  });

  test("playback keeps advancing until the timeline ends", () => {
    vi.useFakeTimers();

    const localMatch = replayBindings.createLocalMatch({ match: MATCH });

    expect(localMatch.dispatch.claim("0", { index: 0 })).toEqual({ ok: true });
    expect(localMatch.dispatch.claim("1", { index: 1 })).toEqual({ ok: true });

    const { container } = render(
      <ReplayInspector matchStore={localMatch} match={MATCH} playerID="0">
        <ReplayHarness />
      </ReplayInspector>,
    );

    const controls = within(dockRoot(container));
    fireEvent.click(controls.getByTitle("Jump to start"));
    expect(screen.getByTestId("turn").textContent).toBe("1");

    fireEvent.click(controls.getByTitle("Play"));
    act(() => {
      vi.advanceTimersByTime(1300);
    });

    expect(screen.getByTestId("turn").textContent).toBe("3");
    expect(screen.getByTestId("cells").textContent).toBe("AB");
    expect(controls.getByTitle("Play")).toBeTruthy();
  });

  test("replay mode preserves the selected frame batch metadata", () => {
    const localMatch = replayBindings.createLocalMatch({ match: MATCH });

    expect(localMatch.dispatch.claim("0", { index: 0 })).toEqual({ ok: true });
    expect(localMatch.dispatch.claim("1", { index: 1 })).toEqual({ ok: true });

    const { container } = render(
      <ReplayInspector matchStore={localMatch} match={MATCH} playerID="0">
        <ReplayHarness />
      </ReplayInspector>,
    );

    expect(screen.getByTestId("last-batch-action").textContent).toBe("claim");

    fireEvent.click(within(dockRoot(container)).getByTitle("Jump to start"));

    expect(screen.getByTestId("last-batch-action").textContent).toBe("");

    fireEvent.click(within(dockRoot(container)).getByTitle("Step forward"));

    expect(screen.getByTestId("last-batch-action").textContent).toBe("claim");
  });
});

function ReplayHarness() {
  const match = replayBindings.useMatch();
  if (match.mode !== "local") throw new Error("ReplayHarness requires local mode");
  const { lastBatch, snapshot, getPlayerView } = match.state;
  const view0 = getPlayerView("0");
  const view1 = getPlayerView("1");

  return (
    <div>
      <div data-testid="turn">{snapshot.position.turn}</div>
      <div data-testid="cells">{snapshot.G.cells.map((cell) => cell ?? "-").join("")}</div>
      <div data-testid="hand-0">{view0.myHand.join(",")}</div>
      <div data-testid="hand-1">{view1.myHand.join(",")}</div>
      <div data-testid="last-batch-action">{lastBatch?.steps[0]?.event.event ?? ""}</div>
    </div>
  );
}
