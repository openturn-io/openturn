import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { PlayPage } from "@openturn/bridge/play";

import { createDevPlayShellAdapter } from "./dev-adapter";

interface PlayBootConfig {
  deploymentID: string;
  gameName: string;
  bundleBase: string;
}

function readBootConfig(): PlayBootConfig {
  const raw = (window as unknown as { __OPENTURN_PLAY__?: unknown }).__OPENTURN_PLAY__;
  if (raw === null || typeof raw !== "object") {
    throw new Error("__OPENTURN_PLAY__ boot config missing");
  }
  const config = raw as Partial<PlayBootConfig>;
  if (
    typeof config.deploymentID !== "string" ||
    typeof config.gameName !== "string" ||
    typeof config.bundleBase !== "string"
  ) {
    throw new Error("__OPENTURN_PLAY__ boot config malformed");
  }
  return {
    deploymentID: config.deploymentID,
    gameName: config.gameName,
    bundleBase: config.bundleBase,
  };
}

function renderError(message: string) {
  const node = document.getElementById("root") ?? document.body;
  node.innerHTML = "";
  const div = document.createElement("div");
  div.style.padding = "16px";
  div.style.color = "#b91c1c";
  div.style.fontFamily = "ui-sans-serif, system-ui, sans-serif";
  div.textContent = message;
  node.appendChild(div);
}

try {
  const config = readBootConfig();
  const adapter = createDevPlayShellAdapter(config);
  const initialRoomID = adapter.readRoomIDFromLocation?.() ?? null;
  const container = document.getElementById("root");
  if (container === null) throw new Error("missing #root mount");
  createRoot(container).render(
    <StrictMode>
      <PlayPage adapter={adapter} initialRoomID={initialRoomID} />
    </StrictMode>,
  );
} catch (caught) {
  renderError(`Play shell failed to start: ${caught instanceof Error ? caught.message : String(caught)}`);
}
