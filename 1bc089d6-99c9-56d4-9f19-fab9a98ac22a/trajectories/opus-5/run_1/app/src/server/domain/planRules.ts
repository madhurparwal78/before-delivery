import type { PlanRitual, ReminderState } from '../../shared/plan.js';
import {
  FIELD_MESSAGES,
  isKnownTimeZone,
  isReminderState,
  isValidBedtime,
  isValidEmail,
  isValidNote,
  normaliseEmail,
  readRituals,
} from '../../shared/planRules.js';
import { ApiError } from '../errors.js';

export { FIELD_MESSAGES, isValidEmail, normaliseEmail };

export interface PlanValues {
  email?: string;
  bedtime?: string;
  timeZone?: string;
  rituals?: PlanRitual[];
  note?: string;
  reminders?: ReminderState;
}

const CREATE_KEYS = ['email', 'bedtime', 'time_zone', 'rituals', 'note'];
const EDIT_KEYS = ['bedtime', 'time_zone', 'rituals', 'note', 'reminders'];

/**
 * Checks the keys a request carries against the plan rules. `create` requires the four
 * fields of a new hour; `edit` checks only the keys present and leaves the rest stored.
 */
export function readPlanInput(mode: 'create' | 'edit', body: Record<string, unknown>): PlanValues {
  const allowed = mode === 'create' ? CREATE_KEYS : EDIT_KEYS;
  const fields: Record<string, string> = {};
  const values: PlanValues = {};

  const check = (key: string, ok: boolean, assign: () => void): void => {
    if (ok) assign();
    else fields[key] = FIELD_MESSAGES[key as keyof typeof FIELD_MESSAGES];
  };

  for (const key of allowed) {
    if (!Object.prototype.hasOwnProperty.call(body, key)) {
      if (mode === 'create' && key !== 'note') fields[key] = FIELD_MESSAGES[key as keyof typeof FIELD_MESSAGES];
      continue;
    }
    const value = body[key];
    switch (key) {
      case 'email':
        check(key, isValidEmail(value), () => {
          values.email = normaliseEmail(value as string);
        });
        break;
      case 'bedtime':
        check(key, isValidBedtime(value), () => {
          values.bedtime = value as string;
        });
        break;
      case 'time_zone':
        check(key, isKnownTimeZone(value), () => {
          values.timeZone = value as string;
        });
        break;
      case 'rituals': {
        const rituals = readRituals(value);
        check(key, rituals !== null, () => {
          values.rituals = rituals!;
        });
        break;
      }
      case 'note':
        check(key, isValidNote(value), () => {
          values.note = value as string;
        });
        break;
      case 'reminders':
        check(key, isReminderState(value), () => {
          values.reminders = value as ReminderState;
        });
        break;
    }
  }

  for (const key of Object.keys(body)) {
    if (!allowed.includes(key)) fields[key] = FIELD_MESSAGES.unknown;
  }

  if (Object.keys(fields).length > 0) throw new ApiError('invalid', { fields });
  if (mode === 'create' && values.note === undefined) values.note = '';
  return values;
}
