import type { Setting } from '../../shared/contract.js';
import {
  DAY_COLUMN_END_MINUTE,
  DAY_COLUMN_START_MINUTE,
  agencyDateString,
  instantOf,
  partsOf,
} from '../../shared/zone.js';
import { FieldErrors } from '../http/validation.js';

export const SETTINGS: readonly Setting[] = ['hospital', 'clinic', 'school'];
export const MIN_DURATION_MINUTES = 30;
export const MAX_DURATION_MINUTES = 480;
export const DURATION_STEP_MINUTES = 15;
export const MIN_LEAD_MINUTES = 60;
export const MAX_LEAD_DAYS = 365;

const OFFSET_SUFFIX = /(?:Z|[+-]\d{2}:?\d{2})$/;
const NAIVE_LOCAL = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/;

/** Reads an input time; a plain wall clock without an offset is read as agency time. */
export function parseInputInstant(value: string): Date | null {
  if (OFFSET_SUFFIX.test(value)) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const match = NAIVE_LOCAL.exec(value);
  if (match === null) {
    return null;
  }
  return instantOf(Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4]), Number(match[5]));
}

export function validateStartAt(errors: FieldErrors, raw: string, now: Date): Date | null {
  const startAt = parseInputInstant(raw);
  if (startAt === null) {
    errors.add('start_at', 'Give a date and a start time.');
    return null;
  }
  const parts = partsOf(startAt);
  if (parts.minute % DURATION_STEP_MINUTES !== 0) {
    errors.add('start_at', 'Start on a quarter hour.');
    return null;
  }
  if (startAt.getTime() - now.getTime() < MIN_LEAD_MINUTES * 60000) {
    errors.add('start_at', 'Start at least 60 minutes from now.');
    return null;
  }
  if (startAt.getTime() - now.getTime() > MAX_LEAD_DAYS * 86400000) {
    errors.add('start_at', 'Start within 365 days from now.');
    return null;
  }
  return startAt;
}

export function validateDuration(errors: FieldErrors, value: number | null): number | null {
  if (
    value === null ||
    value < MIN_DURATION_MINUTES ||
    value > MAX_DURATION_MINUTES ||
    value % DURATION_STEP_MINUTES !== 0
  ) {
    errors.add('duration_minutes', 'Choose 30 to 480 minutes in steps of 15.');
    return null;
  }
  return value;
}

/** The appointment must sit inside one agency-time day column, 06:00 to 22:00. */
export function validateDayWindow(errors: FieldErrors, startAt: Date, durationMinutes: number): void {
  const start = partsOf(startAt);
  const startMinute = start.hour * 60 + start.minute;
  const endInstant = new Date(startAt.getTime() + durationMinutes * 60000);
  if (startMinute < DAY_COLUMN_START_MINUTE) {
    errors.add('start_at', 'Start at 06:00 or later.');
    return;
  }
  if (
    agencyDateString(endInstant) !== agencyDateString(startAt) ||
    startMinute + durationMinutes > DAY_COLUMN_END_MINUTE
  ) {
    errors.add('start_at', 'End by 22:00 on the same day.');
  }
}

export function validateSetting(errors: FieldErrors, value: string): Setting | null {
  if (!SETTINGS.includes(value as Setting)) {
    errors.add('setting', 'Choose hospital, clinic or school.');
    return null;
  }
  return value as Setting;
}

export function validateLanguage(errors: FieldErrors, value: string, seeded: readonly string[]): string | null {
  if (!seeded.includes(value)) {
    errors.add('language', 'Choose a language we work in.');
    return null;
  }
  return value;
}

export function validateStreetAddress(errors: FieldErrors, value: string): string | null {
  if (value.trim() === '' || value.length > 200) {
    errors.add('street_address', 'Give a street address of up to 200 characters.');
    return null;
  }
  return value;
}

export function validateCity(errors: FieldErrors, value: string): string | null {
  if (value.trim() === '' || value.length > 80) {
    errors.add('city', 'Give a city of up to 80 characters.');
    return null;
  }
  return value;
}

export function validatePatientInitials(errors: FieldErrors, value: string): string | null {
  if (!/^[A-Z]{2,3}$/.test(value)) {
    errors.add('patient_initials', 'Use 2 or 3 capital letters.');
    return null;
  }
  return value;
}

export function validateMedicalNotes(errors: FieldErrors, value: string): string | null {
  if (value.length > 1000) {
    errors.add('medical_notes', 'Keep notes to 1,000 characters.');
    return null;
  }
  return value;
}
