// Umbrella entry — re-exports the most commonly used types/values across the
// lobby package. Subpaths (`./protocol`, `./runtime`, `./react`, `./registry`,
// `./supervisor`) remain the canonical import sites for code that wants only
// one slice (e.g. server-side worker code that should never pull React).

export type {
  BotDescriptor,
  BotDifficulty,
  BotRegistry,
} from "./registry";
export {
  attachBots,
  buildKnownBots,
  defineBotRegistry,
  findBot,
} from "./registry";

export type {
  BotSeatAssignment,
  BotSupervisor,
} from "./supervisor";
