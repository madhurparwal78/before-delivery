export type FieldErrors = Record<string, string>;

export const GENERIC_FIELD_MESSAGE = 'This field is missing or has the wrong type';
export const BODY_MESSAGE = 'Send a JSON object';
export const UNKNOWN_FIELD_MESSAGE = 'Unknown field';

export interface FieldSpec {
  /** The message answered when the field is missing, null or of the wrong type. */
  message: string;
  optional?: boolean;
  /** Returns a message when the present, non-null value is refused. */
  check(value: unknown): string | null;
}

export type BodySpec = Record<string, FieldSpec>;

export type ParsedBody<T> = { ok: true; value: T } | { ok: false; fields: FieldErrors };

export function isJsonObject(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw);
}

export function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

export function codePointLength(value: string): number {
  return [...value].length;
}

export function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    const control = code <= 0x1f || (code >= 0x7f && code <= 0x9f);
    if (control || code === 0x2028 || code === 0x2029) return true;
  }
  return false;
}

/**
 * The one strict request-body check: a JSON object holding only its endpoint's fields,
 * each present (unless optional) and of the right JSON type.
 */
export function parseBody<T>(raw: unknown, spec: BodySpec): ParsedBody<T> {
  if (!isJsonObject(raw)) return { ok: false, fields: { body: BODY_MESSAGE } };
  const fields: FieldErrors = {};
  for (const key of Object.keys(raw)) {
    if (!Object.prototype.hasOwnProperty.call(spec, key)) fields[key] = UNKNOWN_FIELD_MESSAGE;
  }
  for (const [key, field] of Object.entries(spec)) {
    const present = Object.prototype.hasOwnProperty.call(raw, key);
    if (!present) {
      if (!field.optional) fields[key] = field.message;
      continue;
    }
    const value = raw[key];
    if (value === null) {
      fields[key] = field.message;
      continue;
    }
    const failure = field.check(value);
    if (failure !== null) fields[key] = failure;
  }
  if (Object.keys(fields).length > 0) return { ok: false, fields };
  return { ok: true, value: raw as T };
}

export function stringField(message: string, check: (value: string) => string | null): FieldSpec {
  return {
    message,
    check: (value) => (typeof value === 'string' ? check(value) : message),
  };
}

export function integerField(message: string, check: (value: number) => string | null): FieldSpec {
  return {
    message,
    check: (value) => (isInteger(value) ? check(value) : message),
  };
}
