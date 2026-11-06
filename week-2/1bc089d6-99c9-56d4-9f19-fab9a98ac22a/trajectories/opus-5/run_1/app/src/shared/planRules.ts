import {
  MAX_HOUR_MINUTES,
  MAX_NOTE_CHARACTERS,
  MAX_RITUAL_MINUTES,
  MIN_RITUAL_MINUTES,
  RITUAL_MINUTE_STEP,
  findRitual,
} from './rituals.js';
import { countCharacters, type PlanRitual } from './plan.js';

/** The plan's field rules, used by the API and by the browser before it sends. */
export const FIELD_MESSAGES = {
  email: 'Enter an email address, like name@example.com.',
  bedtime: 'Choose a bedtime on a five-minute step, like 22:30.',
  time_zone: 'Choose a time zone from the list.',
  rituals: 'Choose between one and six rituals, 5 to 30 minutes each, 60 minutes at most in total.',
  note: 'Keep your note to 280 characters.',
  reminders: 'Choose on or paused.',
  unknown: 'This field is not accepted.',
  token: 'Paste the full link from your email.',
  now: 'Send an ISO 8601 date and time with a time zone.',
} as const;

export const FIELD_LABELS: Record<string, string> = {
  email: 'Email',
  bedtime: 'Bedtime',
  time_zone: 'Time zone',
  rituals: 'Rituals',
  note: 'A note for tonight',
  reminders: 'Reminders',
};

export function normaliseEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function isValidEmail(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const email = normaliseEmail(value);
  if (email.length === 0 || email.length > 254) return false;
  if (/\s/.test(email)) return false;
  const parts = email.split('@');
  if (parts.length !== 2) return false;
  const [local, domain] = parts as [string, string];
  if (local.length === 0 || domain.length === 0) return false;
  if (!domain.includes('.')) return false;
  return !domain.startsWith('.') && !domain.endsWith('.') && !domain.includes('..');
}

export function isValidBedtime(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return false;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59 && minutes % 5 === 0;
}

/** An IANA name such as Europe/London or UTC. Offsets like +02:00 are refused. */
export function isKnownTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || value === '' || /^[+-]/.test(value)) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** Reads a ritual list, answering null when it breaks the ritual rule. */
export function readRituals(value: unknown): PlanRitual[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 6) return null;
  const rituals: PlanRitual[] = [];
  const seen = new Set<string>();
  let total = 0;
  for (const item of value) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return null;
    const keys = Object.keys(item as Record<string, unknown>).sort();
    if (keys.length !== 2 || keys[0] !== 'id' || keys[1] !== 'minutes') return null;
    const { id, minutes } = item as { id: unknown; minutes: unknown };
    if (typeof id !== 'string') return null;
    const catalogue = findRitual(id);
    if (!catalogue || seen.has(id)) return null;
    if (typeof minutes !== 'number' || !Number.isInteger(minutes)) return null;
    if (minutes < MIN_RITUAL_MINUTES || minutes > MAX_RITUAL_MINUTES || minutes % RITUAL_MINUTE_STEP !== 0) return null;
    seen.add(id);
    total += minutes;
    rituals.push({ id, title: catalogue.title, minutes });
  }
  return total <= MAX_HOUR_MINUTES ? rituals : null;
}

export function isValidNote(value: unknown): value is string {
  return typeof value === 'string' && countCharacters(value) <= MAX_NOTE_CHARACTERS;
}

export function isReminderState(value: unknown): value is 'on' | 'paused' {
  return value === 'on' || value === 'paused';
}
