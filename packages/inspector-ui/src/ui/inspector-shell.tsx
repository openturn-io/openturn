import { useCallback, useEffect, type ReactNode } from "react";
import { Resizable } from "re-resizable";

import {
  DEVTOOLS_SHADOW_CHROME_CSS,
  INSPECTOR_LIGHT_LAYOUT_CSS,
  rightRailShadowCss,
} from "../devtools-styles";
import { useInspector } from "../inspector-context";
import {
  loadPersistedPanelWidths,
  PANEL_WIDTH_LIMITS,
  persistPanelWidth,
  type PanelWidthKey,
} from "../panel-width-storage";
import { GraphPanel } from "./graph-panel";
import { InspectorDock } from "./inspector-dock";
import { LeftPanel } from "./left-panel";
import { RightPanel } from "./right-panel";
import { ShadowChromeMount } from "./shadow-chrome-mount";

export interface InspectorShellProps {
  active?: boolean;
  children: ReactNode;
}

const RAIL_ROOT_CLASS =
  "ot-inspector dark bg-background text-foreground h-full min-h-0 min-w-0 flex flex-col";
const DOCK_ROOT_CLASS =
  "ot-inspector ot-inspector--dock-host dark bg-background text-foreground w-full min-w-0 flex flex-col";

const RESIZE_DISABLE = {
  top: false,
  right: false,
  bottom: false,
  left: false,
  topRight: false,
  bottomRight: false,
  bottomLeft: false,
  topLeft: false,
} as const;

export function InspectorShell({
  active = true,
  children,
}: InspectorShellProps) {
  const { state, dispatch } = useInspector();

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const loaded = loadPersistedPanelWidths();
    if (loaded !== null) {
      dispatch({ type: "HYDRATE_PANEL_WIDTHS", widths: loaded });
    }
  }, [dispatch]);

  const onResizeLeft = useCallback(
    (_e: unknown, _dir: unknown, ref: HTMLElement) => {
      dispatch({ type: "SET_PANEL_WIDTH", panel: "left", width: ref.offsetWidth });
    },
    [dispatch],
  );

  const onResizeStopLeft = useCallback(
    (_e: unknown, _dir: unknown, ref: HTMLElement) => {
      const w = ref.offsetWidth;
      dispatch({ type: "SET_PANEL_WIDTH", panel: "left", width: w });
      persistPanelWidth("left", w);
    },
    [dispatch],
  );

  const rightPixelWidth = state.rightPanel === "graph"
    ? state.panelWidths.graph
    : state.panelWidths.right;

  const onResizeRight = useCallback(
    (_e: unknown, _dir: unknown, ref: HTMLElement) => {
      const panel = state.rightPanel === "graph" ? "graph" : "right";
      if (state.rightPanel === null) {
        return;
      }
      dispatch({ type: "SET_PANEL_WIDTH", panel, width: ref.offsetWidth });
    },
    [dispatch, state.rightPanel],
  );

  const onResizeStopRight = useCallback(
    (_e: unknown, _dir: unknown, ref: HTMLElement) => {
      if (state.rightPanel === null) {
        return;
      }
      const panel: PanelWidthKey = state.rightPanel === "graph" ? "graph" : "right";
      const w = ref.offsetWidth;
      dispatch({ type: "SET_PANEL_WIDTH", panel, width: w });
      persistPanelWidth(panel, w);
    },
    [dispatch, state.rightPanel],
  );

  const isRightOpen = state.rightPanel !== null;
  const isSidePanelOpen = state.leftPanelOpen || isRightOpen;
  const rightShadowCss = rightRailShadowCss(state.rightPanel === "graph");

  const rightLimits = PANEL_WIDTH_LIMITS[state.rightPanel === "graph" ? "graph" : "right"];

  return (
    <div
      className="ot-inspector-outer"
      data-active-panels={
        [
          state.leftPanelOpen ? "left" : null,
          state.rightPanel === "inspector" ? "right" : null,
          state.rightPanel === "graph" ? "graph" : null,
        ].filter(Boolean).join(",") || "none"
      }
      data-left-open={state.leftPanelOpen}
      data-panel-open={isSidePanelOpen}
      data-right-panel={state.rightPanel ?? "none"}
    >
      <style
        // Light-DOM layout only; devtools theme + Tailwind utilities stay in shadow roots.
        dangerouslySetInnerHTML={{ __html: INSPECTOR_LIGHT_LAYOUT_CSS }}
      />

      <div className="ot-inspector__body">
        {active && state.leftPanelOpen && (
          <Resizable
            className="ot-inspector-resizable ot-inspector-resizable--left"
            enable={{ ...RESIZE_DISABLE, right: true }}
            maxWidth={PANEL_WIDTH_LIMITS.left.max}
            minWidth={PANEL_WIDTH_LIMITS.left.min}
            onResize={onResizeLeft}
            onResizeStop={onResizeStopLeft}
            size={{ height: "100%", width: state.panelWidths.left }}
            handleStyles={{
              right: {
                right: -4,
                width: 8,
                zIndex: 30,
              },
            }}
          >
            <ShadowChromeMount
              rootClassName={RAIL_ROOT_CLASS}
              shadowCss={DEVTOOLS_SHADOW_CHROME_CSS}
            >
              <LeftPanel />
            </ShadowChromeMount>
          </Resizable>
        )}

        <div
          className="ot-inspector__surface"
          data-replay={state.mode === "replay"}
        >
          {children}
        </div>

        {active && isRightOpen && (
          <Resizable
            className="ot-inspector-resizable ot-inspector-resizable--right"
            enable={{ ...RESIZE_DISABLE, left: true }}
            maxWidth={rightLimits.max}
            minWidth={rightLimits.min}
            onResize={onResizeRight}
            onResizeStop={onResizeStopRight}
            size={{ height: "100%", width: rightPixelWidth }}
            handleStyles={{
              left: {
                left: -4,
                width: 8,
                zIndex: 30,
              },
            }}
          >
            <ShadowChromeMount
              rootClassName={RAIL_ROOT_CLASS}
              shadowCss={rightShadowCss}
            >
              {state.rightPanel === "graph" ? <GraphPanel /> : <RightPanel />}
            </ShadowChromeMount>
          </Resizable>
        )}
      </div>

      {active && (
        <div className="ot-inspector-dock-slot">
          <ShadowChromeMount
            rootClassName={DOCK_ROOT_CLASS}
            shadowCss={DEVTOOLS_SHADOW_CHROME_CSS}
          >
            <InspectorDock />
          </ShadowChromeMount>
        </div>
      )}
    </div>
  );
}
