import type { Setting } from '../../shared/api.js';
import { codePointLength } from '../domain/text.js';
import { resolveAgencyStart } from '../domain/time.js';
import { FIELD_MESSAGES, validationError } from './errors.js';

const SETTINGS: Setting[] = ['medical', 'educational', 'legal', 'workplace'];
const PHONE_CHARACTERS = /^[0-9 +\-()]+$/;

export class FieldErrors {
  private readonly fields: Record<string, string> = {};

  add(field: string, message: string): void {
    if (this.fields[field] === undefined) this.fields[field] = message;
  }

  get empty(): boolean {
    return Object.keys(this.fields).length === 0;
  }

  throwIfAny(): void {
    if (!this.empty) throw validationError({ ...this.fields });
  }
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function inRange(value: string, min: number, max: number): boolean {
  const length = codePointLength(value);
  if (length < min || length > max) return false;
  return !(min >= 1 && value.trim().length === 0);
}

export function integerFrom(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  return null;
}

export interface BookingDraft {
  orgId: string;
  setting: Setting;
  title: string;
  location: string;
  onsiteContactName: string;
  onsiteContactPhone: string;
  consumerName: string;
  start: Date;
  durationMinutes: number;
  requesterNotes: string;
}

export interface BookingDraftContext {
  now: Date;
  orgIdFromBody: boolean;
  knownOrgIds: readonly string[];
  requesterOrgId: string | null;
}

export function validateBookingDraft(
  body: Record<string, unknown>,
  context: BookingDraftContext,
): BookingDraft {
  const errors = new FieldErrors();

  let orgId = context.requesterOrgId ?? '';
  if (context.orgIdFromBody) {
    const candidate = asString(body['org_id']);
    if (candidate === null || !context.knownOrgIds.includes(candidate)) {
      errors.add('org_id', FIELD_MESSAGES.org_id);
      orgId = '';
    } else {
      orgId = candidate;
    }
  }

  const settingValue = asString(body['setting']);
  if (settingValue === null || !SETTINGS.includes(settingValue as Setting)) {
    errors.add('setting', FIELD_MESSAGES.setting);
  }

  const title = asString(body['title']) ?? '';
  if (!inRange(title, 1, 120)) errors.add('title', FIELD_MESSAGES.title);

  const location = asString(body['location']) ?? '';
  if (!inRange(location, 1, 200)) errors.add('location', FIELD_MESSAGES.location);

  const onsiteContactName = asString(body['onsite_contact_name']) ?? '';
  if (!inRange(onsiteContactName, 1, 80)) {
    errors.add('onsite_contact_name', FIELD_MESSAGES.onsite_contact_name);
  }

  const onsiteContactPhone = asString(body['onsite_contact_phone']) ?? '';
  if (!inRange(onsiteContactPhone, 7, 25) || !PHONE_CHARACTERS.test(onsiteContactPhone)) {
    errors.add('onsite_contact_phone', FIELD_MESSAGES.onsite_contact_phone);
  }

  const consumerName = asString(body['consumer_name']) ?? '';
  if (!inRange(consumerName, 1, 80)) errors.add('consumer_name', FIELD_MESSAGES.consumer_name);

  const resolution = resolveAgencyStart(body['start']);
  let start: Date | null = null;
  if (resolution.kind === 'malformed') errors.add('start', FIELD_MESSAGES.start_malformed);
  else if (resolution.kind === 'nonexistent') {
    errors.add('start', FIELD_MESSAGES.start_nonexistent);
  } else if (resolution.instant.getTime() < context.now.getTime() + 15 * 60_000) {
    errors.add('start', FIELD_MESSAGES.start_too_soon);
  } else {
    start = resolution.instant;
  }

  const durationMinutes = integerFrom(body['duration_minutes']);
  if (
    durationMinutes === null ||
    durationMinutes < 30 ||
    durationMinutes > 480 ||
    durationMinutes % 15 !== 0
  ) {
    errors.add('duration_minutes', FIELD_MESSAGES.duration_minutes);
  }

  const requesterNotes = body['requester_notes'] === undefined ? '' : asString(body['requester_notes']);
  if (requesterNotes === null || codePointLength(requesterNotes) > 1000) {
    errors.add('requester_notes', FIELD_MESSAGES.requester_notes);
  }

  errors.throwIfAny();

  return {
    orgId,
    setting: settingValue as Setting,
    title,
    location,
    onsiteContactName,
    onsiteContactPhone,
    consumerName,
    start: start as Date,
    durationMinutes: durationMinutes as number,
    requesterNotes: requesterNotes as string,
  };
}
