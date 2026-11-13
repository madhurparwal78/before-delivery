import { daysBetween, dateToMs, isCalendarDate, todayUtc } from '../shared/dates.js';
import { MAX_HIRE_DAYS, MIN_HIRE_DAYS } from '../shared/pricing.js';

export const MESSAGES = {
  pickupDate: 'Pick a pickup date from today on',
  returnDate: `Return between ${MIN_HIRE_DAYS} and ${MAX_HIRE_DAYS} days after pickup`,
  renterName: 'Enter your name',
  renterEmail: 'Enter a valid email',
  units: 'Pick a unit that belongs to this kit',
  money: 'Enter a whole number of cents above zero',
} as const;

const MAX_MONEY_CENTS = 100_000_000;

export function checkPickupDate(value: unknown): string | null {
  if (!isCalendarDate(value)) return MESSAGES.pickupDate;
  if (dateToMs(value) < dateToMs(todayUtc())) return MESSAGES.pickupDate;
  return null;
}

export function checkReturnDate(pickupDate: unknown, value: unknown): string | null {
  if (!isCalendarDate(value)) return MESSAGES.returnDate;
  if (!isCalendarDate(pickupDate)) return MESSAGES.returnDate;
  const hireDays = daysBetween(pickupDate, value);
  if (hireDays < MIN_HIRE_DAYS || hireDays > MAX_HIRE_DAYS) return MESSAGES.returnDate;
  return null;
}

export function isoDateOrNull(value: unknown): string | null {
  return isCalendarDate(value) ? value : null;
}

export function trimmedName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length < 1 || trimmed.length > 80) return null;
  return trimmed;
}

export function validEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length < 3 || trimmed.length > 254) return null;
  const parts = trimmed.split('@');
  if (parts.length !== 2) return null;
  const [local, domain] = parts;
  if (local === undefined || domain === undefined) return null;
  if (local.length === 0 || domain.length === 0) return null;
  if (!domain.includes('.')) return null;
  if (domain.startsWith('.') || domain.endsWith('.')) return null;
  if (/\s/.test(trimmed)) return null;
  return trimmed;
}

export function moneyCents(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) return null;
  if (value <= 0 || value > MAX_MONEY_CENTS) return null;
  return value;
}

export function nonNegativeMoneyCents(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) return null;
  if (value < 0 || value > MAX_MONEY_CENTS) return null;
  return value;
}

export function optionalText(value: unknown, maxLength: number): string | null | 'invalid' {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return 'invalid';
  if (value.length > maxLength) return 'invalid';
  return value;
}

export function looksLikePdf(bytes: Buffer): boolean {
  return bytes.subarray(0, 5).toString('latin1') === '%PDF-';
}

type PhotoKind = 'image/jpeg' | 'image/png';

export function photoKind(bytes: Buffer): PhotoKind | null {
  if (bytes.byteLength >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (bytes.byteLength >= 8 && bytes.subarray(0, 8).equals(pngSignature)) return 'image/png';
  return null;
}
