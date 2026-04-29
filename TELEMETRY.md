# Openturn telemetry

The `openturn` CLI collects anonymous usage analytics to help us prioritize work
on the framework. This page is the source of truth for what is collected, what
isn't, and how to opt out.

This applies to the **CLI only** (`@openturn/cli`). The library packages
(`@openturn/core`, `@openturn/server`, `@openturn/react`, etc.) ship in your
games and **never** phone home.

## What is collected

For every recognized CLI invocation, two events are sent:

- `cli_command` — at command start
- `cli_command_finished` — at command end (only for commands that exit; `dev`
  stays running so it does not emit this)

Each event includes:

| Field | Example | Notes |
|---|---|---|
| `command` | `dev`, `build`, `deploy`, `create`, `login`, `logout` | from a fixed allowlist |
| `cli_version` | `0.1.0` | from `@openturn/cli` `package.json` |
| `node_version` | `22.10.0` | `process.versions.node` |
| `bun_version` | `1.1.30` or `null` | `process.versions.bun` |
| `os` | `darwin`, `linux`, `win32` | `process.platform` |
| `arch` | `arm64`, `x64` | `process.arch` |
| `ci` | `true` / `false` | derived from `CI` env var |
| `duration_ms` | `1840` | `cli_command_finished` only |
| `exit_code` | `0` or `1` | `cli_command_finished` only |
| `error_class` | `Error`, `SaveDecodeError` | error class name only — never the message or stack |

Events are tied to a random `distinctId` UUID generated on first run and
stored in `~/.config/openturn/telemetry.json`. This identifier is not derived
from your machine or any personal information — deleting the file gives you a
new one.

## What is NOT collected

- File or directory paths
- Project names, slugs, manifest contents, or any source code
- Auth tokens, cloud URLs, or environment variable values
- Error messages or stack traces (only the error class name)
- IP-derived geolocation (sent with `disableGeoip: true`)
- Identity information (no email, no git author, no hostname, no machine ID)

## How to opt out

Set any of these and no events are ever sent:

```bash
export DO_NOT_TRACK=1               # community standard, see consoledonottrack.com
export OPENTURN_TELEMETRY_DISABLED=1 # project-specific override
```

Telemetry is also disabled automatically when:

- `CI=true` is set (e.g. inside GitHub Actions, GitLab CI)
- `NODE_ENV=test`

Add the env var to your shell profile (`~/.zshrc`, `~/.bashrc`) to persist it.

## Source code

All telemetry code lives in [packages/cli/src/telemetry/](packages/cli/src/telemetry).
It is small and intentionally easy to audit:

- [client.ts](packages/cli/src/telemetry/client.ts) — env-var precedence and
  the PostHog wrapper
- [config.ts](packages/cli/src/telemetry/config.ts) — reads/writes
  `~/.config/openturn/telemetry.json`
- [notice.ts](packages/cli/src/telemetry/notice.ts) — the first-run banner
