import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

export interface TelemetryConfig {
  distinctId: string;
  noticeShownAt: string;
}

function configPath(): string {
  const base = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
  return join(base, "openturn", "telemetry.json");
}

export function loadTelemetryConfig(): TelemetryConfig | null {
  const path = configPath();
  if (!existsSync(path)) return null;
  try {
    const contents = JSON.parse(readFileSync(path, "utf8")) as Partial<TelemetryConfig>;
    if (typeof contents.distinctId !== "string" || typeof contents.noticeShownAt !== "string") {
      return null;
    }
    return { distinctId: contents.distinctId, noticeShownAt: contents.noticeShownAt };
  } catch {
    return null;
  }
}

export function createTelemetryConfig(): TelemetryConfig {
  const config: TelemetryConfig = {
    distinctId: randomUUID(),
    noticeShownAt: new Date().toISOString(),
  };
  const path = configPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  return config;
}
