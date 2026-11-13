import {
  CREDENTIAL_TYPES,
  SETTINGS,
  type CredentialType,
  type Setting,
} from '../../shared/types.js';
import { parseIsoDate, parseLocalDateTime, resolveLocal } from '../domain/agency-time.js';
import type { JsonObject } from '../http/body.js';
import { ApiError, validationError } from '../http/errors.js';
import { bodyHas, bodyNumber, bodyString } from '../http/context.js';
import { parseDollars, type Cents } from '../domain/money.js';

export const DEFAULT_CREDENTIAL_BY_SETTING: Record<Setting, CredentialType> = {
  medical: 'NIC',
  education: 'EIPA',
  legal: 'SC:L',
};

export class FieldErrors {
  private readonly fields: Record<string, string> = {};

  add(field: string, message: string): void {
    if (this.fields[field] === undefined) this.fields[field] = message;
  }

  get empty(): boolean {
    return Object.keys(this.fields).length === 0;
  }

  throwIfAny(): void {
    if (!this.empty) throw validationError(this.fields);
  }
}

function isInteger(value: number | undefined): value is number {
  return value !== undefined && Number.isInteger(value);
}

export interface RequestFieldInput {
  setting?: Setting;
  starts_at?: Date;
  duration_minutes?: number;
  consumer_name?: string;
  location_address?: string;
  city?: string;
  notes?: string;
  required_credential?: CredentialType;
}

function readText(
  body: JsonObject,
  field: string,
  min: number,
  max: number,
  message: string,
  errors: FieldErrors,
): string | undefined {
  const value = bodyString(body, field);
  if (value === undefined) {
    errors.add(field, message);
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) {
    errors.add(field, message);
    return undefined;
  }
  return trimmed;
}

/** The one place request fields are validated, for both create and edit. */
export function readRequestFields(
  body: JsonObject,
  mode: 'create' | 'edit',
  now: Date,
): RequestFieldInput {
  const errors = new FieldErrors();
  const input: RequestFieldInput = {};
  const wanted = (field: string): boolean => mode === 'create' || bodyHas(body, field);

  if (wanted('setting')) {
    const setting = bodyString(body, 'setting');
    if (setting !== undefined && (SETTINGS as readonly string[]).includes(setting)) {
      input.setting = setting as Setting;
    } else {
      errors.add('setting', 'Choose Medical, Education or Legal.');
    }
  }

  if (wanted('starts_at')) {
    const text = bodyString(body, 'starts_at');
    const local = text === undefined ? null : parseLocalDateTime(text);
    if (local === null) {
      errors.add('starts_at', 'Enter a start date and time as YYYY-MM-DDTHH:MM.');
    } else {
      const resolved = resolveLocal(local);
      if (resolved.instant === null) {
        errors.add('starts_at', 'That clock time does not exist in the agency time zone.');
      } else if (resolved.instant.getTime() <= now.getTime()) {
        errors.add('starts_at', 'Choose a start time in the future.');
      } else {
        input.starts_at = resolved.instant;
      }
    }
  }

  if (wanted('duration_minutes')) {
    const duration = bodyNumber(body, 'duration_minutes');
    if (isInteger(duration) && duration >= 30 && duration <= 480) input.duration_minutes = duration;
    else errors.add('duration_minutes', 'Enter a duration from 30 to 480 minutes.');
  }

  if (wanted('consumer_name')) {
    const value = readText(
      body,
      'consumer_name',
      1,
      120,
      'Enter the Deaf consumer name, up to 120 characters.',
      errors,
    );
    if (value !== undefined) input.consumer_name = value;
  }

  if (wanted('location_address')) {
    const value = readText(
      body,
      'location_address',
      1,
      200,
      'Enter the street address, up to 200 characters.',
      errors,
    );
    if (value !== undefined) input.location_address = value;
  }

  if (wanted('city')) {
    const value = readText(body, 'city', 1, 80, 'Enter the city, up to 80 characters.', errors);
    if (value !== undefined) input.city = value;
  }

  if (bodyHas(body, 'notes')) {
    const notes = bodyString(body, 'notes');
    if (notes === undefined || notes.length > 2000) {
      errors.add('notes', 'Notes can be at most 2,000 characters.');
    } else {
      input.notes = notes;
    }
  }

  if (bodyHas(body, 'required_credential')) {
    const code = bodyString(body, 'required_credential');
    if (code !== undefined && (CREDENTIAL_TYPES as readonly string[]).includes(code)) {
      input.required_credential = code as CredentialType;
    } else {
      errors.add('required_credential', 'Choose NIC, CDI, SC:L or EIPA.');
    }
  }

  errors.throwIfAny();
  return input;
}

export interface StaffingInput {
  team_size?: number;
  team_reason?: string;
  rotation_minutes?: number;
}

export function readStaffingFields(body: JsonObject, defaultTeamSize: number): StaffingInput {
  const errors = new FieldErrors();
  const input: StaffingInput = {};

  if (bodyHas(body, 'rotation_minutes')) {
    const rotation = bodyNumber(body, 'rotation_minutes');
    if (isInteger(rotation) && rotation >= 20 && rotation <= 30) input.rotation_minutes = rotation;
    else errors.add('rotation_minutes', 'Enter a rotation interval from 20 to 30 minutes.');
  }

  if (bodyHas(body, 'team_size')) {
    const teamSize = bodyNumber(body, 'team_size');
    if (teamSize === 1 || teamSize === 2) input.team_size = teamSize;
    else errors.add('team_size', 'Choose a team of two or solo.');
  }

  const reason = bodyString(body, 'team_reason');
  if (reason !== undefined && reason.trim().length > 0) input.team_reason = reason.trim();

  if (input.team_size !== undefined && input.team_size !== defaultTeamSize) {
    const trimmed = input.team_reason ?? '';
    if (trimmed.length < 10 || trimmed.length > 500) {
      errors.add('team_reason', 'Give a reason of 10 to 500 characters for changing the team size.');
    }
  }

  errors.throwIfAny();
  return input;
}

export function readActualMinutes(body: JsonObject): number {
  const minutes = bodyNumber(body, 'actual_minutes');
  if (!isInteger(minutes) || minutes < 1 || minutes > 720) {
    throw validationError({ actual_minutes: 'Enter the actual minutes, from 1 to 720.' });
  }
  return minutes;
}

export function readExpiresOn(body: JsonObject, today: string): string {
  const text = bodyString(body, 'expires_on');
  const parsed = text === undefined ? null : parseIsoDate(text);
  if (parsed === null || (text as string) < today) {
    throw validationError({ expires_on: 'Enter an expiry date of today or later as YYYY-MM-DD.' });
  }
  return text as string;
}

export function readCredentialType(value: string | undefined): CredentialType {
  if (value === undefined || !(CREDENTIAL_TYPES as readonly string[]).includes(value)) {
    throw validationError({ credential_type: 'Choose NIC, CDI, SC:L or EIPA.' });
  }
  return value as CredentialType;
}

export function readIdempotencyKey(raw: string | null): string {
  if (raw === null || raw.length < 1 || raw.length > 64 || !/^[\u0021-\u007e]+$/.test(raw)) {
    throw validationError({
      'Idempotency-Key': 'Send an Idempotency-Key of 1 to 64 visible ASCII characters.',
    });
  }
  return raw;
}

export function readExpectedFee(body: JsonObject): Cents {
  const text = bodyString(body, 'expected_fee');
  const cents = text === undefined ? null : parseDollars(text);
  if (cents === null) {
    throw validationError({ expected_fee: 'Send the quoted fee in dollars, such as 0.00.' });
  }
  return cents;
}

export function requireJsonContentType(wrong: boolean): void {
  if (wrong) throw new ApiError('unsupported_type');
}
