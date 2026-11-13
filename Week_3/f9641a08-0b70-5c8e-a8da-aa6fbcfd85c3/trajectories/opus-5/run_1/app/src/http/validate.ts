import { FIELD_COPY, validationFailed } from '../errors';
import { INDIAN_STATES } from '../domain/constants';

export class FieldErrors {
  private readonly fields: Record<string, string> = {};

  add(key: string, copy: string): void {
    if (!(key in this.fields)) this.fields[key] = copy;
  }

  get any(): boolean {
    return Object.keys(this.fields).length > 0;
  }

  get all(): Record<string, string> {
    return { ...this.fields };
  }

  throwIfAny(): void {
    if (this.any) throw validationFailed(this.all);
  }
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function readString(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  return typeof value === 'string' ? value : null;
}

export function readInteger(source: Record<string, unknown>, key: string): number | null {
  const value = source[key];
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  return null;
}

export function readBoolean(source: Record<string, unknown>, key: string): boolean | null {
  const value = source[key];
  return typeof value === 'boolean' ? value : null;
}

export function readStringArray(source: Record<string, unknown>, key: string): string[] | null {
  const value = source[key];
  if (!Array.isArray(value)) return null;
  if (!value.every((item) => typeof item === 'string')) return null;
  return value as string[];
}

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;
export const PHONE_PATTERN = /^[0-9]{10}$/;
export const POSTCODE_PATTERN = /^[0-9]{6}$/;

export type AddressInput = {
  name: string;
  line1: string;
  line2: string;
  city: string;
  state: string;
  postcode: string;
  phone: string;
};

export function validateAddress(
  source: Record<string, unknown>,
  errors: FieldErrors,
  prefix: string
): AddressInput {
  const name = (readString(source, 'name') ?? '').trim();
  const line1 = (readString(source, 'line1') ?? '').trim();
  const line2 = readString(source, 'line2') ?? '';
  const city = (readString(source, 'city') ?? '').trim();
  const state = (readString(source, 'state') ?? '').trim();
  const postcode = (readString(source, 'postcode') ?? '').trim();
  const phone = (readString(source, 'phone') ?? '').trim();

  if (name.length < 1 || name.length > 80) errors.add(`${prefix}name`, FIELD_COPY.addressName);
  if (line1.length < 1 || line1.length > 120) errors.add(`${prefix}line1`, FIELD_COPY.line1);
  if (line2.length > 100) errors.add(`${prefix}line2`, FIELD_COPY.line2);
  if (city.length < 1 || city.length > 80) errors.add(`${prefix}city`, FIELD_COPY.city);
  if (!INDIAN_STATES.includes(state)) errors.add(`${prefix}state`, FIELD_COPY.state);
  if (!POSTCODE_PATTERN.test(postcode)) errors.add(`${prefix}postcode`, FIELD_COPY.postcode);
  if (!PHONE_PATTERN.test(phone)) errors.add(`${prefix}phone`, FIELD_COPY.phone);

  return { name, line1, line2, city, state, postcode, phone };
}

export function validateCard(
  source: Record<string, unknown>,
  errors: FieldErrors,
  now: Date
): { number: string; expiry: string; cvc: string } {
  const number = (readString(source, 'number') ?? '').replace(/\s+/g, '');
  const expiry = (readString(source, 'expiry') ?? '').trim();
  const cvc = (readString(source, 'cvc') ?? '').trim();

  if (!/^[0-9]{16}$/.test(number)) errors.add('card.number', FIELD_COPY.cardNumber);
  const expiryMatch = /^(0[1-9]|1[0-2])\/([0-9]{2})$/.exec(expiry);
  if (expiryMatch === null) {
    errors.add('card.expiry', FIELD_COPY.cardExpiry);
  } else {
    const month = Number(expiryMatch[1]);
    const year = 2000 + Number(expiryMatch[2]);
    const nowYear = now.getUTCFullYear();
    const nowMonth = now.getUTCMonth() + 1;
    if (year < nowYear || (year === nowYear && month < nowMonth)) {
      errors.add('card.expiry', FIELD_COPY.cardExpiry);
    }
  }
  if (!/^[0-9]{3}$/.test(cvc)) errors.add('card.cvc', FIELD_COPY.cardCvc);

  return { number, expiry, cvc };
}

export function validateIdempotencyKey(value: string | undefined, required: boolean): string | null {
  if (value === undefined || value === '') {
    if (required) throw validationFailed({ 'Idempotency-Key': FIELD_COPY.idempotencyKey });
    return null;
  }
  if (value.length < 8 || value.length > 128) {
    throw validationFailed({ 'Idempotency-Key': FIELD_COPY.idempotencyKey });
  }
  return value;
}

export function parseIsoDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function parseDateTime(value: string): Date | null {
  if (value.trim() === '') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
