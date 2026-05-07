import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BridgeHost, BridgeHostEvent, BridgeHostEventMap } from "./host";
import { TurnCountdown, useTurnDeadline } from "./play-deadline";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function mount(node: React.ReactNode): HTMLDivElement {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root?.render(node);
  });
  return host;
}

afterEach(() => {
  if (root !== null) {
    act(() => root?.unmount());
  }
  root = null;
  host?.remove();
  host = null;
});

/** Minimal in-memory BridgeHost stub for hook/component tests. */
function makeFakeHost(initialDeadline: number | null = null) {
  let currentDeadline: number | null = initialDeadline;
  const listeners = new Set<(e: BridgeHostEventMap["deadline-changed"]) => void>();
  const fakeHost = {
    src: "",
    matchActive: false,
    get deadline() {
      return currentDeadline;
    },
    emitShellControl: () => undefined,
    pause: () => undefined,
    resume: () => undefined,
    close: () => undefined,
    on: <K extends BridgeHostEvent>(
      event: K,
      listener: (e: BridgeHostEventMap[K]) => void,
    ) => {
      if (event === "deadline-changed") {
        const dl = listener as (e: BridgeHostEventMap["deadline-changed"]) => void;
        listeners.add(dl);
        return () => {
          listeners.delete(dl);
        };
      }
      return () => undefined;
    },
    requestBatchStream: async () => "no-source" as const,
    stopBatchStream: () => undefined,
    onBatch: () => () => undefined,
    dispose: () => undefined,
  } as unknown as BridgeHost & { setDeadline(d: number | null): void };

  (fakeHost as unknown as { setDeadline(d: number | null): void }).setDeadline = (
    d: number | null,
  ) => {
    currentDeadline = d;
    for (const l of listeners) l({ deadline: d });
  };

  return fakeHost;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/** Probe component that renders the hook output as JSON in a span. */
function HookProbe({
  host,
  outRef,
}: {
  host: BridgeHost;
  outRef: { current: { deadline: number | null; remainingMs: number; isExpired: boolean } };
}) {
  const value = useTurnDeadline(host);
  outRef.current = value;
  return (
    <span data-testid="probe">
      {String(value.deadline)}|{value.remainingMs}|{String(value.isExpired)}
    </span>
  );
}

describe("useTurnDeadline", () => {
  it("returns null deadline + 0 remainingMs initially", () => {
    const fakeHost = makeFakeHost(null);
    const ref = {
      current: { deadline: null as number | null, remainingMs: -1, isExpired: false },
    };
    mount(<HookProbe host={fakeHost} outRef={ref} />);
    expect(ref.current.deadline).toBe(null);
    expect(ref.current.remainingMs).toBe(0);
    expect(ref.current.isExpired).toBe(false);
  });

  it("updates when host emits deadline-changed", () => {
    const start = 1_700_000_000_000;
    vi.setSystemTime(start);
    const fakeHost = makeFakeHost(null);
    const ref = {
      current: { deadline: null as number | null, remainingMs: -1, isExpired: false },
    };
    mount(<HookProbe host={fakeHost} outRef={ref} />);

    act(() => {
      fakeHost.setDeadline(start + 30_000);
    });

    expect(ref.current.deadline).toBe(start + 30_000);
    expect(ref.current.remainingMs).toBe(30_000);
  });

  it("ticks at 1Hz when remainingMs >= 5000", () => {
    const start = 1_700_000_000_000;
    vi.setSystemTime(start);
    const fakeHost = makeFakeHost(start + 30_000);
    const ref = {
      current: { deadline: null as number | null, remainingMs: -1, isExpired: false },
    };
    mount(<HookProbe host={fakeHost} outRef={ref} />);
    expect(ref.current.remainingMs).toBe(30_000);

    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(ref.current.remainingMs).toBe(29_000);

    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(ref.current.remainingMs).toBe(28_000);
  });

  it("ramps to 10Hz when remainingMs < 5000", () => {
    const start = 1_700_000_000_000;
    vi.setSystemTime(start);
    const fakeHost = makeFakeHost(start + 4_500);
    const ref = {
      current: { deadline: null as number | null, remainingMs: -1, isExpired: false },
    };
    mount(<HookProbe host={fakeHost} outRef={ref} />);
    expect(ref.current.remainingMs).toBe(4_500);

    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(ref.current.remainingMs).toBe(4_400);

    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(ref.current.remainingMs).toBe(4_300);
  });

  it("isExpired becomes true at deadline; ticking stops", () => {
    const start = 1_700_000_000_000;
    vi.setSystemTime(start);
    const fakeHost = makeFakeHost(start + 1_000);
    const ref = {
      current: { deadline: null as number | null, remainingMs: -1, isExpired: false },
    };
    mount(<HookProbe host={fakeHost} outRef={ref} />);

    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(ref.current.remainingMs).toBe(0);
    expect(ref.current.isExpired).toBe(true);

    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(ref.current.remainingMs).toBe(0);
    expect(ref.current.isExpired).toBe(true);
  });

  it("clearing deadline (host emits null) stops ticking", () => {
    const start = 1_700_000_000_000;
    vi.setSystemTime(start);
    const fakeHost = makeFakeHost(start + 30_000);
    const ref = {
      current: { deadline: null as number | null, remainingMs: -1, isExpired: false },
    };
    mount(<HookProbe host={fakeHost} outRef={ref} />);
    expect(ref.current.remainingMs).toBe(30_000);

    act(() => {
      fakeHost.setDeadline(null);
    });
    expect(ref.current.deadline).toBe(null);
    expect(ref.current.remainingMs).toBe(0);
    expect(ref.current.isExpired).toBe(false);
  });
});

describe("<TurnCountdown />", () => {
  it("renders nothing when deadline is null", () => {
    const fakeHost = makeFakeHost(null);
    const container = mount(<TurnCountdown host={fakeHost} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders 0:30 for a 30s deadline", () => {
    const start = 1_700_000_000_000;
    vi.setSystemTime(start);
    const fakeHost = makeFakeHost(start + 30_000);
    const container = mount(<TurnCountdown host={fakeHost} />);
    const node = container.querySelector("[aria-label='Turn time remaining']");
    expect(node?.textContent).toContain("0:30");
  });

  it("adds urgent text-red class when remainingMs < 5000", () => {
    const start = 1_700_000_000_000;
    vi.setSystemTime(start);
    const fakeHost = makeFakeHost(start + 4_500);
    const container = mount(<TurnCountdown host={fakeHost} />);
    const node = container.querySelector("[aria-label='Turn time remaining']") as HTMLElement;
    expect(node.className).toContain("text-red-600");
  });

  it("formats m:ss with zero-padded seconds", () => {
    const start = 1_700_000_000_000;
    vi.setSystemTime(start);
    const fakeHost = makeFakeHost(start + 65_000);
    const container = mount(<TurnCountdown host={fakeHost} />);
    const node = container.querySelector("[aria-label='Turn time remaining']");
    expect(node?.textContent).toContain("1:05");
  });

  it("shows 0:00 ⏱ when expired", () => {
    const start = 1_700_000_000_000;
    vi.setSystemTime(start);
    const fakeHost = makeFakeHost(start - 1);
    const container = mount(<TurnCountdown host={fakeHost} />);
    const node = container.querySelector("[aria-label='Turn time remaining']");
    const text = node?.textContent ?? "";
    expect(text).toContain("0:00");
    expect(text).toContain("⏱");
  });
});
