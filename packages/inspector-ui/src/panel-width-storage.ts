import {
  clampPanelWidth,
  DEFAULT_PANEL_WIDTHS,
  PANEL_WIDTH_LIMITS,
  type PanelWidthKey,
} from "@openturn/inspector";

export { clampPanelWidth, DEFAULT_PANEL_WIDTHS, PANEL_WIDTH_LIMITS, type PanelWidthKey };

const KEYS: Record<PanelWidthKey, string> = {
  left: "openturn.devtools.panel.width.left",
  right: "openturn.devtools.panel.width.right",
  graph: "openturn.devtools.panel.width.graph",
};

export function loadPersistedPanelWidths(): Partial<Record<PanelWidthKey, number>> | null {
  if (typeof localStorage === "undefined") {
    return null;
  }
  try {
    const out: Partial<Record<PanelWidthKey, number>> = {};
    for (const key of Object.keys(KEYS) as PanelWidthKey[]) {
      const raw = localStorage.getItem(KEYS[key]);
      if (raw === null) {
        continue;
      }
      const n = Number(raw);
      if (!Number.isFinite(n)) {
        continue;
      }
      out[key] = clampPanelWidth(key, n);
    }
    return Object.keys(out).length > 0 ? out : null;
  } catch {
    return null;
  }
}

export function persistPanelWidth(key: PanelWidthKey, width: number): void {
  if (typeof localStorage === "undefined") {
    return;
  }
  try {
    localStorage.setItem(KEYS[key], String(clampPanelWidth(key, width)));
  } catch {
    /* ignore quota / private mode */
  }
}
