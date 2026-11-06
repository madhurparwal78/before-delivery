import { FIELD_COPY, coinsToOfferRange, unknownFieldMessage } from '../shared/copy.js';
import { ITEM_NAMES, type ItemKind, TIME_ZONES } from '../shared/domain.js';
import { fail } from './errors.js';

/**
 * A body field is only ever matched against the endpoint's own published list,
 * so names of built-in object members are unknown fields like any other.
 */
export function onlyFields(
  body: Record<string, unknown>,
  allowed: readonly string[],
): Record<string, unknown> {
  for (const name of Object.keys(body)) {
    if (!allowed.includes(name)) {
      throw fail('unknown_field', {
        message: unknownFieldMessage(name),
        fields: { [name]: FIELD_COPY.unknownField },
      });
    }
  }
  return body;
}

export class FieldErrors {
  private readonly found = new Map<string, string>();

  add(field: string, message: string): void {
    if (!this.found.has(field)) this.found.set(field, message);
  }

  get empty(): boolean {
    return this.found.size === 0;
  }

  /** Throws 422 validation carrying every field message, in field order. */
  throwIfAny(): void {
    if (this.found.size === 0) return;
    throw fail('validation', { fields: Object.fromEntries(this.found) });
  }
}

/** Lengths count Unicode characters after trimming spaces at both ends. */
export const trimmed = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const length = (value: string): number => [...value].length;

export const HANDLE_PATTERN = /^[a-z0-9-]{3,24}$/;
const SERVER_NAME_PATTERN = /^[\p{L}\p{N} -]{3,40}$/u;
const CHARACTER_NAME_PATTERN = /^[\p{L}\p{N} -]{2,20}$/u;

export function checkHandle(errors: FieldErrors, field: string, raw: unknown): string {
  const value = trimmed(raw);
  if (value === '') {
    errors.add(field, FIELD_COPY.handleRequired);
    return value;
  }
  if (length(value) > 24) {
    errors.add(field, FIELD_COPY.handleTooLong);
    return value;
  }
  if (!HANDLE_PATTERN.test(value)) errors.add(field, FIELD_COPY.handleFormat);
  return value;
}

export function checkPasscode(
  errors: FieldErrors,
  raw: unknown,
  options: { minimum: boolean },
): string {
  const value = typeof raw === 'string' ? raw : '';
  if (value.trim() === '') {
    errors.add('passcode', FIELD_COPY.passcodeRequired);
    return value;
  }
  if (length(value) > 64) {
    errors.add('passcode', FIELD_COPY.passcodeTooLong);
    return value;
  }
  if (options.minimum && length(value) < 8) errors.add('passcode', FIELD_COPY.passcodeTooShort);
  return value;
}

export function checkDisplayName(errors: FieldErrors, raw: unknown): string {
  const value = trimmed(raw);
  if (value === '') errors.add('display_name', FIELD_COPY.displayNameRequired);
  else if (length(value) > 40) errors.add('display_name', FIELD_COPY.displayNameTooLong);
  return value;
}

export function checkEmail(errors: FieldErrors, field: string, raw: unknown): string {
  const value = trimmed(raw);
  if (value === '') {
    errors.add(field, FIELD_COPY.emailRequired);
    return value;
  }
  const at = value.indexOf('@');
  const local = at === -1 ? value : value.slice(0, at);
  if (length(value) > 254 || length(local) > 64) {
    errors.add(field, FIELD_COPY.emailTooLong);
    return value;
  }
  const parts = value.split('@');
  const local2 = parts[0] ?? '';
  const domain = parts[1] ?? '';
  const wellFormed =
    parts.length === 2 &&
    local2.length > 0 &&
    domain.length > 0 &&
    domain.includes('.') &&
    !/\s/.test(value);
  if (!wellFormed) errors.add(field, FIELD_COPY.emailFormat);
  return value;
}

export function checkServerName(errors: FieldErrors, raw: unknown): string {
  const value = trimmed(raw);
  if (value === '') {
    errors.add('server_name', FIELD_COPY.serverNameRequired);
    return value;
  }
  if (length(value) > 40) {
    errors.add('server_name', FIELD_COPY.serverNameTooLong);
    return value;
  }
  if (!SERVER_NAME_PATTERN.test(value)) errors.add('server_name', FIELD_COPY.serverNameFormat);
  return value;
}

export function checkCharacterName(errors: FieldErrors, raw: unknown): string {
  const value = trimmed(raw);
  if (value === '') {
    errors.add('name', FIELD_COPY.characterNameRequired);
    return value;
  }
  if (length(value) > 20) {
    errors.add('name', FIELD_COPY.characterNameTooLong);
    return value;
  }
  if (!CHARACTER_NAME_PATTERN.test(value)) errors.add('name', FIELD_COPY.characterNameFormat);
  return value;
}

export function checkWorldName(errors: FieldErrors, raw: unknown): string {
  const value = trimmed(raw);
  if (value === '') errors.add('name', FIELD_COPY.worldNameRequired);
  else if (length(value) > 40) errors.add('name', FIELD_COPY.worldNameTooLong);
  return value;
}

export function checkPartyName(errors: FieldErrors, raw: unknown): string {
  const value = trimmed(raw);
  if (value === '') errors.add('name', FIELD_COPY.partyNameRequired);
  else if (length(value) > 30) errors.add('name', FIELD_COPY.partyNameTooLong);
  return value;
}

export function checkMessage(errors: FieldErrors, raw: unknown): string {
  const value = trimmed(raw);
  if (value === '') errors.add('text', FIELD_COPY.messageRequired);
  else if (length(value) > 280) errors.add('text', FIELD_COPY.messageTooLong);
  return value;
}

export function checkStake(errors: FieldErrors, raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0 || raw > 100) {
    errors.add('stake', FIELD_COPY.stake);
    return 0;
  }
  return raw;
}

export function checkTurnSeconds(errors: FieldErrors, raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 5 || raw > 120) {
    errors.add('turn_seconds', FIELD_COPY.turnSeconds);
    return 30;
  }
  return raw;
}

export function checkTimeZone(errors: FieldErrors, raw: unknown): string {
  const value = trimmed(raw);
  if (!TIME_ZONES.includes(value)) {
    errors.add('time_zone', FIELD_COPY.timeZone);
    return 'UTC';
  }
  return value;
}

export function checkChoice<T extends string>(
  errors: FieldErrors,
  field: string,
  raw: unknown,
  allowed: readonly T[],
  message: string,
): T | null {
  const value = trimmed(raw);
  if (!allowed.includes(value as T)) {
    errors.add(field, message);
    return null;
  }
  return value as T;
}

export function requireInteger(errors: FieldErrors, field: string, raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isInteger(raw)) {
    errors.add(field, 'Use a whole number.');
    return 0;
  }
  return raw;
}
