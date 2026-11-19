/** True for a JSON object: not null and not a list. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The object a request body holds, or an empty object when it holds something else. */
export function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}
