import { errors } from '../http/errors';
import { isWellFormedId } from './ids';

export interface KeySpec {
  required?: readonly string[];
  optional?: readonly string[];
  /** PATCH endpoints answer 422 on `body` when they carry none of their optional keys. */
  requireOneOptional?: boolean;
}

export type Body = Record<string, unknown>;

/** The one place that enforces the published request keys of every JSON endpoint. */
export function readKeys(raw: unknown, spec: KeySpec): Body {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw errors.validation({ body: 'Send a JSON object.' });
  }
  const body = raw as Body;
  const allowed = new Set<string>([...(spec.required ?? []), ...(spec.optional ?? [])]);
  const unknown: Record<string, string> = {};
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) unknown[key] = "This field isn't accepted here.";
  }
  if (Object.keys(unknown).length > 0) throw errors.validation(unknown);

  const missing: Record<string, string> = {};
  for (const key of spec.required ?? []) {
    if (!(key in body)) missing[key] = 'This field is required.';
  }
  if (Object.keys(missing).length > 0) throw errors.validation(missing);

  if (spec.requireOneOptional === true) {
    const present = (spec.optional ?? []).some((key) => key in body);
    if (!present) throw errors.validation({ body: 'Send at least one field to change.' });
  }
  return body;
}

export function has(body: Body, key: string): boolean {
  return key in body;
}

export function readString(body: Body, key: string, message: string): string {
  const value = body[key];
  if (typeof value !== 'string') throw errors.validation({ [key]: message });
  return value;
}

export interface TextRules {
  min: number;
  max: number;
  trim?: boolean;
  tooShort: string;
  tooLong: string;
}

export function readText(body: Body, key: string, rules: TextRules): string {
  const raw = readString(body, key, rules.tooShort);
  const value = rules.trim === false ? raw : raw.trim();
  const length = [...value].length;
  if (length < rules.min) throw errors.validation({ [key]: rules.tooShort });
  if (length > rules.max) throw errors.validation({ [key]: rules.tooLong });
  return value;
}

export function readInteger(body: Body, key: string, message: string): number {
  const value = body[key];
  if (typeof value !== 'number' || !Number.isInteger(value)) throw errors.validation({ [key]: message });
  return value;
}

export function readEnum<T extends string>(body: Body, key: string, allowed: readonly T[], message: string): T {
  const value = body[key];
  if (typeof value !== 'string' || !allowed.includes(value as T)) throw errors.validation({ [key]: message });
  return value as T;
}

/** Published id keys answer the plain not-found for anything they cannot name. */
export function readId(body: Body, key: string): string {
  const value = body[key];
  if (typeof value !== 'string' || !isWellFormedId(value)) throw errors.notFound();
  return value;
}

export function readIdList(body: Body, key: string, message: string): string[] {
  const value = body[key];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw errors.validation({ [key]: message });
  }
  const ids = value as string[];
  if (ids.some((id) => !isWellFormedId(id))) throw errors.notFound();
  return ids;
}

export function readNullableString(body: Body, key: string, message: string): string | null {
  const value = body[key];
  if (value === null) return null;
  if (typeof value !== 'string') throw errors.validation({ [key]: message });
  return value;
}
