import { validationFailed } from './errors.js';
import { fieldCopy } from '../../shared/copy.js';
import { isValidIban, normaliseIban } from '../domain/iban.js';
import { EMAIL_PATTERN } from '../../shared/validate.js';

/** Collects field problems so one 422 answers with all of them. */
export class FieldProblems {
  private readonly fields: Record<string, string> = {};

  add(field: string, message: string): void {
    this.fields[field] ??= message;
  }

  get empty(): boolean {
    return Object.keys(this.fields).length === 0;
  }

  throwIfAny(): void {
    if (!this.empty) throw validationFailed({ ...this.fields });
  }
}

export function isValidEmail(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 254 && EMAIL_PATTERN.test(value.trim());
}

export function readString(body: Record<string, unknown>, key: string): string | null {
  const value = body[key];
  return typeof value === 'string' ? value : null;
}

export function readTrimmed(body: Record<string, unknown>, key: string): string {
  return (readString(body, key) ?? '').trim();
}

export function readInteger(body: Record<string, unknown>, key: string): number | null {
  const value = body[key];
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

export function requireName(
  problems: FieldProblems,
  body: Record<string, unknown>,
  key = 'name',
): string {
  const name = readTrimmed(body, key);
  if (name.length < 1 || name.length > 80) problems.add(key, fieldCopy.name);
  return name;
}

export function requireEmail(
  problems: FieldProblems,
  body: Record<string, unknown>,
  key = 'email',
): string {
  const email = readTrimmed(body, key);
  if (!isValidEmail(email)) problems.add(key, fieldCopy.email);
  return email;
}

/** An optional IBAN: absent or empty is allowed, an invalid one answers 422. */
export function optionalIban(
  problems: FieldProblems,
  body: Record<string, unknown>,
  key = 'iban',
): string | null {
  if (!(key in body) || body[key] === null) return null;
  const raw = readString(body, key);
  if (raw === null) {
    problems.add(key, fieldCopy.iban);
    return null;
  }
  if (raw.trim() === '') return null;
  if (!isValidIban(raw)) {
    problems.add(key, fieldCopy.iban);
    return null;
  }
  return normaliseIban(raw);
}

export function optionalPhone(body: Record<string, unknown>, key = 'phone'): string | null {
  if (!(key in body) || body[key] === null) return null;
  const value = readTrimmed(body, key);
  return value === '' ? null : value;
}
