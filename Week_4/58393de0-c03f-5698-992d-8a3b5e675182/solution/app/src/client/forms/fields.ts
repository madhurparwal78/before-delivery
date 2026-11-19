import type { ApiError } from "../lib/api";

/** The entries of a 422 `fields` object that belong to the given form fields. */
export function fieldErrors<K extends string>(error: ApiError, keys: readonly K[]): Partial<Record<K, string>> {
  const found: Partial<Record<K, string>> = {};
  for (const key of keys) {
    const message = error.fields[key];
    if (message) found[key] = message;
  }
  return found;
}
