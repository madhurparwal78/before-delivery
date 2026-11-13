import { ValidationError } from './errors.js';
import { isAligned, parseInstant, parseShipDate, parseClockTime } from '../domain/time.js';

export function requireText(
  body: Record<string, unknown>,
  field: string,
  label: string,
  minLength: number,
  maxLength: number,
): string {
  const value = body[field];
  if (typeof value !== 'string' || value.trim().length < minLength) {
    throw new ValidationError({ [field]: `${label} needs between ${minLength} and ${maxLength} characters.` });
  }
  if (value.length > maxLength) {
    throw new ValidationError({ [field]: `${label} needs between ${minLength} and ${maxLength} characters.` });
  }
  return value.trim();
}

export function requireEmail(body: Record<string, unknown>, field: string): string {
  const value = body[field];
  if (typeof value !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) {
    throw new ValidationError({ [field]: 'Write an email address like name@example.com.' });
  }
  return value.trim();
}

export function requirePasscode(body: Record<string, unknown>, field: string): string {
  const value = body[field];
  if (typeof value !== 'string' || value.length < 8) {
    throw new ValidationError({ [field]: 'A passcode needs at least 8 characters.' });
  }
  return value;
}

export function requireInstant(body: Record<string, unknown>, field: string, label: string): number {
  const ms = parseInstant(body[field]);
  if (ms === null) {
    throw new ValidationError({ [field]: `${label} needs the form 2026-09-10T02:00:00Z.` });
  }
  return ms;
}

export function requireAlignedInstant(
  body: Record<string, unknown>,
  field: string,
  label: string,
): number {
  const ms = requireInstant(body, field, label);
  if (!isAligned(ms)) {
    throw new ValidationError({ [field]: `${label} needs to fall on the hour or the half hour.` });
  }
  return ms;
}

export function requireShipDateField(
  body: Record<string, unknown>,
  field: string,
  label: string,
): string {
  const value = body[field];
  if (typeof value !== 'string' || parseShipDate(value) === null) {
    throw new ValidationError({ [field]: `${label} needs the form 2026-09-10.` });
  }
  return value;
}

export function requireWholeNumber(
  body: Record<string, unknown>,
  field: string,
  label: string,
): number {
  const raw = body[field];
  const value = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new ValidationError({ [field]: `${label} needs to be a whole number of minutes.` });
  }
  return value;
}

export function requireDegrees(
  body: Record<string, unknown>,
  field: string,
  label: string,
  limit: number,
): number {
  const raw = body[field];
  const value = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > limit) {
    throw new ValidationError({
      [field]: `${label} needs to be a number of degrees between -${limit} and ${limit}.`,
    });
  }
  return value;
}

export function requireChoice<T extends string>(
  body: Record<string, unknown>,
  field: string,
  label: string,
  choices: readonly T[],
): T {
  const value = body[field];
  if (typeof value !== 'string' || !choices.includes(value as T)) {
    throw new ValidationError({ [field]: `${label} needs to be one of ${choices.join(', ')}.` });
  }
  return value as T;
}

export function requireClockTime(
  body: Record<string, unknown>,
  field: string,
  label: string,
): string {
  const value = body[field];
  const minutes = parseClockTime(value);
  if (minutes === null) {
    throw new ValidationError({ [field]: `${label} needs the form 06:30.` });
  }
  if (minutes % 30 !== 0) {
    throw new ValidationError({ [field]: `${label} needs to fall on the hour or the half hour.` });
  }
  return value as string;
}

export function queryInstant(
  query: URLSearchParams,
  field: string,
  label: string,
): number | null {
  const raw = query.get(field);
  if (raw === null || raw === '') return null;
  const ms = parseInstant(raw);
  if (ms === null) {
    throw new ValidationError({ [field]: `${label} needs the form 2026-09-10T02:00:00Z.` });
  }
  return ms;
}

export function queryAlignedInstant(
  query: URLSearchParams,
  field: string,
  label: string,
): number | null {
  const ms = queryInstant(query, field, label);
  if (ms === null) return null;
  if (!isAligned(ms)) {
    throw new ValidationError({ [field]: `${label} needs to fall on the hour or the half hour.` });
  }
  return ms;
}

export function queryShipDate(
  query: URLSearchParams,
  field: string,
  label: string,
): string | null {
  const raw = query.get(field);
  if (raw === null || raw === '') return null;
  if (parseShipDate(raw) === null) {
    throw new ValidationError({ [field]: `${label} needs the form 2026-09-10.` });
  }
  return raw;
}
