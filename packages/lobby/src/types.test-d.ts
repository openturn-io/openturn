// Type-level tests for the lobby bot-registry surface. The registry types
// thread `TGame` through `BotDescriptor` → `Bot<TGame>` → `Bot.decide`'s
// view/playerID/legalActions. A regression that erased TGame on registry
// composition would silently lose typed access for bot authors.

import { defineBot } from "@openturn/bot";
import { defineGame, turn } from "@openturn/gamekit";
import { expectTypeOf } from "expect-type";

import { attachBots, buildKnownBots, defineBotRegistry, findBot } from "./registry";
import type { BotDescriptor, BotRegistry } from "./registry";

const ttt = defineGame({
  playerIDs: ["0", "1"] as const,
  setup: (): { board: number[] } => ({ board: [0, 0, 0] }),
  turn: turn.roundRobin(),
  moves: ({ move }) => ({
    placeMark: move<{ row: number; col: number }>({ run: ({ move }) => move.endTurn() }),
  }),
});

const randomBot = defineBot<typeof ttt>({
  name: "random",
  decide: ({ legalActions }) => legalActions[0]!,
});

// ---- defineBotRegistry preserves TGame ----
const registry = defineBotRegistry<typeof ttt>([
  { botID: "random", label: "Random", bot: randomBot },
]);

expectTypeOf(registry).toEqualTypeOf<BotRegistry<typeof ttt>>();
expectTypeOf(registry.entries[0]!).toEqualTypeOf<BotDescriptor<typeof ttt>>();

// ---- findBot returns the typed descriptor ----
const found = findBot(registry, "random");
expectTypeOf(found).toEqualTypeOf<BotDescriptor<typeof ttt> | null>();

// ---- attachBots returns the same TGame, with `bots` carried as metadata ----
const tttWithBots = attachBots(ttt, registry);
expectTypeOf(tttWithBots).toEqualTypeOf<typeof ttt>();

// ---- buildKnownBots returns a label/desc/difficulty map keyed by botID ----
const known = buildKnownBots(registry);
expectTypeOf(known).toEqualTypeOf<
  ReadonlyMap<string, { label: string; description?: string; difficulty?: "easy" | "medium" | "hard" | "expert" }>
>();
