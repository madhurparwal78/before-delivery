import { invalid } from '../http/errors';
import { copy } from '../shared/copy';
import { DateOnly, parseDateOnly, wholeYearsBetween } from '../shared/time';
import { STATES_BY_CODE, stateName, stateServed } from '../shared/catalog';
import { TIME_ZONE_IDS, TimeZoneId } from '../shared/time';
import { Cadence } from '../shared/money';

export class FieldErrors {
  private readonly fields: Record<string, string> = {};

  add(field: string, message: string): void {
    if (!(field in this.fields)) this.fields[field] = message;
  }

  get empty(): boolean {
    return Object.keys(this.fields).length === 0;
  }

  throwIfAny(): void {
    if (!this.empty) throw invalid(this.fields);
  }
}

export function readString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

export function validEmail(value: unknown): string | null {
  const text = readString(value)?.trim() ?? '';
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text) ? text : null;
}

export function validPassword(value: unknown): string | null {
  const text = readString(value) ?? '';
  return [...text].length >= 12 ? text : null;
}

export function validName(value: unknown): string | null {
  const text = readString(value)?.trim() ?? '';
  return text.length >= 2 && text.includes(' ') ? text : null;
}

export function validSex(value: unknown): 'female' | 'male' | null {
  return value === 'female' || value === 'male' ? value : null;
}

export function validTimeZone(value: unknown): TimeZoneId | null {
  const text = readString(value);
  return text && (TIME_ZONE_IDS as string[]).includes(text) ? (text as TimeZoneId) : null;
}

export function validCadence(value: unknown): Cadence | null {
  return value === 'sixMonths' || value === 'yearly' ? value : null;
}

export function validState(value: unknown): string | null {
  const text = readString(value)?.toLowerCase() ?? '';
  return STATES_BY_CODE.has(text) ? text : null;
}

export function validDate(value: unknown): DateOnly | null {
  const text = readString(value);
  return text ? parseDateOnly(text) : null;
}

export interface AddressInput {
  line1: string;
  line2: string;
  city: string;
  postalCode: string;
}

export function readAddress(value: unknown, errors: FieldErrors): AddressInput | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object' || Array.isArray(value)) {
    errors.add('address', copy.fieldChooseOption);
    return null;
  }
  const raw = value as Record<string, unknown>;
  const line1 = readString(raw.line1)?.trim() ?? '';
  const line2 = readString(raw.line2)?.trim() ?? '';
  const city = readString(raw.city)?.trim() ?? '';
  const postalCode = readString(raw.postalCode)?.trim() ?? '';
  if (line1 === '') errors.add('address.line1', 'Enter your street address.');
  if (city === '') errors.add('address.city', 'Enter your city.');
  if (!/^\d{5}$/.test(postalCode)) errors.add('postalCode', copy.fieldPostalCode);
  return { line1, line2, city, postalCode };
}

export interface AccountInput {
  name: string;
  email: string;
  password: string;
  dateOfBirth: string;
  sex: 'female' | 'male';
  state: string;
  timeZone: TimeZoneId;
}

export function readAccountInput(
  body: Record<string, unknown>,
  today: DateOnly,
  errors: FieldErrors,
): AccountInput | null {
  const name = validName(body.name);
  if (!name) errors.add('name', copy.fieldName);
  const email = validEmail(body.email);
  if (!email) errors.add('email', copy.fieldEmail);
  const password = validPassword(body.password);
  if (!password) errors.add('password', copy.fieldPassword);
  const rawDate = readString(body.dateOfBirth);
  const dateOfBirth = validDate(body.dateOfBirth);
  if (!dateOfBirth) {
    errors.add('dateOfBirth', rawDate === null ? copy.fieldDateOfBirth : copy.fieldDateForm);
  } else if (wholeYearsBetween(dateOfBirth, today) < 18) {
    errors.add('dateOfBirth', copy.fieldDateOfBirth);
  }
  const sex = validSex(body.sex);
  if (!sex) errors.add('sex', copy.fieldChooseOption);
  const state = validState(body.state);
  if (!state) errors.add('state', copy.fieldChooseOption);
  else if (!stateServed(state)) errors.add('state', copy.stateNotServed(stateName(state)));
  const timeZone = validTimeZone(body.timeZone);
  if (!timeZone) errors.add('timeZone', copy.fieldChooseOption);
  if (!errors.empty) return null;
  return {
    name: name as string,
    email: email as string,
    password: password as string,
    dateOfBirth: (body.dateOfBirth as string).trim(),
    sex: sex as 'female' | 'male',
    state: state as string,
    timeZone: timeZone as TimeZoneId,
  };
}
