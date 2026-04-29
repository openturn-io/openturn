import { afterEach, describe, expect, test, vi } from "vitest";

import {
  clampPanelWidth,
  loadPersistedPanelWidths,
  persistPanelWidth,
} from "./panel-width-storage";

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

describe("panel-width-storage", () => {
  afterEach(() => {
    storage.clear();
    vi.restoreAllMocks();
  });

  test("persistPanelWidth writes the expected localStorage key", () => {
    persistPanelWidth("left", 315);
    expect(storage.getItem("openturn.devtools.panel.width.left")).toBe("315");
    persistPanelWidth("right", 400);
    expect(storage.getItem("openturn.devtools.panel.width.right")).toBe("400");
    persistPanelWidth("graph", 500);
    expect(storage.getItem("openturn.devtools.panel.width.graph")).toBe("500");
  });

  test("loadPersistedPanelWidths returns clamped values", () => {
    storage.setItem("openturn.devtools.panel.width.left", "9999");
    const loaded = loadPersistedPanelWidths();
    expect(loaded?.left).toBe(clampPanelWidth("left", 9999));
  });
});
