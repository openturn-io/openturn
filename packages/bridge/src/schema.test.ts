import { describe, expect, it } from "vitest";

import {
  BridgeInitSchema,
  decodeBridgeFragment,
  encodeBridgeFragment,
  readBridgeFragmentFromLocation,
  type BridgeInit,
} from "./schema";

describe("BridgeInit fragment", () => {
  const sample: BridgeInit = {
    roomID: "r_1",
    userID: "u_1",
    userName: "alice",
    scope: "game",
    token: "tok",
    tokenExpiresAt: 1_700_000_000,
    websocketURL: "wss://rooms.example/room/r_1",
    parentOrigin: "https://shell.example",
    targetCapacity: 2,
    minPlayers: 2,
    maxPlayers: 2,
    isHost: true,
    hostUserID: "u_1",
    playerID: "p_0",
  };

  it("round-trips via encode/decode", () => {
    const fragment = encodeBridgeFragment(sample);
    expect(fragment.startsWith("openturn-bridge=")).toBe(true);
    const decoded = decodeBridgeFragment(`#${fragment}`);
    expect(decoded).toEqual(sample);
  });

  it("returns null for missing fragment", () => {
    expect(decodeBridgeFragment("")).toBeNull();
    expect(decodeBridgeFragment("#other=value")).toBeNull();
  });

  it("returns null for malformed payload", () => {
    expect(decodeBridgeFragment("#openturn-bridge=not-base64")).toBeNull();
    expect(
      decodeBridgeFragment(
        `#openturn-bridge=${encodeURIComponent(btoa('{"roomID":"r"}'))}`,
      ),
    ).toBeNull();
  });

  it("BridgeInitSchema applies defaults", () => {
    const parsed = BridgeInitSchema.parse({
      roomID: "r",
      userID: "u",
      userName: "n",
      scope: "lobby",
      token: "t",
      websocketURL: "wss://x",
    });
    expect(parsed.targetCapacity).toBe(0);
    expect(parsed.minPlayers).toBe(0);
    expect(parsed.maxPlayers).toBe(0);
    expect(parsed.isHost).toBe(false);
  });

  it("readBridgeFragmentFromLocation reads window.location", () => {
    window.location.hash = `#${encodeBridgeFragment(sample)}`;
    const decoded = readBridgeFragmentFromLocation();
    expect(decoded?.roomID).toBe("r_1");
    window.location.hash = "";
  });
});
