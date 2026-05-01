import { describe, expect, it } from "vitest";

import {
  isKnownShellControl,
  isShellControlEnabled,
  SHELL_CONTROL_IDS,
  SHELL_CONTROLS,
} from "./shell-controls";
import type { PlayShellAdapter, PlayShellAdapterMeta } from "./play-types";

function makeAdapter(
  partialMeta: Partial<PlayShellAdapterMeta>,
  overrides: Partial<PlayShellAdapter> = {},
): PlayShellAdapter {
  const meta: PlayShellAdapterMeta = {
    deploymentID: "d",
    gameName: "Test",
    bundleURL: "https://game.example",
    multiplayer: null,
    ...partialMeta,
  };
  return {
    meta,
    inviteURL: () => "https://example/invite",
    createRoom: async () => ({ status: "rejected" }),
    joinRoom: async () => ({ status: "rejected" }),
    refreshToken: async () => null,
    toBridgeInit: () => ({}) as never,
    ...overrides,
  } as PlayShellAdapter;
}

describe("isKnownShellControl", () => {
  it("returns true for every id in SHELL_CONTROL_IDS", () => {
    for (const id of SHELL_CONTROL_IDS) {
      expect(isKnownShellControl(id)).toBe(true);
    }
  });

  it("returns false for ids not in the registry", () => {
    expect(isKnownShellControl("not-a-control")).toBe(false);
    expect(isKnownShellControl("")).toBe(false);
  });
});

describe("isShellControlEnabled", () => {
  it("hides controls whose backing adapter method is missing", () => {
    const adapter = makeAdapter({});
    // `save` requires `saveCurrentRoom`; the bare adapter doesn't supply it.
    expect(isShellControlEnabled(adapter, "save")).toBe(false);
  });

  it("renders shell-only controls (adapterMethod === null) by default", () => {
    const adapter = makeAdapter({});
    // `copyInvite` is implemented by the shell using `inviteURL`; no adapter
    // method gates it.
    expect(isShellControlEnabled(adapter, "copyInvite")).toBe(true);
  });

  it("renders adapter-backed controls when the method is present", () => {
    const adapter = makeAdapter(
      {},
      { saveCurrentRoom: async () => ({ status: "ok", saveID: "s" }) },
    );
    expect(isShellControlEnabled(adapter, "save")).toBe(true);
  });

  it("respects an explicit `false` opt-out from the manifest", () => {
    const adapter = makeAdapter(
      { shellControls: { save: false } },
      { saveCurrentRoom: async () => ({ status: "ok", saveID: "s" }) },
    );
    expect(isShellControlEnabled(adapter, "save")).toBe(false);
  });

  it("treats undefined manifest entries as default-on", () => {
    const adapter = makeAdapter(
      { shellControls: {} },
      { saveCurrentRoom: async () => ({ status: "ok", saveID: "s" }) },
    );
    expect(isShellControlEnabled(adapter, "save")).toBe(true);
  });

  it("manifest opt-out cannot resurrect a control whose adapter method is absent", () => {
    const adapter = makeAdapter({ shellControls: { save: true } });
    expect(isShellControlEnabled(adapter, "save")).toBe(false);
  });
});

describe("SHELL_CONTROLS registry", () => {
  it("covers every id in SHELL_CONTROL_IDS", () => {
    const registryKeys = new Set(Object.keys(SHELL_CONTROLS));
    for (const id of SHELL_CONTROL_IDS) {
      expect(registryKeys.has(id)).toBe(true);
    }
    expect(registryKeys.size).toBe(SHELL_CONTROL_IDS.length);
  });

  it("uses a known placement for every entry", () => {
    const placements = new Set(["toolbar-trail", "toolbar-lead", "lobby-section"]);
    for (const id of SHELL_CONTROL_IDS) {
      expect(placements.has(SHELL_CONTROLS[id].placement)).toBe(true);
    }
  });
});
