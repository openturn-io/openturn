import { modernArtWithBots } from "@openturn/example-modern-art-v2-bots";
import { createOpenturnBindings } from "@openturn/react";

// One bindings instance for the entire app. createOpenturnBindings caches per
// game, so any second call (with different options) silently returns this
// instance — declare it here once with the production runtime.
export const modernArtBindings = createOpenturnBindings(modernArtWithBots, {
  runtime: "multiplayer",
});
