export interface BotSeatAssignment {
  seatIndex: number;
  playerID: string;
  botID: string;
  /**
   * Per-bot-seat hosted credentials. Required by `createHostedBotSupervisor`,
   * ignored by `createLocalBotSupervisor`. The host (cloud DO or OSS dev
   * server) mints these tokens after `LobbyRuntime.start()` and forwards
   * them to the supervisor — they never reach client browsers.
   */
  hostedTransition?: {
    roomToken: string;
    tokenExpiresAt: number;
    websocketURL: string;
  };
}

export interface BotSupervisor {
  /** Idempotent — calling twice throws to surface misuse. */
  start(assignments: ReadonlyArray<BotSeatAssignment>): Promise<void>;
  stop(): void;
}

export { createLocalBotSupervisor } from "./local";
export type {
  CreateLocalBotSupervisorOptions,
  LocalBotSupervisor,
} from "./local";

export { createHostedBotSupervisor } from "./hosted";
export type { CreateHostedBotSupervisorOptions } from "./hosted";
