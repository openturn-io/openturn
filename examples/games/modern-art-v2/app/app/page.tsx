import "../src/styles.css";

import { LocalPreview } from "../src/components/LocalPreview";
import { ModernArtExperience } from "../src/components/ModernArtExperience";

export default function Page() {
  // Dev escape hatch: `?preview=local` renders a no-lobby, single-tab game so
  // the gallery layout is reachable without spinning up a hosted room.
  if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("preview") === "local") {
    return <LocalPreview />;
  }
  return <ModernArtExperience />;
}
