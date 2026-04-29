import { describe, expect, test } from "bun:test";

import {
  InvalidJsonValueError,
  JsonValueSchema,
  assertJsonValue,
  cloneJsonValue,
  parseJsonText,
  stringifyJson,
} from "./index";

describe("@openturn/json", () => {
  test("accepts nested JSON-safe values", () => {
    const value = {
      ok: true,
      nested: [1, "two", null, { three: 3 }],
    };

    expect(JsonValueSchema.parse(value)).toEqual(value);
    expect(cloneJsonValue(value)).toEqual(value);
  });

  test("rejects undefined and non-finite numbers", () => {
    expect(() => assertJsonValue(undefined)).toThrow(InvalidJsonValueError);
    expect(() => assertJsonValue(Number.NaN)).toThrow(InvalidJsonValueError);
    expect(() => assertJsonValue(Number.POSITIVE_INFINITY)).toThrow(InvalidJsonValueError);
  });

  test("rejects non-plain objects", () => {
    expect(() => assertJsonValue(new Date())).toThrow(InvalidJsonValueError);
    expect(() => assertJsonValue(new Map())).toThrow(InvalidJsonValueError);
    expect(() => assertJsonValue(new Set())).toThrow(InvalidJsonValueError);
    expect(() => assertJsonValue(/ok/u)).toThrow(InvalidJsonValueError);
  });

  test("round-trips valid JSON text", () => {
    const text = stringifyJson({ items: [1, 2, 3], ok: true });
    expect(parseJsonText(text)).toEqual({ items: [1, 2, 3], ok: true });
  });

  test("reports nested paths", () => {
    try {
      assertJsonValue({ nested: [1, { bad: new Date() }] });
      throw new Error("expected parse to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidJsonValueError);
      expect((error as InvalidJsonValueError).issues[0]?.path).toBe("$.nested[1].bad");
    }
  });
});
