// Request validation: exact fields and the published field messages. One place for every check.
import { BUILDINGS, UNITS } from '../domain/catalog.ts';
import { isValidZone } from '../domain/localtime.ts';
import type { BuildingType, UnitKey } from '../domain/types.ts';
import { MAX_ID } from '../domain/types.ts';
import { errors } from './errors.ts';

export type FieldErrors = Record<string, string>;

export function requireObject(body: unknown): Record<string, unknown> {
  if (body === null || body === undefined) return {};
  if (typeof body !== 'object' || Array.isArray(body)) throw errors.validation({ '': 'Send a JSON object.' });
  return body as Record<string, unknown>;
}

// Every endpoint accepts exactly the fields it lists; anything else answers with "unknown field".
export function exactFields(body: Record<string, unknown>, allowed: string[]): FieldErrors {
  const fieldErrors: FieldErrors = {};
  for (const key of Object.keys(body)) {
    if (!allowed.includes(key)) fieldErrors[key] = 'unknown field';
  }
  return fieldErrors;
}

export function throwIfErrors(fieldErrors: FieldErrors): void {
  if (Object.keys(fieldErrors).length > 0) throw errors.validation(fieldErrors);
}

export function requiredString(body: Record<string, unknown>, fieldErrors: FieldErrors, field: string): string {
  const value = body[field];
  if (value === undefined || value === null || value === '') {
    fieldErrors[field] = 'This field is required.';
    return '';
  }
  if (typeof value !== 'string') {
    fieldErrors[field] = 'This field is required.';
    return '';
  }
  return value;
}

export function optionalString(body: Record<string, unknown>, field: string): string | undefined {
  const value = body[field];
  return value === undefined ? undefined : String(value);
}

export function validateEmail(email: string): string | null {
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'Enter a valid email address.';
  return null;
}

export function validatePassword(password: string): string | null {
  if (password.length < 10 || password.length > 128) return 'Use 10 to 128 characters.';
  return null;
}

export function validateDisplayName(name: string): string | null {
  if (!/^[\p{L}\p{N} _-]{3,20}$/u.test(name)) return 'Use 3 to 20 letters, digits, spaces, hyphens or underscores.';
  return null;
}

export function validateTimeZone(zone: string): string | null {
  if (!isValidZone(zone)) return 'Choose a time zone from the list.';
  return null;
}

export function isBuildingType(value: string): value is BuildingType {
  return Object.prototype.hasOwnProperty.call(BUILDINGS, value);
}

export function isUnitKey(value: string): value is UnitKey {
  return value === 'saltjack' || value === 'peat_slinger';
}

// An id field in a body or query: a JSON integer or a plain decimal string in range.
export function parseBodyId(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_ID) return value;
  if (typeof value === 'string' && /^[1-9][0-9]*$/.test(value)) {
    const n = Number(value);
    if (n >= 1 && n <= MAX_ID) return n;
  }
  return null;
}

export function optionalCount(body: Record<string, unknown>, fieldErrors: FieldErrors, field: string, message: string): number {
  const value = body[field];
  if (value === undefined || value === null || value === '') {
    fieldErrors[field] = 'This field is required.';
    return 0;
  }
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    fieldErrors[field] = message;
    return 0;
  }
  return value;
}

export const UNIT_MESSAGE = 'Choose Saltjack or Peat Slinger.';

export function unitOf(body: Record<string, unknown>, fieldErrors: FieldErrors, field = 'unit'): UnitKey {
  const value = requiredString(body, fieldErrors, field);
  if (fieldErrors[field]) return 'saltjack';
  if (!isUnitKey(value)) {
    fieldErrors[field] = UNIT_MESSAGE;
    return 'saltjack';
  }
  return value;
}

export function unitName(unit: UnitKey): string {
  return UNITS[unit].name;
}

export function buildingName(type: BuildingType): string {
  return BUILDINGS[type].name;
}
