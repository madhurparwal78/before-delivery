import { apiError, type FieldMessages } from './errors';

export class FieldErrors {
  private readonly messages: FieldMessages = {};

  add(field: string, message: string): void {
    if (this.messages[field] === undefined) this.messages[field] = message;
  }

  get any(): boolean {
    return Object.keys(this.messages).length > 0;
  }

  throwIfAny(): void {
    if (this.any) throw apiError.validation({ ...this.messages });
  }
}

export function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function trimmedString(value: unknown): string | null {
  return typeof value === 'string' ? value.trim() : null;
}

export function lengthWithin(value: string | null, min: number, max: number): boolean {
  return value !== null && value.length >= min && value.length <= max;
}

export function wholeNumberWithin(value: unknown, min: number, max: number): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) return null;
  return value >= min && value <= max ? value : null;
}

/** A decimal with at most `places` places, returned scaled to an integer. */
export function scaledDecimal(value: unknown, places: number): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const scale = 10 ** places;
  const scaled = Math.round(value * scale);
  return Math.abs(value * scale - scaled) < 1e-9 ? scaled : null;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

export function isEmailAddress(value: string | null): boolean {
  return value !== null && value.length <= 254 && EMAIL_PATTERN.test(value);
}
