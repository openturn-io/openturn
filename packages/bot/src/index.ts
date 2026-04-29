export { defineBot } from "./define";
export type {
  Bot,
  BotLifecycleContext,
  DecideContext,
  EnumerateActions,
  SimulateFn,
  SimulateResult,
  SimulationFailure,
  SimulationSuccess,
} from "./define";
export type { LegalAction } from "./define";

export type { BotHost, HostDispatchOutcome } from "./host";

export { createLocalSessionHost, createLocalSessionBus } from "./hosts/local";
export type { LocalSessionHostHandle, LocalSessionBus } from "./hosts/local";
export { createHostedClientHost } from "./hosts/hosted";

export { simulate } from "./simulate";
export { enumerateLegalActions } from "./legal";
export { forkRng } from "./rng";
export type { BotRng } from "./rng";

export { createDeadline, realClock } from "./budget";
export type { DeadlineToken, DeadlineClock } from "./budget";

export {
  attachLocalBot,
  attachLocalBots,
  attachHostedBot,
} from "./runner";
export type {
  BotRunner,
  AttachOptions,
  AttachLocalBotOptions,
  AttachLocalBotResult,
  AttachLocalBotsOptions,
  AttachLocalBotsResult,
  AttachHostedBotOptions,
} from "./runner";
