import "../src/styles.css";

import { ConnectFourExperience } from "../src/components/ConnectFourExperience";
import { LocalPreview } from "../src/components/LocalPreview";

export default function Page() {
  if (
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("preview") === "local"
  ) {
    return <LocalPreview />;
  }
  return <ConnectFourExperience />;
}
