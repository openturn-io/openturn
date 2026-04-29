import xyflowCss from "@xyflow/react/dist/style.css?inline";

import inspectorLightCss from "./ui/inspector-light.css?inline";
import inspectorCss from "./ui/inspector.css?inline";

export const INSPECTOR_LIGHT_LAYOUT_CSS = inspectorLightCss;
export const DEVTOOLS_SHADOW_CHROME_CSS = inspectorCss;
export const XYFLOW_SHADOW_CSS = xyflowCss;

export function rightRailShadowCss(includeGraph: boolean): string {
  return includeGraph ? `${DEVTOOLS_SHADOW_CHROME_CSS}\n${XYFLOW_SHADOW_CSS}` : DEVTOOLS_SHADOW_CHROME_CSS;
}
