type Primitive = bigint | boolean | null | number | string | symbol | undefined;

export type DeepReadonly<T> =
  T extends Primitive ? T
    : T extends (...args: any[]) => unknown ? T
      : T extends readonly (infer TItem)[] ? readonly DeepReadonly<TItem>[]
        : T extends object ? { readonly [TKey in keyof T]: DeepReadonly<T[TKey]> }
          : T;

export function createReadonlyValue<TValue>(value: TValue): DeepReadonly<TValue> {
  return deepFreeze(structuredClone(value)) as DeepReadonly<TValue>;
}

function deepFreeze<TValue>(value: TValue): TValue {
  if (value === null || typeof value !== "object") {
    return value;
  }

  Object.freeze(value);

  for (const nested of Object.values(value as Record<string, unknown>)) {
    deepFreeze(nested);
  }

  return value;
}
