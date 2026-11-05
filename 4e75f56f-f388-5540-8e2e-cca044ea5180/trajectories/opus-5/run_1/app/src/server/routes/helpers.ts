import type { Account } from '../db/accounts.js';
import type { ReservationRow } from '../db/reservations.js';
import { validation } from '../http/errors.js';

export class FieldErrors {
  private readonly errors: Record<string, string> = {};

  add(field: string, message: string): void {
    if (this.errors[field] === undefined) this.errors[field] = message;
  }

  get any(): boolean {
    return Object.keys(this.errors).length > 0;
  }

  throwIfAny(): void {
    if (this.any) throw validation(this.errors);
  }
}

export function fieldError(field: string, message: string): never {
  throw validation({ [field]: message });
}

export function readString(
  body: Record<string, unknown>,
  field: string,
  min: number,
  max: number,
  errors: FieldErrors,
): string {
  const value = body[field];
  if (typeof value !== 'string') {
    errors.add(field, `Enter ${field.replace(/_/g, ' ')}.`);
    return '';
  }
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) {
    errors.add(field, `Use ${min} to ${max} characters.`);
    return trimmed;
  }
  return trimmed;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

export function readEmail(
  body: Record<string, unknown>,
  field: string,
  errors: FieldErrors,
): string {
  const value = body[field];
  if (typeof value !== 'string' || !EMAIL_PATTERN.test(value.trim()) || value.trim().length > 200) {
    errors.add(field, 'Enter a valid email address.');
    return '';
  }
  return value.trim();
}

export function readInteger(
  body: Record<string, unknown>,
  field: string,
  min: number,
  max: number,
  errors: FieldErrors,
): number {
  const value = body[field];
  const parsed = typeof value === 'number' ? value : Number.NaN;
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    errors.add(field, `Enter a whole number from ${min} to ${max}.`);
    return min;
  }
  return parsed;
}

export function readBillingName(body: Record<string, unknown>): string {
  const errors = new FieldErrors();
  const name = readString(body, 'billing_name', 1, 120, errors);
  errors.throwIfAny();
  return name;
}

export function isBuyer(reservation: Pick<ReservationRow, 'buyer_id'>, account: Account): boolean {
  return reservation.buyer_id === account.id;
}

export function isAttendee(
  reservation: Pick<ReservationRow, 'attendee_account_id'>,
  account: Account,
): boolean {
  return reservation.attendee_account_id === account.id;
}

export function isRegistrar(account: Account): boolean {
  return account.role === 'registrar';
}
