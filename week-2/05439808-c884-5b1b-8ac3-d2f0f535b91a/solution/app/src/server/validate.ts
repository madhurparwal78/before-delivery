// Exact-field request validation with the brief's field messages.
import { fieldErrors } from './errors';

export const REQUIRED = 'This field is required.';
export const UNKNOWN = 'unknown field';

export const MESSAGES = {
  email: 'Enter a valid email address.',
  password: 'Use 10 to 128 characters.',
  displayName: 'Use 3 to 20 letters, digits, spaces, hyphens or underscores.',
  timeZone: 'Choose a time zone from the list.',
  token: 'This link is incomplete.',
  type: 'Choose a building from the catalog.',
  cell: 'Keep the whole building inside the build area.',
  rotation: 'Use 0, 90, 180 or 270.',
  unit: 'Choose Saltjack or Peat Slinger.',
  trainCount: 'Choose 1 to 20.',
  requestCount: 'Choose 1 to 6.',
  donationCount: 'Choose 1 to 3.',
  villageId: 'Use a village ID.',
  deploys: 'Send 1 to 50 deploys, and at most 200 in one raid.',
  deployTick: "Use a tick from 0 to 1,799, never earlier than the one before.",
  deployCell: 'Deploy on the tidal ring.',
  clanName: 'Use 3 to 24 characters.',
  motto: 'Use at most 80 characters.',
  body: 'Write 1 to 500 characters.',
  limit: 'Use 1 to 100.',
  listId: 'Use an ID from this list.',
  snapshotTick: "Use a tick from 0 to the raid's final tick.",
  raidRole: 'Use attack or defence.',
  idempotencyKey: 'Send an Idempotency-Key of 8 to 64 letters, digits, hyphens or underscores.',
} as const;

/** Collects field errors for one JSON body that accepts exactly `allowed` keys. */
export class Fields {
  readonly errors: Record<string, string> = {};
  private readonly source: Record<string, unknown>;

  constructor(body: unknown, allowed: readonly string[]) {
    this.source = typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
    for (const key of Object.keys(this.source)) if (!allowed.includes(key)) this.errors[key] = UNKNOWN;
  }

  has(key: string): boolean {
    return key in this.source;
  }

  /** A required field: missing answers "This field is required.", invalid answers `message`. */
  take<T>(key: string, check: (value: unknown) => value is T, message: string): T | undefined {
    if (!(key in this.source)) {
      this.errors[key] = REQUIRED;
      return undefined;
    }
    return this.optional(key, check, message);
  }

  optional<T>(key: string, check: (value: unknown) => value is T, message: string): T | undefined {
    if (!(key in this.source)) return undefined;
    const value = this.source[key];
    if (!check(value)) {
      this.errors[key] = message;
      return undefined;
    }
    return value;
  }

  raw(key: string): unknown {
    return this.source[key];
  }

  fail(key: string, message: string): void {
    this.errors[key] = message;
  }

  /** Throws 422 when any field failed. */
  done(): void {
    if (Object.keys(this.errors).length > 0) fieldErrors(this.errors);
  }
}

export const isString = (v: unknown): v is string => typeof v === 'string';
export const isInteger = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

export function isEmail(v: unknown): v is string {
  return typeof v === 'string' && v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

export const isPassword = (v: unknown): v is string => typeof v === 'string' && v.length >= 10 && v.length <= 128;
export const isDisplayName = (v: unknown): v is string => typeof v === 'string' && /^[\p{L}\p{N} _-]{3,20}$/u.test(v);

export function intIn(min: number, max: number): (v: unknown) => v is number {
  return (v: unknown): v is number => isInteger(v) && v >= min && v <= max;
}

/** Throws 422 for a single query or header field. */
export function rejectField(key: string, message: string): never {
  return fieldErrors({ [key]: message });
}
