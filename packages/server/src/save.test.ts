import { describe, expect, test } from "bun:test";

import {
  SAVE_FORMAT_VERSION,
  SaveDecodeError,
  decodeSave,
  encodeSave,
  type SavedGamePayload,
} from "./save";

const SECRET = "test-secret-do-not-use-in-production-0123456789abcdef";
const ALT_SECRET = "different-secret-0000000000000000000000000000000000";

function samplePayload(overrides: Partial<SavedGamePayload> = {}): SavedGamePayload {
  return {
    saveFormatVersion: SAVE_FORMAT_VERSION,
    savedAt: 1_700_000_000_000,
    savedByUserID: "user_abc",
    roomIDOrigin: "room_xyz",
    gameKey: "tictactoe",
    deploymentVersion: "dep_v1",
    schemaVersion: "1.0.0",
    seed: "seed_42",
    initialNow: 1_700_000_000_000,
    match: { players: ["a", "b"] },
    branch: {
      branchID: "main",
      createdAtActionID: null,
      createdAtRevision: 0,
      headActionID: null,
      parentBranchID: null,
    },
    revision: 3,
    checkpoint: {
      G: { board: [1, 0, 0, 0, 2, 0, 0, 0, 0] },
      position: { name: "playing", path: ["playing"], turn: 3 },
      meta: { log: [], match: { players: ["a", "b"] }, now: 1, result: null, rng: { state: "x", draws: 0 }, seed: "seed_42" },
    },
    ...overrides,
  };
}

describe("save codec", () => {
  test("roundtrips a payload", async () => {
    const payload = samplePayload();
    const blob = await encodeSave(payload, SECRET);
    expect(blob[0]).toBe(0x4f);
    expect(blob[1]).toBe(0x54);
    expect(blob[2]).toBe(0x53);
    expect(blob[3]).toBe(0x56);
    expect(blob[4]).toBe(0x01);

    const decoded = await decodeSave(blob, SECRET, payload.deploymentVersion);
    expect(decoded).toEqual(payload);
  });

  test("rejects a blob with bad magic", async () => {
    const payload = samplePayload();
    const blob = await encodeSave(payload, SECRET);
    blob[0] = 0x00;
    await expect(decodeSave(blob, SECRET, payload.deploymentVersion)).rejects.toMatchObject({
      name: "SaveDecodeError",
      code: "magic",
    });
  });

  test("rejects a blob with tampered ciphertext", async () => {
    const payload = samplePayload();
    const blob = await encodeSave(payload, SECRET);
    blob[blob.byteLength - 1] ^= 0x01;
    await expect(decodeSave(blob, SECRET, payload.deploymentVersion)).rejects.toMatchObject({
      name: "SaveDecodeError",
      code: "auth",
    });
  });

  test("rejects a blob with tampered header (AAD)", async () => {
    const payload = samplePayload();
    const blob = await encodeSave(payload, SECRET);
    blob[6] = 0x02;
    await expect(decodeSave(blob, SECRET, payload.deploymentVersion)).rejects.toMatchObject({
      name: "SaveDecodeError",
      code: "auth",
    });
  });

  test("rejects when expectedDeploymentVersion does not match the key", async () => {
    const payload = samplePayload({ deploymentVersion: "dep_v1" });
    const blob = await encodeSave(payload, SECRET);
    await expect(decodeSave(blob, SECRET, "dep_v2")).rejects.toMatchObject({
      name: "SaveDecodeError",
      code: "auth",
    });
  });

  test("rejects when the secret is wrong", async () => {
    const payload = samplePayload();
    const blob = await encodeSave(payload, SECRET);
    await expect(decodeSave(blob, ALT_SECRET, payload.deploymentVersion)).rejects.toMatchObject({
      name: "SaveDecodeError",
      code: "auth",
    });
  });

  test("supports rotating keyId", async () => {
    const payload = samplePayload();
    const blobV1 = await encodeSave(payload, SECRET, { keyId: 1 });
    const blobV2 = await encodeSave(payload, SECRET, { keyId: 2 });

    expect(blobV1[6]).toBe(1);
    expect(blobV2[6]).toBe(2);

    const decodedV1 = await decodeSave(blobV1, SECRET, payload.deploymentVersion);
    const decodedV2 = await decodeSave(blobV2, SECRET, payload.deploymentVersion);

    expect(decodedV1).toEqual(payload);
    expect(decodedV2).toEqual(payload);
  });

  test("rejects a truncated blob", async () => {
    const payload = samplePayload();
    const blob = await encodeSave(payload, SECRET);
    const truncated = blob.slice(0, 10);
    await expect(
      decodeSave(truncated, SECRET, payload.deploymentVersion),
    ).rejects.toBeInstanceOf(SaveDecodeError);
  });

  test("compressed blob fits well under 1 MB for a modest payload", async () => {
    const payload = samplePayload({
      checkpoint: {
        G: {
          board: Array.from({ length: 500 }, (_, i) => ({ cell: i, owner: i % 3 })),
          moves: Array.from({ length: 500 }, (_, i) => ({ at: i, by: `p${i % 4}` })),
        },
        position: { name: "playing", path: ["playing"], turn: 500 },
        meta: { log: [], match: { players: ["a", "b"] }, now: 500, result: null, rng: { state: "x", draws: 10 }, seed: "seed_42" },
      },
    });
    const blob = await encodeSave(payload, SECRET);
    expect(blob.byteLength).toBeLessThan(100_000);
  });
});
