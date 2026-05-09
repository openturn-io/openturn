import { connectFourWithBots } from "@openturn/example-connect-four-bots";
import { createOpenturnBindings } from "@openturn/react";

const bindings = createOpenturnBindings(connectFourWithBots, {
  runtime: "multiplayer",
});

export const { OpenturnProvider, useMatch, useRoom, createLocalMatch } = bindings;
