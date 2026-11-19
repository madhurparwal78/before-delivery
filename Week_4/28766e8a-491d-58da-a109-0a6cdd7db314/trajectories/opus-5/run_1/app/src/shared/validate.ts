import { copy } from './copy.js';
import { LIMITS } from './document.js';

/** A validation failure: dotted paths from the root of the request body to a sentence. */
export type FieldErrors = Record<string, string>;

export type Validated<T> = { ok: true; value: T } | { ok: false; fields: FieldErrors };

export function invalid(path: string, message: string): { ok: false; fields: FieldErrors } {
  return { ok: false, fields: { [path]: message } };
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Reports the dotted path of the first key that is not published for this object, so the
 * caller can answer 422 `invalid` naming it.
 */
export function unpublishedKey(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
): string | null {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) return path === '' ? key : `${path}.${key}`;
  }
  return null;
}

export function joinPath(path: string, key: string | number): string {
  return path === '' ? String(key) : `${path}.${key}`;
}

export function isWholeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

export function wholeNumberInRange(value: unknown, min: number, max: number): value is number {
  return isWholeNumber(value) && value >= min && value <= max;
}

/**
 * The text safety rule. Diagram titles and display names may not contain CR, LF, any
 * other character from U+0000 to U+001F, or U+007F.
 */
export function hasControlCharacters(value: string): boolean {
  for (const unit of value) {
    const code = unit.codePointAt(0) ?? 0;
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

export function validateTitle(value: unknown, path: string): Validated<string> {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return invalid(path, copy.fieldErrors.title);
  }
  if (hasControlCharacters(value)) return invalid(path, copy.fieldErrors.controlCharacters);
  if (value.length < LIMITS.titleMin || value.length > LIMITS.titleMax) {
    return invalid(path, copy.fieldErrors.title);
  }
  return { ok: true, value };
}

export function validateDisplayName(value: unknown, path: string): Validated<string> {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return invalid(path, copy.fieldErrors.name);
  }
  if (hasControlCharacters(value)) return invalid(path, copy.fieldErrors.controlCharacters);
  if (value.length > LIMITS.displayNameMax) return invalid(path, copy.fieldErrors.name);
  return { ok: true, value };
}

const EMAIL = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

export function validateEmail(value: unknown, path: string): Validated<string> {
  if (typeof value !== 'string' || !EMAIL.test(value.trim())) {
    return invalid(path, copy.fieldErrors.email);
  }
  return { ok: true, value: value.trim().toLowerCase() };
}

export function validatePassword(value: unknown, path: string): Validated<string> {
  if (typeof value !== 'string' || value.length < 10) {
    return invalid(path, copy.fieldErrors.password);
  }
  return { ok: true, value };
}

/** Page and layer names are 1 to 60 characters and follow the text safety rule. */
export function validateObjectName(value: unknown, path: string): Validated<string> {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return invalid(path, 'Enter a name.');
  }
  if (hasControlCharacters(value)) return invalid(path, copy.fieldErrors.controlCharacters);
  if (value.length < LIMITS.nameMin || value.length > LIMITS.nameMax) {
    return invalid(path, `Use 1 to ${LIMITS.nameMax} characters.`);
  }
  return { ok: true, value };
}

export function validateLabel(value: unknown, path: string): Validated<string> {
  if (typeof value !== 'string') return invalid(path, 'Enter text.');
  if (value.length > LIMITS.labelMax) return invalid(path, `Use at most ${LIMITS.labelMax} characters.`);
  return { ok: true, value };
}
