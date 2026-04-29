// Runtime extensions for lobby bot seats land in PR 2. For now this barrel
// just re-exports the upstream `LobbyRuntime` so consumers can already
// import from `@openturn/lobby/runtime`.
export {
  LobbyRuntime,
} from "@openturn/server";
export type {
  LobbyApplyResult,
  LobbyDropUserResult,
  LobbyEnv,
  LobbyPersistedState,
  LobbyStartAssignment,
  LobbyStartResult,
  SeatRecord,
} from "@openturn/server";
