const originalGlobals = new Map<PropertyKey, unknown>();

export function stubGlobal<TKey extends keyof typeof globalThis>(
  key: TKey,
  value: (typeof globalThis)[TKey],
): void {
  if (!originalGlobals.has(key)) {
    originalGlobals.set(key, globalThis[key]);
  }

  Object.defineProperty(globalThis, key, {
    configurable: true,
    value,
    writable: true,
  });
}

export function unstubAllGlobals(): void {
  for (const [key, value] of originalGlobals) {
    Object.defineProperty(globalThis, key, {
      configurable: true,
      value,
      writable: true,
    });
  }

  originalGlobals.clear();
}
