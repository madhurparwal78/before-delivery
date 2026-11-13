import { draughtMmFromFeetInches, draughtMmFromMetres } from '../../domain/numerals.ts';
import {
  type Wall,
  STEP_MINUTES,
  minutesAfterMidnight,
  parsePortDate,
  parsePortDateTime,
  wallToInstant,
} from '../../domain/porttime.ts';
import { invalid } from '../errors.ts';

export const TIME_DOES_NOT_EXIST = 'That time does not exist in port time on this date';

export class FieldErrors {
  private readonly errors: Record<string, string> = {};

  add(field: string, message: string): void {
    if (this.errors[field] === undefined) this.errors[field] = message;
  }

  get empty(): boolean {
    return Object.keys(this.errors).length === 0;
  }

  throwIfAny(): void {
    if (!this.empty) throw invalid({ ...this.errors });
  }
}

/** A field the request must carry; the checks above have already answered for malformed values. */
export function definite<T>(value: T | null, field: string): T {
  if (value === null) throw invalid({ [field]: 'This field is required' });
  return value;
}

export function asRecord(body: unknown): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw invalid({ body: 'A JSON object is required' });
  }
  return body as Record<string, unknown>;
}

export function numberField(
  body: Record<string, unknown>,
  field: string,
  errors: FieldErrors,
  range: { min: number; max: number },
): number | null {
  const raw = body[field];
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    errors.add(field, 'A number is required');
    return null;
  }
  if (raw < range.min || raw > range.max) {
    errors.add(field, `Must be from ${range.min} to ${range.max}`);
    return null;
  }
  return raw;
}

export function wholeNumberField(
  body: Record<string, unknown>,
  field: string,
  errors: FieldErrors,
  range: { min: number; max: number },
): number | null {
  const value = numberField(body, field, errors, range);
  if (value === null) return null;
  if (!Number.isInteger(value)) {
    errors.add(field, 'A whole number is required');
    return null;
  }
  return value;
}

export type BoardingTime = { text: string; wall: Wall; instant: number };

export type BoardingRules = { field?: string; mustBeFuture: boolean; now: number };

/** A boarding time must exist in port time and fall on a 5-minute step. */
export function boardingTimeField(
  body: Record<string, unknown>,
  errors: FieldErrors,
  rules: BoardingRules,
): BoardingTime | null {
  const field = rules.field ?? 'boarding_at';
  const raw = body[field];
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'string') {
    errors.add(field, 'A port time of the form YYYY-MM-DDTHH:MM is required');
    return null;
  }
  const wall = parsePortDateTime(raw);
  if (wall === null) {
    errors.add(field, 'A port time of the form YYYY-MM-DDTHH:MM is required');
    return null;
  }
  const instant = wallToInstant(wall);
  if (instant === null) {
    errors.add(field, TIME_DOES_NOT_EXIST);
    return null;
  }
  if (minutesAfterMidnight(wall) % STEP_MINUTES !== 0 || wall.second !== 0) {
    errors.add(field, 'Boarding time must fall on a 5-minute step');
    return null;
  }
  if (rules.mustBeFuture && instant <= rules.now) {
    errors.add(field, 'Boarding time must be later than now');
    return null;
  }
  return { text: raw.slice(0, 16), wall, instant };
}

export function dateField(
  body: Record<string, unknown>,
  field: string,
  errors: FieldErrors,
): { text: string; wall: Wall } | null {
  const raw = body[field];
  if (typeof raw !== 'string') {
    errors.add(field, 'A date of the form YYYY-MM-DD is required');
    return null;
  }
  const wall = parsePortDate(raw);
  if (wall === null) {
    errors.add(field, 'A date of the form YYYY-MM-DD is required');
    return null;
  }
  return { text: raw, wall };
}

const MIN_DRAUGHT_MM = 2000;
const MAX_DRAUGHT_MM = 16000;

/** Exactly one of draught_m, or draught_ft together with draught_in. */
export function draughtField(body: Record<string, unknown>, errors: FieldErrors): number | null {
  const metres = body.draught_m;
  const feet = body.draught_ft;
  const inches = body.draught_in;
  const hasMetres = metres !== undefined && metres !== null;
  const hasFeet = feet !== undefined && feet !== null;
  const hasInches = inches !== undefined && inches !== null;
  if (!hasMetres && !hasFeet && !hasInches) return null;
  if (hasMetres && (hasFeet || hasInches)) {
    errors.add('draught_m', 'Give the draught in metres or in feet and inches, not both');
    return null;
  }
  let millimetres: number;
  if (hasMetres) {
    if (typeof metres !== 'number' || !Number.isFinite(metres)) {
      errors.add('draught_m', 'A number of metres is required');
      return null;
    }
    millimetres = draughtMmFromMetres(metres);
  } else {
    if (typeof feet !== 'number' || !Number.isFinite(feet) || feet < 0) {
      errors.add('draught_ft', 'A number of feet is required');
      return null;
    }
    if (typeof inches !== 'number' || !Number.isFinite(inches) || inches < 0 || inches >= 12) {
      errors.add('draught_in', 'Inches from 0 up to 12 are required');
      return null;
    }
    millimetres = draughtMmFromFeetInches(feet, inches);
  }
  if (millimetres < MIN_DRAUGHT_MM || millimetres > MAX_DRAUGHT_MM) {
    errors.add(hasMetres ? 'draught_m' : 'draught_ft', 'Draught must be from 2.000 to 16.000 m');
    return null;
  }
  return millimetres;
}

export const SPEED_RANGE = { min: 3, max: 16 };
export const BLOCK_RANGE = { min: 0.4, max: 0.95 };
export const DUTY_RANGE = { min: 30, max: 1440 };
export const LENGTH_RANGE = { min: 10, max: 500 };
export const TONNAGE_RANGE = { min: 1, max: 1_000_000 };

export function stringField(
  body: Record<string, unknown>,
  field: string,
  errors: FieldErrors,
  limits: { min: number; max: number; message: string },
): string | null {
  const raw = body[field];
  if (typeof raw !== 'string') {
    errors.add(field, limits.message);
    return null;
  }
  const trimmed = raw.trim();
  if (trimmed.length < limits.min || trimmed.length > limits.max) {
    errors.add(field, limits.message);
    return null;
  }
  return trimmed;
}
