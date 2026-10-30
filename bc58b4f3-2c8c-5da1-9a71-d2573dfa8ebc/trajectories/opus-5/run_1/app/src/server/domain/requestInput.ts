import { fieldErrors, integerOf, stringOf } from '../http/validation.js';
import { DAY_END_MINUTE, DAY_START_MINUTE, centralDateKey, centralMinuteOfDay, centralParts } from '../../shared/centralTime.js';
import type { Setting } from './types.js';

export interface AssignmentInput {
  languageCode: string;
  setting: Setting;
  startAt: Date;
  durationMinutes: number;
  streetAddress: string;
  city: string;
  patientInitials: string;
  medicalNotes: string;
}

const SETTINGS: Setting[] = ['hospital', 'clinic', 'school'];
const MINIMUM_NOTICE_MINUTES = 60;
const MAXIMUM_DAYS_AHEAD = 365;

const PATIENT_INITIALS_PATTERN = /^[A-Z]{2,3}$/;

function parseInstant(value: unknown): Date | null {
  const text = stringOf(value);
  if (text === null) return null;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Validates the request form for creation (`base` null) and for a change
 * (`base` holding the stored values), and reports every bad field at once.
 */
export function validateAssignmentInput(
  body: Record<string, unknown>,
  options: { languageCodes: readonly string[]; now: Date; base: AssignmentInput | null },
): AssignmentInput {
  const { languageCodes, now, base } = options;
  const errors = fieldErrors();

  let languageCode = base?.languageCode ?? '';
  if (base === null) {
    const value = stringOf(body['language']);
    if (value === null || !languageCodes.includes(value)) {
      errors.add('language', 'Choose one of the languages the agency covers.');
    } else {
      languageCode = value;
    }
  }

  let setting: Setting = base?.setting ?? 'hospital';
  if (base === null) {
    const value = stringOf(body['setting']);
    if (value === null || !SETTINGS.includes(value as Setting)) {
      errors.add('setting', 'Choose hospital, clinic or school.');
    } else {
      setting = value as Setting;
    }
  }

  let patientInitials = base?.patientInitials ?? '';
  if (base === null) {
    const value = stringOf(body['patient_initials']);
    if (value === null || !PATIENT_INITIALS_PATTERN.test(value)) {
      errors.add('patient_initials', 'Use 2 or 3 capital letters, such as J.D. written JD.');
    } else {
      patientInitials = value;
    }
  }

  let startAt = base?.startAt ?? now;
  if (base === null || body['start_at'] !== undefined) {
    const parsed = parseInstant(body['start_at']);
    if (parsed === null) {
      errors.add('start_at', 'Enter a date and a time.');
    } else {
      const parts = centralParts(parsed);
      if (parts.minute % 15 !== 0 || parts.second !== 0) {
        errors.add('start_at', 'Start on a quarter hour, such as 09:00 or 09:15.');
      } else if (parsed.getTime() - now.getTime() < MINIMUM_NOTICE_MINUTES * 60000) {
        errors.add('start_at', 'Start at least 60 minutes from now.');
      } else if (
        parsed.getTime() - now.getTime() >
        MAXIMUM_DAYS_AHEAD * 24 * 60 * 60000
      ) {
        errors.add('start_at', 'Start within the next 365 days.');
      } else {
        startAt = parsed;
      }
    }
  }

  let durationMinutes = base?.durationMinutes ?? 60;
  if (base === null || body['duration_minutes'] !== undefined) {
    const value = integerOf(body['duration_minutes']);
    if (value === null || value < 30 || value > 480 || value % 15 !== 0) {
      errors.add('duration_minutes', 'Use 30 to 480 minutes in 15-minute steps.');
    } else {
      durationMinutes = value;
    }
  }

  if (!errors.has('start_at') && !errors.has('duration_minutes')) {
    const startMinute = centralMinuteOfDay(startAt);
    const endInstant = new Date(startAt.getTime() + durationMinutes * 60000);
    if (
      startMinute < DAY_START_MINUTE ||
      startMinute + durationMinutes > DAY_END_MINUTE ||
      centralDateKey(endInstant) !== centralDateKey(startAt)
    ) {
      errors.add('start_at', 'Appointments run between 06:00 and 22:00 Central on one day.');
    }
  }

  let streetAddress = base?.streetAddress ?? '';
  if (base === null || body['street_address'] !== undefined) {
    const value = stringOf(body['street_address']);
    if (value === null || value.trim() === '' || value.length > 200) {
      errors.add('street_address', 'Enter a street address of up to 200 characters.');
    } else {
      streetAddress = value.trim();
    }
  }

  let city = base?.city ?? '';
  if (base === null || body['city'] !== undefined) {
    const value = stringOf(body['city']);
    if (value === null || value.trim() === '' || value.length > 80) {
      errors.add('city', 'Enter a city of up to 80 characters.');
    } else {
      city = value.trim();
    }
  }

  let medicalNotes = base?.medicalNotes ?? '';
  if (body['medical_notes'] !== undefined) {
    const value = stringOf(body['medical_notes']);
    if (value === null || value.length > 1000) {
      errors.add('medical_notes', 'Keep the notes within 1,000 characters.');
    } else {
      medicalNotes = value;
    }
  }

  errors.finish();

  return {
    languageCode,
    setting,
    startAt,
    durationMinutes,
    streetAddress,
    city,
    patientInitials,
    medicalNotes,
  };
}
