import {
  parseJsonText,
  stringifyJson,
  type JsonValue,
} from "@openturn/json";
import type {
  ProtocolHistoryBranch,
  ProtocolValue,
} from "@openturn/protocol";

const MAGIC = new Uint8Array([0x4f, 0x54, 0x53, 0x56]);
const CONTAINER_VERSION = 0x01;
const ALGO_AES_256_GCM_HKDF_SHA256_DEFLATE = 0x01;
const HEADER_LEN = 23;
const NONCE_LEN = 12;
const FLAG_COMPRESSED = 0x01;

export const SAVE_FORMAT_VERSION = 1;

export type SavedGameCheckpoint = ProtocolValue;

export interface SavedGamePayload {
  saveFormatVersion: number;
  savedAt: number;
  savedByUserID: string;
  roomIDOrigin: string;
  gameKey: string;
  deploymentVersion: string;
  schemaVersion: string;
  seed: string;
  initialNow: number;
  match: ProtocolValue;
  branch: ProtocolHistoryBranch;
  checkpoint: SavedGameCheckpoint;
  revision: number;
}

export interface SavedGameMeta {
  saveID: string;
  gameKey: string;
  deploymentVersion: string;
  createdByUserID: string;
  roomIDOrigin: string;
  createdAt: string;
  sizeBytes: number;
}

export type SaveDecodeErrorCode = "magic" | "version" | "auth" | "key" | "payload";

export class SaveDecodeError extends Error {
  readonly code: SaveDecodeErrorCode;

  constructor(code: SaveDecodeErrorCode, message: string) {
    super(message);
    this.name = "SaveDecodeError";
    this.code = code;
  }
}

export interface EncodeSaveOptions {
  keyId?: number;
  nonce?: Uint8Array;
}

export async function encodeSave(
  payload: SavedGamePayload,
  secret: string,
  options: EncodeSaveOptions = {},
): Promise<Uint8Array> {
  const keyId = options.keyId ?? 0x01;
  if (keyId < 1 || keyId > 0xff) {
    throw new RangeError(`keyId must be in 1..255, received ${keyId}`);
  }

  const json = stringifyJson(payload as unknown as JsonValue);
  const utf8 = new TextEncoder().encode(json);
  const compressed = await deflateRaw(utf8);

  const nonce = options.nonce ?? randomNonce();
  if (nonce.byteLength !== NONCE_LEN) {
    throw new RangeError(`nonce must be ${NONCE_LEN} bytes`);
  }

  const header = buildHeader({ keyId, nonce, compressed: true });
  const key = await deriveSaveKey(secret, payload.deploymentVersion, keyId);

  const cipher = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce as BufferSource, additionalData: header as BufferSource },
      key,
      compressed as BufferSource,
    ),
  );

  const out = new Uint8Array(header.byteLength + cipher.byteLength);
  out.set(header, 0);
  out.set(cipher, header.byteLength);
  return out;
}

export async function decodeSave(
  blob: Uint8Array,
  secret: string,
  expectedDeploymentVersion: string,
): Promise<SavedGamePayload> {
  if (blob.byteLength < HEADER_LEN + 16) {
    throw new SaveDecodeError("magic", "save blob is too short");
  }
  for (let i = 0; i < MAGIC.length; i++) {
    if (blob[i] !== MAGIC[i]) {
      throw new SaveDecodeError("magic", "save blob magic bytes do not match OTSV");
    }
  }
  const containerVersion = blob[4];
  if (containerVersion !== CONTAINER_VERSION) {
    throw new SaveDecodeError(
      "version",
      `unsupported save container version ${containerVersion}`,
    );
  }
  const algoId = blob[5];
  if (algoId !== ALGO_AES_256_GCM_HKDF_SHA256_DEFLATE) {
    throw new SaveDecodeError("version", `unsupported save algorithm ${algoId}`);
  }
  const keyId = blob[6] ?? 0;
  if (keyId < 1) {
    throw new SaveDecodeError("key", `invalid save keyId ${keyId}`);
  }
  const flags = blob[7] ?? 0;
  const compressed = (flags & FLAG_COMPRESSED) !== 0;

  const header = blob.slice(0, HEADER_LEN);
  const nonce = blob.slice(11, 11 + NONCE_LEN);
  const ciphertext = blob.slice(HEADER_LEN);

  const key = await deriveSaveKey(secret, expectedDeploymentVersion, keyId);
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: nonce as BufferSource, additionalData: header as BufferSource },
      key,
      ciphertext as BufferSource,
    );
  } catch {
    throw new SaveDecodeError("auth", "save auth tag verification failed");
  }

  const inner = new Uint8Array(plain);
  const plaintext = compressed ? await inflateRaw(inner) : inner;
  const text = new TextDecoder("utf-8", { fatal: true }).decode(plaintext);

  let parsed: JsonValue;
  try {
    parsed = parseJsonText(text);
  } catch (error) {
    throw new SaveDecodeError(
      "payload",
      `save payload is not valid JSON: ${(error as Error).message}`,
    );
  }

  const payload = parsed as unknown as SavedGamePayload;
  if (payload.deploymentVersion !== expectedDeploymentVersion) {
    throw new SaveDecodeError(
      "version",
      `save deploymentVersion ${payload.deploymentVersion} does not match expected ${expectedDeploymentVersion}`,
    );
  }
  if (payload.saveFormatVersion !== SAVE_FORMAT_VERSION) {
    throw new SaveDecodeError(
      "version",
      `unsupported saveFormatVersion ${payload.saveFormatVersion}`,
    );
  }
  return payload;
}

export async function deriveSaveKey(
  secret: string,
  deploymentVersion: string,
  keyId: number,
): Promise<CryptoKey> {
  const secretBytes = new TextEncoder().encode(secret);
  const baseKey = await crypto.subtle.importKey(
    "raw",
    secretBytes as BufferSource,
    "HKDF",
    false,
    ["deriveKey"],
  );
  const salt = new Uint8Array([keyId & 0xff]);
  const info = new TextEncoder().encode(`openturn-save:${deploymentVersion}`);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: salt as BufferSource, info: info as BufferSource },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function buildHeader(input: {
  keyId: number;
  nonce: Uint8Array;
  compressed: boolean;
}): Uint8Array {
  const header = new Uint8Array(HEADER_LEN);
  header.set(MAGIC, 0);
  header[4] = CONTAINER_VERSION;
  header[5] = ALGO_AES_256_GCM_HKDF_SHA256_DEFLATE;
  header[6] = input.keyId & 0xff;
  header[7] = input.compressed ? FLAG_COMPRESSED : 0x00;
  header[8] = 0;
  header[9] = 0;
  header[10] = 0;
  header.set(input.nonce, 11);
  return header;
}

function randomNonce(): Uint8Array {
  const nonce = new Uint8Array(NONCE_LEN);
  crypto.getRandomValues(nonce);
  return nonce;
}

async function deflateRaw(input: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([input as BlobPart]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  const buffer = await new Response(stream).arrayBuffer();
  return new Uint8Array(buffer);
}

async function inflateRaw(input: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([input as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const buffer = await new Response(stream).arrayBuffer();
  return new Uint8Array(buffer);
}
