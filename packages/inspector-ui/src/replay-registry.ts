import type { AnyGame } from "@openturn/core";
import type { OpenturnBindings } from "@openturn/react";
import type { ReplayInspectorProps } from "./inspector-wrapper";
import type { SavedReplayEnvelope } from "@openturn/replay";
import type { ComponentType } from "react";

export interface ReplayGameRegistryEntry<TGame extends AnyGame = AnyGame> {
  Inspector: ComponentType<ReplayInspectorProps<TGame>>;
  Surface: ComponentType;
  bindings: OpenturnBindings<TGame>;
  description?: string;
  gameID: string;
  label?: string;
}

export function resolveReplayGame(
  envelope: SavedReplayEnvelope,
  registry: readonly ReplayGameRegistryEntry[],
): ReplayGameRegistryEntry {
  const resolved = registry.find((entry) => entry.gameID === envelope.gameID);

  if (resolved === undefined) {
    throw new Error(`Unknown replay game "${envelope.gameID}". Register it before loading the replay.`);
  }

  return resolved;
}
