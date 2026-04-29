import { readFileSync } from "node:fs";
import { PostHog } from "posthog-node";

import { createTelemetryConfig, loadTelemetryConfig, type TelemetryConfig } from "./config";

const POSTHOG_API_KEY = "phc_Cc6iWqV9aHJcctWSpajiVC4uo29Bn8YpT3r2B2tdZWju";
const POSTHOG_HOST = "https://us.i.posthog.com";

export type TelemetryStatus =
  | { enabled: true; config: TelemetryConfig }
  | { enabled: false; reason: "DO_NOT_TRACK" | "OPENTURN_TELEMETRY_DISABLED" | "CI" | "test" | "no-api-key" };

function isTruthy(value: string | undefined): boolean {
  if (value === undefined) return false;
  const v = value.trim().toLowerCase();
  return v !== "" && v !== "0" && v !== "false";
}

function resolveStatus(config: TelemetryConfig): TelemetryStatus {
  if (isTruthy(process.env.DO_NOT_TRACK)) return { enabled: false, reason: "DO_NOT_TRACK" };
  if (isTruthy(process.env.OPENTURN_TELEMETRY_DISABLED)) return { enabled: false, reason: "OPENTURN_TELEMETRY_DISABLED" };
  if (isTruthy(process.env.CI)) return { enabled: false, reason: "CI" };
  if (process.env.NODE_ENV === "test") return { enabled: false, reason: "test" };
  if (POSTHOG_API_KEY.startsWith("phc_REPLACE")) return { enabled: false, reason: "no-api-key" };
  return { enabled: true, config };
}

export interface TelemetryClient {
  status: TelemetryStatus;
  track(event: string, properties: Record<string, unknown>): void;
  shutdown(timeoutMs: number): Promise<void>;
}

let cliVersion: string | undefined;

function readCliVersion(): string {
  if (cliVersion !== undefined) return cliVersion;
  try {
    const url = new URL("../../package.json", import.meta.url);
    const pkg = JSON.parse(readFileSync(url, "utf8")) as { version?: string };
    cliVersion = typeof pkg.version === "string" ? pkg.version : "unknown";
  } catch {
    cliVersion = "unknown";
  }
  return cliVersion;
}

export function createTelemetryClient(config: TelemetryConfig): TelemetryClient {
  const status = resolveStatus(config);

  if (!status.enabled) {
    return {
      status,
      track: () => {},
      shutdown: async () => {},
    };
  }

  let posthog: PostHog | null = null;
  try {
    posthog = new PostHog(POSTHOG_API_KEY, {
      host: POSTHOG_HOST,
      flushAt: 1,
      flushInterval: 0,
      disableGeoip: true,
    });
  } catch {
    return {
      status,
      track: () => {},
      shutdown: async () => {},
    };
  }

  const client = posthog;
  const baseProperties = {
    cli_version: readCliVersion(),
    node_version: process.versions.node,
    bun_version: process.versions.bun ?? null,
    os: process.platform,
    arch: process.arch,
    ci: isTruthy(process.env.CI),
  };

  return {
    status,
    track(event, properties) {
      try {
        client.capture({
          distinctId: config.distinctId,
          event,
          properties: { ...baseProperties, ...properties },
          disableGeoip: true,
        });
      } catch {}
    },
    async shutdown(timeoutMs) {
      try {
        await client.shutdown(timeoutMs);
      } catch {}
    },
  };
}

export function ensureTelemetryConfig(): TelemetryConfig | null {
  const existing = loadTelemetryConfig();
  if (existing !== null) return existing;
  try {
    return createTelemetryConfig();
  } catch {
    return null;
  }
}
