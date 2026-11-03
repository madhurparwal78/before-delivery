import { parseMoney } from '../../shared/money';
import { parseAgencyDate, parseAgencyDateTime } from '../../shared/time';
import {
  CREDENTIAL_TYPES,
  CredentialType,
  SETTINGS,
  Setting,
} from '../../shared/types';
import { Db, queryOne } from '../db/pool';
import { validationFailed } from './errors';

const MAX_LENGTH_MINUTES = 600;
const MIN_LENGTH_MINUTES = 30;
const LOGGED_AFTER_LIMIT_DAYS = 14;

export class FieldErrors {
  private readonly fields: Record<string, string> = {};

  add(field: string, message: string): void {
    if (!(field in this.fields)) this.fields[field] = message;
  }

  get empty(): boolean {
    return Object.keys(this.fields).length === 0;
  }

  throwIfAny(): void {
    if (!this.empty) throw validationFailed(this.fields);
  }
}

/** Accepts the agency-time form the screens use, or a full ISO 8601 instant. */
export function readInstant(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const agency = parseAgencyDateTime(value);
  if (agency) return agency;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(value.trim())) {
    const parsed = new Date(value.trim());
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return null;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

export interface RequestInput {
  title: string;
  setting: Setting;
  location: string;
  start: Date;
  end: Date;
  consumer_id: string;
  notes: string;
}

export interface RequestInputOptions {
  partial: boolean;
  loggedAfter: boolean;
  now: Date;
  current?: { start: Date; end: Date };
}

export async function readRequestInput(
  db: Db,
  body: Record<string, unknown>,
  options: RequestInputOptions,
): Promise<Partial<RequestInput>> {
  const errors = new FieldErrors();
  const result: Partial<RequestInput> = {};
  const present = (field: string): boolean => Object.prototype.hasOwnProperty.call(body, field);

  if (present('title') || !options.partial) {
    const title = readString(body.title)?.trim() ?? '';
    if (title.length < 1 || title.length > 120) {
      errors.add('title', 'Give a title of 1 to 120 characters.');
    } else {
      result.title = title;
    }
  }
  if (present('setting') || !options.partial) {
    const setting = readString(body.setting);
    if (!setting || !SETTINGS.includes(setting as Setting)) {
      errors.add('setting', 'Choose Medical, Legal, Education or Community.');
    } else {
      result.setting = setting as Setting;
    }
  }
  if (present('location') || !options.partial) {
    const location = readString(body.location)?.trim() ?? '';
    if (location.length < 1 || location.length > 200) {
      errors.add('location', 'Give a location of 1 to 200 characters.');
    } else {
      result.location = location;
    }
  }
  if (present('start') || !options.partial) {
    const start = readInstant(body.start);
    if (!start) {
      errors.add('start', 'Use the form YYYY-MM-DDTHH:MM in agency time.');
    } else {
      result.start = start;
    }
  }
  if (present('end') || !options.partial) {
    const end = readInstant(body.end);
    if (!end) {
      errors.add('end', 'Use the form YYYY-MM-DDTHH:MM in agency time.');
    } else {
      result.end = end;
    }
  }
  if (present('notes')) {
    const notes = readString(body.notes) ?? '';
    if (notes.length > 2000) {
      errors.add('notes', 'Keep notes to 2000 characters or fewer.');
    } else {
      result.notes = notes;
    }
  } else if (!options.partial) {
    result.notes = '';
  }
  if (present('consumer_id') || !options.partial) {
    const consumerId = readString(body.consumer_id) ?? '';
    const consumer = /^[0-9a-f-]{36}$/i.test(consumerId)
      ? await queryOne<{ id: string }>(
          db,
          `select id from users where id = $1 and role = 'consumer'`,
          [consumerId],
        )
      : null;
    if (!consumer) {
      errors.add('consumer_id', 'Choose a Deaf consumer from the list.');
    } else {
      result.consumer_id = consumer.id;
    }
  }

  const start = result.start ?? options.current?.start;
  const end = result.end ?? options.current?.end;
  if (start && end) {
    const minutes = (end.getTime() - start.getTime()) / 60000;
    if (minutes <= 0) {
      errors.add('end', 'End must be after start.');
    } else if (minutes < MIN_LENGTH_MINUTES) {
      errors.add('end', 'An assignment runs for at least 30 minutes.');
    } else if (minutes > MAX_LENGTH_MINUTES) {
      errors.add('end', 'An assignment runs for at most 10 hours.');
    }
  }
  if (start) {
    const aheadMs = start.getTime() - options.now.getTime();
    if (options.loggedAfter) {
      if (aheadMs >= 0) {
        errors.add('start', 'A logged assignment must have started already.');
      } else if (aheadMs < -LOGGED_AFTER_LIMIT_DAYS * 86400000) {
        errors.add('start', 'A logged assignment can be at most 14 days old.');
      }
    } else if (aheadMs <= 0) {
      errors.add('start', 'Start must be in the future.');
    }
  }

  errors.throwIfAny();
  return result;
}

export interface TimesheetInput {
  actualStart: Date;
  actualEnd: Date;
  signatureName: string;
}

export function readTimesheetInput(body: Record<string, unknown>): TimesheetInput {
  const errors = new FieldErrors();
  const actualStart = readInstant(body.actual_start);
  const actualEnd = readInstant(body.actual_end);
  const signatureName = readString(body.signature_name)?.trim() ?? '';
  if (!actualStart) errors.add('actual_start', 'Use the form YYYY-MM-DDTHH:MM in agency time.');
  if (!actualEnd) errors.add('actual_end', 'Use the form YYYY-MM-DDTHH:MM in agency time.');
  if (signatureName.length < 2 || signatureName.length > 120) {
    errors.add('signature_name', 'Sign with a name of 2 to 120 characters.');
  }
  if (actualStart && actualEnd) {
    const minutes = (actualEnd.getTime() - actualStart.getTime()) / 60000;
    if (minutes <= 0) {
      errors.add('actual_end', 'Actual end must be after actual start.');
    } else if (minutes > 12 * 60) {
      errors.add('actual_end', 'A timesheet covers at most 12 hours.');
    }
  }
  errors.throwIfAny();
  if (!actualStart || !actualEnd) throw validationFailed({ actual_start: 'Invalid times.' });
  return { actualStart, actualEnd, signatureName };
}

export interface CredentialInput {
  type: CredentialType;
  number: string;
  expiresOn: string;
}

export function readCredentialInput(fields: Record<string, string>): CredentialInput {
  const errors = new FieldErrors();
  const type = fields.type ?? '';
  const number = (fields.number ?? '').trim();
  const expiresOn = parseAgencyDate(fields.expires_on ?? '');
  if (!CREDENTIAL_TYPES.includes(type as CredentialType)) {
    errors.add('type', 'Choose NIC, CDI, SC:L or EIPA-4.0.');
  }
  if (number.length < 1 || number.length > 40) {
    errors.add('number', 'Give a credential number of 1 to 40 characters.');
  }
  if (!expiresOn) errors.add('expires_on', 'Use the form YYYY-MM-DD.');
  errors.throwIfAny();
  return { type: type as CredentialType, number, expiresOn: expiresOn ?? '' };
}

export function readRatesInput(body: Record<string, unknown>): Partial<Record<Setting, number>> {
  const errors = new FieldErrors();
  const patch: Partial<Record<Setting, number>> = {};
  let given = 0;
  for (const setting of SETTINGS) {
    if (!Object.prototype.hasOwnProperty.call(body, setting)) continue;
    given += 1;
    const raw = body[setting];
    const cents = typeof raw === 'string' ? parseMoney(raw) : null;
    if (cents === null || cents <= 0 || cents > 100000) {
      errors.add(setting, 'Give an hourly rate above 0.00 and no more than 1000.00.');
    } else {
      patch[setting] = cents;
    }
  }
  if (given === 0) errors.add('medical', 'Give at least one hourly rate.');
  errors.throwIfAny();
  return patch;
}

export function readIdList(value: unknown, field: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw validationFailed({ [field]: 'Send an array of interpreter ids.' });
  }
  return value as string[];
}
