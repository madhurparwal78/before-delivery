import { FieldErrors, invalid } from '../http/errors.js';

export const TEXT_BYTE_LIMIT = 1_000_000;

/** U+0000 and unpaired UTF-16 surrogates can never be stored. */
export function isUnstorableText(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit === 0) return true;
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = index + 1 < value.length ? value.charCodeAt(index + 1) : 0;
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return true;
    }
  }
  return false;
}

export const UNSTORABLE_MESSAGE = 'This text contains a character that cannot be stored.';

/** Rejects any key the endpoint does not publish. */
export function allowedKeys(body: Record<string, unknown>, allowed: readonly string[]): void {
  const errors: FieldErrors = {};
  for (const key of Object.keys(body)) {
    if (!allowed.includes(key)) errors[key] = 'Unknown field.';
  }
  if (Object.keys(errors).length > 0) throw invalid(errors);
}

export class FieldCheck {
  private readonly errors: FieldErrors = {};

  constructor(private readonly body: Record<string, unknown>) {}

  fail(field: string, message: string): void {
    if (this.errors[field] === undefined) this.errors[field] = message;
  }

  has(field: string): boolean {
    return Object.prototype.hasOwnProperty.call(this.body, field);
  }

  raw(field: string): unknown {
    return this.body[field];
  }

  /** A storable string, or null with the field marked invalid. */
  text(field: string, options: { min: number; max: number; trim?: boolean }): string | null {
    const value = this.body[field];
    if (typeof value !== 'string') {
      this.fail(field, 'Expected text.');
      return null;
    }
    if (isUnstorableText(value)) {
      this.fail(field, UNSTORABLE_MESSAGE);
      return null;
    }
    const candidate = options.trim ? value.trim() : value;
    if (candidate.length < options.min || candidate.length > options.max) {
      this.fail(field, 'Out of range.');
      return null;
    }
    return candidate;
  }

  integer(field: string, options: { min: number }): number | null {
    const value = this.body[field];
    if (typeof value !== 'number' || !Number.isInteger(value) || value < options.min) {
      this.fail(field, 'Expected a whole number.');
      return null;
    }
    return value;
  }

  done(): void {
    if (Object.keys(this.errors).length > 0) throw invalid(this.errors);
  }
}

const CONTROL_OR_BREAK = /[\u0000-\u001f\u007f]/;

export function checkTitle(body: Record<string, unknown>): string {
  const check = new FieldCheck(body);
  const title = check.text('title', { min: 1, max: 120 });
  if (title !== null && CONTROL_OR_BREAK.test(title)) {
    check.fail('title', 'Out of range.');
  }
  check.done();
  return title as string;
}

export function checkDisplayName(body: Record<string, unknown>, field = 'displayName'): string {
  const check = new FieldCheck(body);
  const name = check.text(field, { min: 1, max: 80, trim: true });
  check.done();
  return name as string;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

export function normaliseEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function checkEmail(body: Record<string, unknown>, field = 'email'): string {
  const check = new FieldCheck(body);
  const value = check.text(field, { min: 3, max: 254, trim: true });
  if (value !== null && !EMAIL_PATTERN.test(value)) {
    check.fail(field, 'Enter a valid email address.');
  }
  check.done();
  return (value as string).trim();
}

export function checkTextContent(
  body: Record<string, unknown>,
  field = 'content',
): string {
  const check = new FieldCheck(body);
  const value = check.text(field, { min: 0, max: TEXT_BYTE_LIMIT });
  if (value !== null && Buffer.byteLength(value, 'utf8') > TEXT_BYTE_LIMIT) {
    check.fail(field, 'Out of range.');
  }
  check.done();
  return value as string;
}

export function invalidRole(): never {
  throw invalid({ role: 'Unknown role.' });
}

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{1,64}$/;

export function checkIdempotencyKey(value: string | undefined): string | null {
  if (value === undefined) return null;
  if (!IDEMPOTENCY_KEY.test(value)) {
    throw invalid({ idempotencyKey: 'Out of range.' });
  }
  return value;
}
