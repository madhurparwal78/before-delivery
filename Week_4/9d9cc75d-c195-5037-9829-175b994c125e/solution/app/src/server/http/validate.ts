// Narrowing helpers for request bodies: validate, never cast.

export type JsonObject = Record<string, unknown>;

export function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isString(value: unknown): value is string {
  return typeof value === 'string';
}

export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isString);
}

/** A string that holds something after trimming, else null. */
export function nonBlank(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}
