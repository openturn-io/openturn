import { connectFour } from "@openturn/example-connect-four-game";
import { createOpenturnBindings } from "@openturn/react";

export const connectFourMatch = { players: connectFour.playerIDs };

// Bindings are cached per game definition, so importing this module from
// multiple places returns the same instance — they share the matchStore,
// which is what keeps `useMatch()` reactive across the lobby/game split.
const bindings = createOpenturnBindings(connectFour, {
  runtime: "local",
  match: connectFourMatch,
});

export const { OpenturnProvider, useMatch } = bindings;
