import { modernArtWithBots } from "@openturn/example-modern-art-bots";
import { createOpenturnBindings } from "@openturn/react";

export const modernArtBindings = createOpenturnBindings(modernArtWithBots, {
  runtime: "multiplayer",
});
