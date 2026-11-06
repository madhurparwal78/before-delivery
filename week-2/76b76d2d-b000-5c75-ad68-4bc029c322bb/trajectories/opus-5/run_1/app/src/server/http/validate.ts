import { ApiError, type FieldErrors } from './errors.ts';
import { isDateString, isLocalDateTimeString } from '../domain/time.ts';

const EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;
const PHONE = /^[0-9 +()-]{7,20}$/;

export class Validator {
  private readonly fields: FieldErrors = {};

  add(field: string, key: string, args?: Record<string, string | number>): void {
    if (this.fields[field] === undefined) this.fields[field] = { key, args };
  }

  required(field: string): void {
    this.add(field, 'field_required');
  }

  text(field: string, value: unknown, min: number, max: number): string {
    if (typeof value !== 'string' || value.trim() === '') {
      if (min > 0) this.required(field);
      return '';
    }
    const trimmed = value.trim();
    if (trimmed.length < min || trimmed.length > max) {
      this.add(field, 'field_length', { min, max });
      return trimmed;
    }
    return trimmed;
  }

  optionalText(field: string, value: unknown, max: number): string {
    if (value === undefined || value === null || value === '') return '';
    if (typeof value !== 'string') {
      this.add(field, 'field_length', { min: 0, max });
      return '';
    }
    if (value.length > max) {
      this.add(field, 'field_length', { min: 0, max });
      return value.slice(0, max);
    }
    return value;
  }

  email(field: string, value: unknown): string {
    if (typeof value !== 'string' || value.trim() === '') {
      this.required(field);
      return '';
    }
    const trimmed = value.trim();
    if (trimmed.length > 254 || !EMAIL.test(trimmed)) {
      this.add(field, 'field_email');
      return trimmed;
    }
    return trimmed.toLowerCase();
  }

  phone(field: string, value: unknown): string | null {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value !== 'string' || !PHONE.test(value.trim())) {
      this.add(field, 'field_length', { min: 7, max: 20 });
      return null;
    }
    return value.trim();
  }

  enumValue<T extends string>(field: string, value: unknown, allowed: readonly T[]): T {
    if (typeof value !== 'string' || !allowed.includes(value as T)) {
      this.add(field, value === undefined || value === null || value === '' ? 'field_required' : 'field_enum');
      return allowed[0];
    }
    return value as T;
  }

  integer(field: string, value: unknown, min: number, max: number, messageKey = 'field_length'): number {
    if (typeof value !== 'number' || !Number.isInteger(value)) {
      this.add(field, value === undefined || value === null ? 'field_required' : messageKey, { min, max });
      return min;
    }
    if (value < min || value > max) {
      this.add(field, messageKey, { min, max });
      return min;
    }
    return value;
  }

  date(field: string, value: unknown): string {
    if (!isDateString(value)) {
      this.add(field, 'field_date');
      return '1970-01-01';
    }
    return value;
  }

  localDateTime(field: string, value: unknown): string {
    if (!isLocalDateTimeString(value)) {
      this.add(field, 'field_date');
      return '1970-01-01T00:00';
    }
    return value;
  }

  password(field: string, value: unknown): string {
    if (typeof value !== 'string' || value === '') {
      this.required(field);
      return '';
    }
    if (value.length < 10 || value.length > 128) {
      this.add(field, 'field_length', { min: 10, max: 128 });
      return value;
    }
    return value;
  }

  get hasErrors(): boolean {
    return Object.keys(this.fields).length > 0;
  }

  check(): void {
    if (this.hasErrors) throw new ApiError('validation', { fields: this.fields });
  }
}

export function requireIdempotencyKey(value: string | undefined): string {
  if (value === undefined || !/^[A-Za-z0-9_-]{8,128}$/.test(value)) {
    throw new ApiError('validation', { fields: { idempotency_key: { key: 'field_retry_key' } } });
  }
  return value;
}
