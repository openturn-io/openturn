import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { THEME_STORAGE_KEY, useTheme } from "./theme";

let root: Root | null = null;
let host: HTMLDivElement | null = null;

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

beforeEach(() => {
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: createStorageMock(),
  });
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockReturnValue({
      addEventListener: vi.fn(),
      matches: false,
      removeEventListener: vi.fn(),
    }),
  });
});

afterEach(() => {
  if (root !== null) {
    act(() => root?.unmount());
  }
  root = null;
  host?.remove();
  host = null;
  window.localStorage.removeItem(THEME_STORAGE_KEY);
  document.documentElement.classList.remove("dark");
});

describe("theme", () => {
  it("syncs same-tab useTheme subscribers when the toggle changes theme", () => {
    function Probe({ id }: { id: string }) {
      const { theme, resolvedTheme, setTheme } = useTheme();
      return (
        <button
          data-testid={id}
          onClick={() => setTheme("dark")}
          type="button"
        >
          {theme}:{resolvedTheme}
        </button>
      );
    }

    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);

    act(() => {
      root?.render(
        <>
          <Probe id="toggle" />
          <Probe id="listener" />
        </>,
      );
    });

    const toggle = host.querySelector("[data-testid='toggle']") as HTMLButtonElement;
    const listener = host.querySelector("[data-testid='listener']") as HTMLButtonElement;

    expect(listener.textContent).toBe("system:light");

    act(() => {
      toggle.click();
    });

    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(listener.textContent).toBe("dark:dark");
  });
});
