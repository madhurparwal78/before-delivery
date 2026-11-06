import { FIELD_MESSAGES, MISSING_FIELD_MESSAGE, UNKNOWN_FIELD_MESSAGE } from '../../shared/messages.js';
import { isKnownTimeZone } from '../domain/localtime.js';
import { failValidation } from './errors.js';

export const MAX_ID = 9_007_199_254_740_991;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;
const DISPLAY_NAME_PATTERN = /^[\p{L}\p{N} _-]{3,20}$/u;
const ID_PATTERN = /^(?:0|[1-9][0-9]*)$/;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

export class FieldErrors {
  private readonly errors: Record<string, string> = {};

  add(field: string, message: string): void {
    if (!(field in this.errors)) this.errors[field] = message;
  }

  get empty(): boolean {
    return Object.keys(this.errors).length === 0;
  }

  throwIfAny(): void {
    if (!this.empty) failValidation(this.errors);
  }
}

export function checkFields(
  body: Record<string, unknown>,
  allowed: readonly string[],
  required: readonly string[],
  errors: FieldErrors
): void {
  for (const key of Object.keys(body)) {
    if (!allowed.includes(key)) errors.add(key, UNKNOWN_FIELD_MESSAGE);
  }
  for (const key of required) {
    if (body[key] === undefined) errors.add(key, MISSING_FIELD_MESSAGE);
  }
}

export function isValidPathId(raw: string): boolean {
  if (!ID_PATTERN.test(raw)) return false;
  if (raw === '0') return false;
  const value = Number(raw);
  return value >= 1 && value <= MAX_ID;
}

export function parseBodyId(value: unknown): number | null {
  if (typeof value === 'number') {
    if (!Number.isInteger(value) || value < 1 || value > MAX_ID) return null;
    return value;
  }
  if (typeof value === 'string') {
    if (!ID_PATTERN.test(value) || value === '0') return null;
    const parsed = Number(value);
    if (parsed < 1 || parsed > MAX_ID) return null;
    return parsed;
  }
  return null;
}

export function readEmail(body: Record<string, unknown>, errors: FieldErrors): string {
  const value = body.email;
  if (typeof value !== 'string') {
    if (value !== undefined) errors.add('email', FIELD_MESSAGES.email);
    return '';
  }
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 254 || !EMAIL_PATTERN.test(trimmed)) {
    errors.add('email', FIELD_MESSAGES.email);
    return '';
  }
  return trimmed;
}

export function readPassword(
  body: Record<string, unknown>,
  field: string,
  errors: FieldErrors
): string {
  const value = body[field];
  if (typeof value !== 'string') {
    if (value !== undefined) errors.add(field, FIELD_MESSAGES.password);
    return '';
  }
  if (value.length < 10 || value.length > 128) {
    errors.add(field, FIELD_MESSAGES.password);
    return '';
  }
  return value;
}

export function readDisplayName(body: Record<string, unknown>, errors: FieldErrors): string {
  const value = body.displayName;
  if (typeof value !== 'string' || !DISPLAY_NAME_PATTERN.test(value)) {
    if (value !== undefined) errors.add('displayName', FIELD_MESSAGES.displayName);
    return '';
  }
  return value;
}

export function readTimeZone(body: Record<string, unknown>, errors: FieldErrors): string {
  const value = body.timeZone;
  if (typeof value !== 'string' || value.length === 0 || !isKnownTimeZone(value)) {
    if (value !== undefined) errors.add('timeZone', FIELD_MESSAGES.timeZone);
    return '';
  }
  return value;
}

export function readToken(body: Record<string, unknown>, errors: FieldErrors): string {
  const value = body.token;
  if (typeof value !== 'string' || value.trim().length === 0) {
    if (value !== undefined) errors.add('token', FIELD_MESSAGES.token);
    return '';
  }
  return value;
}

export function isValidIdempotencyKey(key: string): boolean {
  return IDEMPOTENCY_KEY_PATTERN.test(key);
}

export function readIntegerQuery(
  value: string | null,
  bounds: { min: number; max: number }
): number | null {
  if (value === null) return null;
  if (!/^-?(?:0|[1-9][0-9]*)$/.test(value)) return null;
  const parsed = Number(value);
  if (parsed < bounds.min || parsed > bounds.max) return null;
  return parsed;
}
