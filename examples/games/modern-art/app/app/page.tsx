import "../src/styles.css";

import { LocalPreview } from "../src/components/LocalPreview";
import { ModernArtExperience } from "../src/components/ModernArtExperience";

export default function Page() {
  if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("preview") === "local") {
    return <LocalPreview />;
  }
  return <ModernArtExperience />;
}
