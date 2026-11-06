import type { Bilingual } from '../../shared/catalog.js';
import { FIELD_MESSAGES } from '../../shared/copy.js';
import type { FieldErrors } from './errors.js';

export type Report = (path: string, message: Bilingual) => void;

export type Reader<T> = (raw: unknown, path: string, report: Report) => T;

const MISSING = Symbol('missing');

const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F]/;
const CONTROL_EXCEPT_NEWLINES = /[\u0000-\u0009\u000B\u000C\u000E-\u001F\u007F]/;
const EMAIL_FORBIDDEN = /[\s,;<>"'\u0000-\u001F\u007F]/;

export function isSingleLineText(value: string): boolean {
  return !CONTROL_CHARACTERS.test(value);
}

export function isValidEmail(value: string): boolean {
  if (value.length < 3 || value.length > 254) return false;
  if (EMAIL_FORBIDDEN.test(value)) return false;
  const at = value.indexOf('@');
  if (at <= 0 || at !== value.lastIndexOf('@')) return false;
  const domain = value.slice(at + 1);
  const dot = domain.indexOf('.');
  return dot > 0 && dot < domain.length - 1;
}

export function isMultiLineText(value: string): boolean {
  return !CONTROL_EXCEPT_NEWLINES.test(value);
}

export const POSTAL_CODE = /^[A-Za-z]\d[A-Za-z][ -]?\d[A-Za-z]\d$/;

function asString(raw: unknown): string | null {
  return typeof raw === 'string' ? raw : null;
}

export function boundedText(
  message: Bilingual,
  min: number,
  max: number,
): Reader<string> {
  return (raw, path, report) => {
    const value = asString(raw);
    if (value === null || !isSingleLineText(value)) {
      report(path, message);
      return '';
    }
    const trimmed = value.trim();
    if (trimmed.length < min || trimmed.length > max) {
      report(path, message);
      return '';
    }
    return trimmed;
  };
}

export const readEmail: Reader<string> = (raw, path, report) => {
  const value = asString(raw);
  if (value === null || !isValidEmail(value.trim())) {
    report(path, FIELD_MESSAGES.email);
    return '';
  }
  return value.trim().toLowerCase();
};

export const readPostalCode: Reader<string> = (raw, path, report) => {
  const value = asString(raw);
  if (value === null || !isSingleLineText(value) || !POSTAL_CODE.test(value.trim())) {
    report(path, FIELD_MESSAGES.postal_code);
    return '';
  }
  const compact = value.trim().replace(/[ -]/, '').toUpperCase();
  return `${compact.slice(0, 3)} ${compact.slice(3)}`;
};

export function readLiteral<T extends string>(
  allowed: readonly T[],
  message: Bilingual,
): Reader<T> {
  return (raw, path, report) => {
    const value = asString(raw);
    if (value === null || !(allowed as readonly string[]).includes(value)) {
      report(path, message);
      return allowed[0] as T;
    }
    return value as T;
  };
}

export function readInteger(min: number, max: number, message: Bilingual): Reader<number> {
  return (raw, path, report) => {
    if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < min || raw > max) {
      report(path, message);
      return min;
    }
    return raw;
  };
}

export function readBoolean(message: Bilingual): Reader<boolean> {
  return (raw, path, report) => {
    if (typeof raw !== 'boolean') {
      report(path, message);
      return false;
    }
    return raw;
  };
}

export function readStringList(message: Bilingual, min: number): Reader<string[]> {
  return (raw, path, report) => {
    if (!Array.isArray(raw) || raw.length < min || raw.some((item) => typeof item !== 'string')) {
      report(path, message);
      return [];
    }
    return raw as string[];
  };
}

export function readList<T>(item: Reader<T>, message: Bilingual, min: number): Reader<T[]> {
  return (raw, path, report) => {
    if (!Array.isArray(raw) || raw.length < min) {
      report(path, message);
      return [];
    }
    return raw.map((entry, index) => item(entry, `${path}.${index}`, report));
  };
}

export type Shape = Record<string, Reader<unknown>>;

export type Infer<S extends Shape> = { [K in keyof S]: S[K] extends Reader<infer T> ? T : never };

/**
 * An object closed to its declared keys. Unknown keys are reported at their dotted path; a missing
 * or non-object value makes every declared field report its own message under that same path.
 */
export function readShape<S extends Shape>(shape: S): Reader<Infer<S>> {
  return (raw, path, report) => {
    const prefix = path === '' ? '' : `${path}.`;
    const isObject = raw !== null && typeof raw === 'object' && !Array.isArray(raw);
    const source = isObject ? (raw as Record<string, unknown>) : {};
    if (isObject) {
      for (const key of Object.keys(source)) {
        if (!(key in shape)) report(`${prefix}${key}`, FIELD_MESSAGES.unknown_key);
      }
    }
    const out: Record<string, unknown> = {};
    for (const [key, reader] of Object.entries(shape)) {
      out[key] = reader(key in source ? source[key] : MISSING, `${prefix}${key}`, report);
    }
    return out as Infer<S>;
  };
}

export function optional<T>(reader: Reader<T>): Reader<T | undefined> {
  return (raw, path, report) => (raw === MISSING ? undefined : reader(raw, path, report));
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; fields: FieldErrors };

export function parseBody<S extends Shape>(raw: unknown, shape: S): ParseResult<Infer<S>> {
  const fields: FieldErrors = {};
  const report: Report = (path, message) => {
    if (!(path in fields)) fields[path] = message;
  };
  const value = readShape(shape)(raw ?? {}, '', report);
  if (Object.keys(fields).length > 0) return { ok: false, fields };
  return { ok: true, value };
}
