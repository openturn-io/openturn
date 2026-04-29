import type { AnyGame } from "@openturn/core";
import type { OpenturnBindings } from "@openturn/react";

import {
  createLocalInspector,
  createSavedReplayInspector,
  type InspectorProps,
  type ReplayInspectorProps,
} from "./inspector-wrapper";
import {
  createHostedInspectorFromGame,
  type HostedInspectorProps,
} from "./hosted-inspector-wrapper";

export type {
  InspectorProps,
  ReplayInspectorProps,
  HostedInspectorProps,
};

export {
  InspectorPanel,
  type InspectorPanelProps,
} from "./inspector-panel";
export { useInspector, type InspectorContextValue } from "./inspector-context";
export {
  resolveReplayGame,
  type ReplayGameRegistryEntry,
} from "./replay-registry";
export {
  type InspectorMode,
  type RightRailPanel,
  type InspectorState,
  type InspectorAction,
  type PanelWidthsState,
  type PlaybackSpeed,
  PLAYBACK_SPEEDS,
} from "./inspector-state";

/**
 * Single entry point that returns the three inspector flavors.
 *
 * ```ts
 * const { Inspector, ReplayInspector, HostedInspector } = createInspector(bindings);
 * ```
 *
 * - `Inspector` — live local match (reads an `OpenturnMatchStore`).
 * - `ReplayInspector` — saved replay envelope or a pre-built `ReplayTimeline`.
 * - `HostedInspector` — live hosted match via a `HostedMatchState<TGame>`.
 */
export function createInspector<TGame extends AnyGame>(bindings: OpenturnBindings<TGame>) {
  return {
    Inspector: createLocalInspector(bindings),
    ReplayInspector: createSavedReplayInspector(bindings),
    HostedInspector: createHostedInspectorFromGame(bindings.game),
  };
}
