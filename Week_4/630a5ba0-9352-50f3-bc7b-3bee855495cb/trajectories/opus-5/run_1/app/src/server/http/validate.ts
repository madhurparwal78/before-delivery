import { isKnownTimeZone, isDateString, isTimeString } from '../../shared/time.js';
import { validation } from './errors.js';

export class FieldErrors {
  private readonly fields: Record<string, string> = {};

  add(field: string, message: string): void {
    if (!(field in this.fields)) this.fields[field] = message;
  }

  get empty(): boolean {
    return Object.keys(this.fields).length === 0;
  }

  throwIfAny(): void {
    if (!this.empty) throw validation(this.fields);
  }
}

export function checkName(errors: FieldErrors, field: string, value: unknown): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (text.length < 1 || text.length > 80) {
    errors.add(field, 'Use between 1 and 80 characters.');
  }
  return text;
}

export function checkTitle(errors: FieldErrors, field: string, value: unknown): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (text.length < 1 || text.length > 200) {
    errors.add(field, 'Use between 1 and 200 characters.');
  }
  return text;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

export function checkEmail(errors: FieldErrors, field: string, value: unknown): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (text.length === 0 || text.length > 254 || !EMAIL_PATTERN.test(text)) {
    errors.add(field, 'Enter a valid email address.');
  }
  return text;
}

export function checkPassword(errors: FieldErrors, field: string, value: unknown): string {
  const text = typeof value === 'string' ? value : '';
  if (text.length < 10) errors.add(field, 'Use at least 10 characters.');
  return text;
}

export function checkTimeZone(errors: FieldErrors, field: string, value: unknown): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (text.length === 0 || !isKnownTimeZone(text)) {
    errors.add(field, 'Choose a known time zone.');
  }
  return text;
}

export function checkThreshold(errors: FieldErrors, field: string, value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number.NaN;
  if (!Number.isInteger(parsed) || parsed < 60 || parsed > 960 || parsed % 15 !== 0) {
    errors.add(field, 'Use 60 to 960 minutes in steps of 15.');
    return 360;
  }
  return parsed;
}

export function checkEstimate(errors: FieldErrors, field: string, value: unknown): number | null {
  if (value === null) return null;
  const parsed = typeof value === 'number' ? value : Number.NaN;
  if (!Number.isInteger(parsed) || parsed < 5 || parsed > 600 || parsed % 5 !== 0) {
    errors.add(field, 'Use 5 to 600 minutes in steps of 5.');
    return null;
  }
  return parsed;
}

export function checkDuration(errors: FieldErrors, field: string, value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number.NaN;
  if (!Number.isInteger(parsed) || parsed < 5 || parsed > 240 || parsed % 5 !== 0) {
    errors.add(field, 'Use 5 to 240 minutes in steps of 5.');
    return 30;
  }
  return parsed;
}

export function checkDate(errors: FieldErrors, field: string, value: unknown): string | null {
  if (value === null) return null;
  if (!isDateString(value)) {
    errors.add(field, 'Use a date like 2026-03-14.');
    return null;
  }
  return value;
}

export function checkTime(errors: FieldErrors, field: string, value: unknown): string {
  if (!isTimeString(value)) {
    errors.add(field, 'Use a 24-hour time like 09:30.');
    return '09:00';
  }
  return value;
}

export function checkVersion(errors: FieldErrors, field: string, value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number.NaN;
  if (!Number.isInteger(parsed) || parsed < 1) {
    errors.add(field, 'Send the version you based this change on.');
    return 0;
  }
  return parsed;
}
