import {
  createContext,
  useContext,
  type Dispatch,
} from "react";

import type {
  InspectorFrame,
  InspectorTimeline,
} from "@openturn/inspector";

import type {
  InspectorAction,
  InspectorState,
} from "./inspector-state";

export interface InspectorContextValue {
  canReturnToLive: boolean;
  canReplay: boolean;
  state: InspectorState;
  dispatch: Dispatch<InspectorAction>;
  timeline: InspectorTimeline;
  currentFrame: InspectorFrame;
  maxRevision: number;
  minReplayRevision: number;
  effectiveRevision: number;
}

export const InspectorContext = createContext<InspectorContextValue | null>(null);

export function useInspector(): InspectorContextValue {
  const ctx = useContext(InspectorContext);

  if (ctx === null) {
    throw new Error("useInspector must be used within an Inspector.");
  }

  return ctx;
}
