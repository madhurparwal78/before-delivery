import { isValidDate, parseClock } from '../../shared/time.js';
import { invalidField, validationFailed } from './errors.js';

export function readString(body: Record<string, unknown>, field: string): string | null {
  const value = body[field];
  return typeof value === 'string' ? value : null;
}

export function requireString(body: Record<string, unknown>, field: string): string {
  const value = readString(body, field);
  if (value === null) throw invalidField(field, 'required');
  return value;
}

export function requireDate(body: Record<string, unknown>, field: string): string {
  const value = readString(body, field);
  if (value === null || !isValidDate(value)) throw invalidField(field, 'invalid');
  return value;
}

export function requireClock(body: Record<string, unknown>, field: string): number {
  const value = readString(body, field);
  const minutes = value === null ? null : parseClock(value);
  if (minutes === null) throw invalidField(field, 'not_on_grid');
  return minutes;
}

export function requireInteger(body: Record<string, unknown>, field: string): number {
  const value = body[field];
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw invalidField(field, 'invalid');
  }
  return value;
}

export function requireBoundedText(
  body: Record<string, unknown>,
  field: string,
  min: number,
  max: number,
): string {
  const value = readString(body, field);
  if (value === null || value.trim().length < min || value.trim().length > max) {
    throw invalidField(field, 'length');
  }
  return value.trim();
}

export function queryString(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

export function queryDate(value: unknown, field: string, fallback: string): string {
  const raw = queryString(value);
  if (raw === null) return fallback;
  if (!isValidDate(raw)) throw validationFailed({ [field]: 'invalid' });
  return raw;
}
