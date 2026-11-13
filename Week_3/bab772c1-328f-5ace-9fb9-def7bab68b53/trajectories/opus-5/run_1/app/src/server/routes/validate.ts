/** Field checks shared by the API routes. */

import { parseIsoInstant } from "../../shared/doy.js";
import { codePointLength, hasForbiddenCharacters, normalizeTextField } from "../../shared/text.js";
import type { JsonValue } from "../../shared/canonical.js";

export const CONTROL_CHARACTER_MESSAGE =
  "Remove control characters and line or paragraph separators.";

export type FieldErrors = Record<string, string>;

/** A text field: control characters first, then the trimmed NFC length. */
export function readTextField(
  value: JsonValue | undefined,
  options: { min: number; max: number; lengthMessage: string },
): { ok: true; value: string } | { ok: false; message: string } {
  if (typeof value !== "string") {
    return { ok: false, message: options.lengthMessage };
  }
  if (hasForbiddenCharacters(value)) {
    return { ok: false, message: CONTROL_CHARACTER_MESSAGE };
  }
  const normalised = normalizeTextField(value);
  const length = codePointLength(normalised);
  if (length < options.min || length > options.max) {
    return { ok: false, message: options.lengthMessage };
  }
  return { ok: true, value: normalised };
}

export function readIsoInstant(value: JsonValue | undefined): number | null {
  return typeof value === "string" ? parseIsoInstant(value) : null;
}

export function isObject(value: JsonValue | undefined): value is Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readSubscriberUrl(value: JsonValue | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 2048) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return null;
  }
  if (url.hostname.length === 0 || url.username !== "" || url.password !== "" || url.hash !== "") {
    return null;
  }
  return trimmed;
}
