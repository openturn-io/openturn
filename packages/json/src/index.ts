import { z, ZodError, type ZodIssue } from "zod";

export type JsonPrimitive = null | boolean | number | string;
export type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };
type JsonCompatibleValue<T> =
  T extends JsonPrimitive ? T
    : T extends readonly (infer U)[] ? readonly JsonCompatibleValue<U>[]
    : T extends object ? { [K in keyof T]: JsonCompatibleValue<T[K]> }
    : never;
export type JsonCompatible<T> = [T] extends [JsonCompatibleValue<T>] ? T : never;

export interface JsonValidationIssue {
  code: string;
  message: string;
  path: string;
}

export class InvalidJsonValueError extends Error {
  readonly issues: readonly JsonValidationIssue[];

  constructor(label: string, issues: readonly JsonValidationIssue[]) {
    super(buildErrorMessage(label, issues));
    this.name = "InvalidJsonValueError";
    this.issues = issues;
  }
}

const plainObjectSchema = z.custom<Record<string, unknown>>((value) => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}, {
  error: "Expected a plain object.",
});

export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number().finite(),
    z.string(),
    z.array(JsonValueSchema),
    plainObjectSchema.pipe(z.record(z.string(), JsonValueSchema)),
  ]),
);

export function assertJsonValue(value: unknown, label = "value"): asserts value is JsonValue {
  const parsed = JsonValueSchema.safeParse(value);

  if (parsed.success) {
    return;
  }

  throw new InvalidJsonValueError(label, zodIssuesToValidationIssues(parsed.error.issues));
}

export function parseJsonValue(value: unknown, label = "value"): JsonValue {
  assertJsonValue(value, label);
  return value;
}

export function cloneJsonValue<T>(value: T): T {
  assertJsonValue(value, "value");
  const text = stringifyJson(value);
  return parseJsonText(text) as T;
}

export function stringifyJson<T>(value: T): string {
  assertJsonValue(value, "value");
  return JSON.stringify(value);
}

export function parseJsonText(text: string, label = "value"): JsonValue {
  try {
    return parseJsonValue(JSON.parse(text), label);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new InvalidJsonValueError(label, [{
        code: "invalid_json_text",
        message: error.message,
        path: "$",
      }]);
    }

    throw error;
  }
}

function zodIssuesToValidationIssues(issues: readonly ZodIssue[]): readonly JsonValidationIssue[] {
  return issues.map((issue) => {
    const flattened = selectMostSpecificIssue(issue);
    return {
      code: flattened.code,
      message: flattened.message,
      path: formatIssuePath(flattened),
    };
  });
}

function formatIssuePath(issue: ZodIssue): string {
  if (issue.path.length === 0) {
    return "$";
  }

  let path = "$";

  for (const segment of issue.path) {
    path = typeof segment === "number"
      ? `${path}[${segment}]`
      : `${path}.${String(segment)}`;
  }

  return path;
}

function buildErrorMessage(label: string, issues: readonly JsonValidationIssue[]): string {
  const first = issues[0];

  if (first === undefined) {
    return `${label} is not JSON-serializable.`;
  }

  return `${label} is not JSON-serializable at ${first.path}: ${first.message}`;
}

function selectMostSpecificIssue(issue: ZodIssue): ZodIssue {
  const candidates = collectIssueCandidates(issue);
  return candidates.sort((left, right) => right.path.length - left.path.length)[0] ?? issue;
}

function collectIssueCandidates(issue: ZodIssue): ZodIssue[] {
  if (issue.code !== "invalid_union") {
    return [issue];
  }

  return issue.errors.flatMap((branch) => branch.flatMap((nested) =>
    collectIssueCandidates({
      ...nested,
      path: [...issue.path, ...nested.path],
    })));
}
