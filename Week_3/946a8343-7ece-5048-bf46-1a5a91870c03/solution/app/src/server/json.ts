// The one test for "a JSON object" (arrays and null are not).
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// `value` is one of the allowed literals (a narrowing `includes`).
export function isOneOf<T extends string>(allowed: readonly T[], value: unknown): value is T {
  return allowed.some((item) => item === value);
}
