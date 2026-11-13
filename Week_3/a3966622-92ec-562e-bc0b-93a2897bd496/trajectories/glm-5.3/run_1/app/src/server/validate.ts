// Field parsing and validation, shared by every route that carries order
// fields. Failures answer 422 with an errors key per field.

import { ApiError } from './api-util.js';
import { portInstant } from './porttime.js';

export function validationError(errors: Record<string, string>): ApiError {
  return new ApiError(422, 'validation_failed', 'Some fields need attention', errors);
}

export function versionOf(ifMatch: string | null): number | null {
  if (ifMatch === null) return null;
  const bare = ifMatch.replace(/"/g, '');
  if (bare === '' || bare === '*') return null;
  const n = Number(bare);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// "YYYY-MM-DDTHH:MM" without an offset, in port time.
export function boardingAtOf(body: Record<string, unknown>): string | null {
  const value = body.boarding_at;
  if (typeof value !== 'string') return null;
  return value;
}

// A time that does not exist in port time answers the published message, and
// that message wins over any other boarding_at message.
export function requireBoardingAt(value: string | null, nowMs: number, rejectPast: boolean): number {
  if (value === null || value === '') {
    throw validationError({ boarding_at: 'A boarding time is required' });
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!m) {
    throw validationError({ boarding_at: 'Boarding time must be YYYY-MM-DDTHH:MM' });
  }
  const date = value.slice(0, 10);
  const hhmm = value.slice(11, 16);
  const ms = portInstant(date, hhmm);
  if (ms === null) {
    throw validationError({ boarding_at: 'That time does not exist in port time on this date' });
  }
  if ((Number(m[4]) * 60 + Number(m[5])) % 5 !== 0) {
    throw validationError({ boarding_at: 'Boarding time must fall on a 5-minute step' });
  }
  if (rejectPast && ms <= nowMs) {
    throw validationError({ boarding_at: 'That boarding time has passed' });
  }
  return ms;
}

// Draught input: exactly one of draught_m, or draught_ft with draught_in.
export function draughtMmOf(body: Record<string, unknown>): number {
  const hasM = body.draught_m !== undefined;
  const hasFt = body.draught_ft !== undefined;
  const hasIn = body.draught_in !== undefined;
  if (hasM && (hasFt || hasIn)) {
    throw validationError({ draught_m: 'Give the draught in metres or in feet and inches' });
  }
  if (!hasM && !(hasFt && hasIn)) {
    throw validationError({ draught_m: 'A draught is required' });
  }
  let mm: number;
  if (hasM) {
    const metres = Number(body.draught_m);
    if (!Number.isFinite(metres) || metres < 2 || metres > 16) {
      throw validationError({ draught_m: 'Draught must be between 2.000 and 16.000 m' });
    }
    // Metres convert exactly, dropping any fraction of a millimetre.
    mm = Math.floor(metres * 1000);
  } else {
    const feet = Number(body.draught_ft);
    const inches = Number(body.draught_in);
    if (!Number.isInteger(feet) || feet < 0 || feet > 52) {
      throw validationError({ draught_ft: 'Draught feet must be a whole number of feet' });
    }
    if (!Number.isFinite(inches) || inches < 0 || inches >= 12) {
      throw validationError({ draught_in: 'Draught inches must be between 0 and 11' });
    }
    // Feet and inches convert at 25.4 mm to the inch.
    mm = Math.floor(feet * 25.4 * 12 + inches * 25.4);
  }
  if (mm < 2000 || mm > 16000) {
    throw validationError({ draught_m: 'Draught must be between 2.000 and 16.000 m' });
  }
  return mm;
}

export function speedKnOf(body: Record<string, unknown>, fallback?: number): number {
  return wholeInRange(body.speed_kn, 3, 16, 'speed_kn', 'Speed must be between 3 and 16 kn', fallback);
}

export function dutyMinutesOf(body: Record<string, unknown>, fallback?: number): number {
  return wholeInRange(body.duty_minutes, 30, 1440, 'duty_minutes', 'Duty minutes must be between 30 and 1440', fallback);
}

export function numberInRange(
  value: unknown, min: number, max: number, fallback: number,
): number {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) {
    throw validationError({ block_coefficient: `Value must be between ${min} and ${max}` });
  }
  return n;
}

export function positiveNumber(value: unknown, fallback: number): number {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    throw validationError({ length_m: 'Value must be positive' });
  }
  return n;
}

export function nonNegativeNumber(value: unknown, fallback: number): number {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    throw validationError({ gross_tonnage: 'Value must be 0 or more' });
  }
  return n;
}

function wholeInRange(
  value: unknown, min: number, max: number, field: string, message: string, fallback?: number,
): number {
  if (value === undefined) {
    if (fallback === undefined) throw validationError({ [field]: message });
    return fallback;
  }
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw validationError({ [field]: message });
  }
  return n;
}

export function applyOrderFields(move: { draught_mm: number; speed_kn: number; duty_minutes: number; block_coefficient: number; length_m: number; gross_tonnage: number; boarding_ms: number }, body: Record<string, unknown>): void {
  if (body.draught_m !== undefined || body.draught_ft !== undefined) move.draught_mm = draughtMmOf(body);
  if (body.speed_kn !== undefined) move.speed_kn = speedKnOf(body);
  if (body.duty_minutes !== undefined) move.duty_minutes = dutyMinutesOf(body);
  if (body.block_coefficient !== undefined) move.block_coefficient = numberInRange(body.block_coefficient, 0.4, 0.95, move.block_coefficient);
  if (body.length_m !== undefined) move.length_m = positiveNumber(body.length_m, move.length_m);
  if (body.gross_tonnage !== undefined) move.gross_tonnage = nonNegativeNumber(body.gross_tonnage, move.gross_tonnage);
}
