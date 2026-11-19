import { ValidationError, invalidField } from '../http/errors.js';
import type { FieldErrors } from '../http/errors.js';

/** Inclusive ranges from Business rules; the only place each limit is written. */
export const RANGES = {
  eventPrice: { min: 1, max: 99 },
  pairPrice: { min: 1, max: 1_000_000 },
  quantity: { min: 1, max: 100_000 },
  depositAmountCents: { min: 500, max: 500_000 },
  feeBps: { min: 0, max: 1_000 },
  displayName: { min: 1, max: 60 },
  keyName: { min: 1, max: 40 },
  password: { min: 12, max: 128 },
  symbol: { min: 2, max: 12 },
  title: { min: 1, max: 120 },
  venueSlug: { min: 3, max: 20 },
  venueName: { min: 1, max: 60 },
  memberQuery: { min: 1, max: 60 },
  endpointUrl: { max: 500 },
  documentBytes: { min: 1, max: 5_000_000 },
  jsonBodyBytes: 65_536,
} as const;

export const UNKNOWN_FIELD = 'unknown_field';

/** Request bodies accept only their listed fields; any other key is refused. */
export function onlyFields(body: Record<string, unknown>, allowed: readonly string[]): void {
  const errors: FieldErrors = {};
  for (const key of Object.keys(body)) {
    if (!allowed.includes(key)) errors[key] = UNKNOWN_FIELD;
  }
  if (Object.keys(errors).length > 0) throw new ValidationError(errors);
}

export function asObject(body: unknown): Record<string, unknown> {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new ValidationError({ body: 'invalid' });
  }
  return body as Record<string, unknown>;
}

export function readString(body: Record<string, unknown>, field: string): string {
  const value = body[field];
  if (typeof value !== 'string') throw invalidField(field);
  return value;
}

export function readInteger(body: Record<string, unknown>, field: string): number {
  const value = body[field];
  if (typeof value !== 'number' || !Number.isInteger(value)) throw invalidField(field);
  return value;
}

export function readEnum<T extends string>(
  body: Record<string, unknown>,
  field: string,
  allowed: readonly T[],
): T {
  const value = body[field];
  if (typeof value !== 'string' || !allowed.includes(value as T)) throw invalidField(field);
  return value as T;
}

export function inRange(value: number, range: { min: number; max: number }): boolean {
  return value >= range.min && value <= range.max;
}

export function requireRange(
  value: number,
  range: { min: number; max: number },
  field: string,
  code = 'out_of_range',
): number {
  if (!inRange(value, range)) throw new ValidationError({ [field]: code });
  return value;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function isEmail(value: string): boolean {
  return value.length <= 254 && EMAIL.test(value);
}

/** Luhn check for a 13 to 19 digit card number, spaces allowed. */
export function digitsOfValidCard(raw: string): string | null {
  const digits = raw.replace(/ /g, '');
  if (!/^\d{13,19}$/.test(digits)) return null;
  let sum = 0;
  let double = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = digits.charCodeAt(index) - 48;
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0 ? digits : null;
}

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{1,64}$/;
export function validIdempotencyKey(value: string): boolean {
  return IDEMPOTENCY_KEY.test(value);
}

/** PDF, PNG or JPEG judged by its bytes. */
export function sniffDocumentType(bytes: Buffer): 'application/pdf' | 'image/png' | 'image/jpeg' | null {
  if (bytes.length >= 5 && bytes.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  return null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(value: string): boolean {
  return UUID.test(value);
}

export function isMonth(value: string): boolean {
  if (!/^\d{4}-\d{2}$/.test(value)) return false;
  const month = Number.parseInt(value.slice(5), 10);
  return month >= 1 && month <= 12;
}

export function isIanaZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}
