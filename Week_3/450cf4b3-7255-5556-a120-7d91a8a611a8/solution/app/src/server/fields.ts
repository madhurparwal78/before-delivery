// Field readers for request validation. Each writes its sentence into `errors` and returns a
// placeholder when the field fails, so every failing field is reported at once.

import { isDate } from "../shared/clock.js";
import type { FieldErrors } from "./errors.js";

export const FILL_IN = "Fill in this field.";
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string | null | undefined): value is string {
  return typeof value === "string" && UUID.test(value);
}

export function text(source: Readonly<Record<string, unknown>>, name: string, errors: FieldErrors,
  limits: { min: number; max: number; tooShort?: string }): string {
  const value = source[name];
  if (typeof value !== "string" || value.trim() === "") {
    errors[name] = FILL_IN;
    return "";
  }
  if (value.length < limits.min) errors[name] = limits.tooShort ?? `Use at least ${limits.min} characters.`;
  else if (value.length > limits.max) errors[name] = `Use at most ${limits.max} characters.`;
  return value;
}

/** An ISO 8601 instant with an explicit offset or Z, as epoch milliseconds; null when it is not one. */
export function parseInstant(value: unknown): number | null {
  if (typeof value !== "string" || !INSTANT.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

export function date(value: string | null | undefined, name: string, errors: FieldErrors): string {
  if (typeof value !== "string" || !isDate(value)) {
    errors[name] = "Give a real calendar date as YYYY-MM-DD.";
    return "";
  }
  return value;
}
