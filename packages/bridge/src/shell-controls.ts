import type { OpenturnShellControl } from "@openturn/manifest";
import { SHELL_CONTROL_IDS } from "@openturn/manifest";

import type { PlayShellAdapter } from "./play-types";

// Methods a control can require on the host adapter. Restricting to optional
// adapter methods keeps the registry honest: the required methods (createRoom,
// joinRoom, etc.) aren't gated by shell controls and shouldn't appear here.
type OptionalAdapterMethod =
  | "saveCurrentRoom"
  | "createRoomFromSave"
  | "resetRoom"
  | "returnToLobby"
  | "listPublicRooms"
  | "setVisibility";

export interface ShellControlMeta {
  /**
   * Adapter method that backs this control. `null` means the control is
   * implemented entirely by the shell (e.g. copy-invite, which just reads the
   * inviteURL the host already has).
   */
  readonly adapterMethod: OptionalAdapterMethod | null;
  /** User-facing label rendered by the toolbar / lobby section. */
  readonly label: string;
  /**
   * Where the control lives in the shell layout:
   *  - `toolbar-trail`: right-side action button (Save / Load / Reset / lobby)
   *  - `toolbar-lead`:  left-side affordance (Copy Invite, visibility toggle)
   *  - `lobby-section`: full lobby card / list (start-from-save, public rooms)
   */
  readonly placement: "toolbar-trail" | "toolbar-lead" | "lobby-section";
  /**
   * When true, the rendered button is disabled while no match is active. Used
   * for controls that only make sense once the lobby has transitioned.
   */
  readonly requiresMatchActive?: boolean;
}

// Single registry binding each manifest-declared shell control id to its
// runtime metadata. The `satisfies Record<OpenturnShellControl, …>` constraint
// is the lockstep check: adding an id to SHELL_CONTROL_IDS in @openturn/manifest
// without extending this object fails to compile. Removing one here without
// removing it upstream also fails. This is the single source of truth the
// shell, the manifest schema, and the runtime gating all derive from.
export const SHELL_CONTROLS = {
  save: {
    adapterMethod: "saveCurrentRoom",
    label: "Save",
    placement: "toolbar-trail",
  },
  load: {
    adapterMethod: "createRoomFromSave",
    label: "Load",
    placement: "toolbar-trail",
  },
  reset: {
    adapterMethod: "resetRoom",
    label: "Reset",
    placement: "toolbar-trail",
    requiresMatchActive: true,
  },
  returnToLobby: {
    adapterMethod: "returnToLobby",
    label: "Back to lobby",
    placement: "toolbar-trail",
    requiresMatchActive: true,
  },
  copyInvite: {
    adapterMethod: null,
    label: "Copy Invite",
    placement: "toolbar-lead",
  },
  publicRooms: {
    adapterMethod: "listPublicRooms",
    label: "Open public rooms",
    placement: "lobby-section",
  },
  visibilityToggle: {
    adapterMethod: "setVisibility",
    label: "Visibility",
    placement: "toolbar-lead",
  },
} as const satisfies Record<OpenturnShellControl, ShellControlMeta>;

export { SHELL_CONTROL_IDS, type OpenturnShellControl };

// Trail-placement control ids derived from the registry. Used by the toolbar
// renderer to require a handler for every trail control at compile time —
// adding a new `placement: "toolbar-trail"` entry to SHELL_CONTROLS will fail
// to typecheck wherever trail handlers are declared until the new id is
// covered.
export type TrailShellControl = {
  [K in OpenturnShellControl]: (typeof SHELL_CONTROLS)[K]["placement"] extends "toolbar-trail"
    ? K
    : never;
}[OpenturnShellControl];

// Runtime narrowing helper. Games receive `BridgeShellControlEvent.control` as
// an open string (the wire schema is intentionally loose for forward-compat;
// see schema.ts). Use this to narrow before switching on the value so unknown
// ids — including future ones from a newer host — are handled explicitly.
const KNOWN_SHELL_CONTROL_IDS = new Set<string>(SHELL_CONTROL_IDS);
export function isKnownShellControl(id: string): id is OpenturnShellControl {
  return KNOWN_SHELL_CONTROL_IDS.has(id);
}

// Resolve a single shell control: render only when the adapter implements the
// backing method (or the control is shell-only) AND the manifest hasn't
// explicitly opted out. `undefined` in the manifest means "default-on if
// supported".
export function isShellControlEnabled(
  adapter: PlayShellAdapter,
  id: OpenturnShellControl,
): boolean {
  const meta = SHELL_CONTROLS[id];
  const hasAdapter =
    meta.adapterMethod === null || adapter[meta.adapterMethod] !== undefined;
  if (!hasAdapter) return false;
  return adapter.meta.shellControls?.[id] !== false;
}
