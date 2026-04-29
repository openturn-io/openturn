import { splendorWithBots } from "@openturn/example-splendor-bots";
import { createOpenturnBindings } from "@openturn/react";

// One bindings instance for the entire app. createOpenturnBindings caches per
// game, so any second call (with different options) silently returns this
// instance — declare it here once with the production runtime.
export const splendorBindings = createOpenturnBindings(splendorWithBots, {
  runtime: "multiplayer",
});
