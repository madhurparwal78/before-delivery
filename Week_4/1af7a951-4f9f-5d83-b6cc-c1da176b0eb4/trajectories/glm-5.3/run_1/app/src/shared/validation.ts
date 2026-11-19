import { MESSAGES } from './errors.js';
import { BEDTIME_MIN, BEDTIME_MAX } from './nights.js';
import { codePoints, hasControlChar, isBlank } from './chars.js';
import { isAcceptedZone } from './timezones.js';
import type { Technique } from './domain.js';

// Strict field validation. Every failing field is reported together.

type Fields = Record<string, string>;

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function asBool(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  return null;
}

function asWhole(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (!Number.isInteger(value)) return null;
  return value;
}

function wholeInRange(value: unknown, min: number, max: number): number | null {
  const n = asWhole(value);
  return n === null || n < min || n > max ? null : n;
}

// Returns null when the value fails, otherwise the stored value.
export function validateName(value: unknown, message: string): string | null {
  const s = asString(value);
  if (s === null) return null;
  if (codePoints(s) < 1 || codePoints(s) > 80) return null;
  if (isBlank(s)) return null;
  if (hasControlChar(s)) return null;
  return s;
}

export interface EnrolmentFields {
  name: string;
  email: string;
  home_tz: string;
  bedtime: string;
}

export function validateEnrolment(body: Record<string, unknown>): { fields: EnrolmentFields } | { errors: Fields } {
  const errors: Fields = {};
  const name = validateName(body['name'], MESSAGES.enrollmentName);
  if (name === null) errors['name'] = MESSAGES.enrollmentName;
  const emailRaw = asString(body['email']);
  if (emailRaw === null || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw)) errors['email'] = MESSAGES.email;
  const tz = asString(body['home_tz']);
  if (tz === null || !isAcceptedZone(tz)) errors['home_tz'] = MESSAGES.homeTz;
  const bedtime = asString(body['bedtime']);
  if (bedtime === null || !/^\d{2}:\d{2}$/.test(bedtime) || bedtime < BEDTIME_MIN || bedtime > BEDTIME_MAX) {
    errors['bedtime'] = MESSAGES.bedtime;
  }
  if (Object.keys(errors).length > 0) return { errors };
  return {
    fields: {
      name: name as string,
      email: emailRaw as string,
      home_tz: tz as string,
      bedtime: bedtime as string,
    },
  };
}

export function validateSettings(body: Record<string, unknown>): { fields: { home_tz?: string; bedtime?: string } } | { errors: Fields } {
  const errors: Fields = {};
  let homeTz: string | undefined;
  let bedtime: string | undefined;
  if ('home_tz' in body) {
    const tz = asString(body['home_tz']);
    if (tz === null || !isAcceptedZone(tz)) errors['home_tz'] = MESSAGES.homeTz;
    else homeTz = tz;
  }
  if ('bedtime' in body) {
    const bt = asString(body['bedtime']);
    if (bt === null || !/^\d{2}:\d{2}$/.test(bt) || bt < BEDTIME_MIN || bt > BEDTIME_MAX) errors['bedtime'] = MESSAGES.bedtime;
    else bedtime = bt;
  }
  if (Object.keys(errors).length > 0) return { errors };
  return { fields: { home_tz: homeTz, bedtime } };
}

export interface EntryFields {
  title: string;
  text: string;
  dreams_recalled: number;
  lucid: boolean;
  wbtb: boolean;
  technique: Technique;
  technique_minutes: number;
}

export function validateEntry(body: Record<string, unknown>): { fields: EntryFields } | { errors: Fields } {
  const errors: Fields = {};
  const title = asString(body['title']);
  if (title === null || codePoints(title) > 120) errors['title'] = MESSAGES.title;
  const text = asString(body['text']);
  if (text === null || isBlank(text)) errors['text'] = MESSAGES.textRequired;
  else if (codePoints(text) > 20000) errors['text'] = MESSAGES.textLength;
  const recalled = wholeInRange(body['dreams_recalled'], 0, 20);
  if (recalled === null) errors['dreams_recalled'] = MESSAGES.dreamsRecalled;
  const lucid = asBool(body['lucid']);
  if (lucid === null) errors['lucid'] = MESSAGES.lucid;
  const wbtb = asBool(body['wbtb']);
  if (wbtb === null) errors['wbtb'] = MESSAGES.wbtb;
  const techRaw = asString(body['technique']);
  if (techRaw === null || !['none', 'mild', 'ssild'].includes(techRaw)) errors['technique'] = MESSAGES.technique;
  const minutes = wholeInRange(body['technique_minutes'], 0, 180);
  if (minutes === null) errors['technique_minutes'] = MESSAGES.techniqueMinutes;
  if (Object.keys(errors).length > 0) return { errors };
  const technique = (techRaw === 'mild' || techRaw === 'ssild' ? techRaw : 'none') as Technique;
  return {
    fields: {
      title: title as string,
      text: text as string,
      dreams_recalled: recalled as number,
      lucid: lucid as boolean,
      wbtb: wbtb as boolean,
      technique,
      technique_minutes: minutes as number,
    },
  };
}

export interface CohortFields {
  name: string;
  starts_on: string;
  price_cents: number;
  seats: number;
}

export function validateCohort(body: Record<string, unknown>): { fields: CohortFields } | { errors: Fields } {
  const errors: Fields = {};
  const name = validateName(body['name'], MESSAGES.cohortName);
  if (name === null) errors['name'] = MESSAGES.cohortName;
  const starts = asString(body['starts_on']);
  if (starts === null || !/^\d{4}-\d{2}-\d{2}$/.test(starts) || !isValidDateKey(starts)) errors['starts_on'] = MESSAGES.startsOn;
  const price = wholeInRange(body['price_cents'], 100, 100000);
  if (price === null) errors['price_cents'] = MESSAGES.priceCents;
  const seats = wholeInRange(body['seats'], 1, 50);
  if (seats === null) errors['seats'] = MESSAGES.seats;
  if (Object.keys(errors).length > 0) return { errors };
  return { fields: { name: name as string, starts_on: starts as string, price_cents: price as number, seats: seats as number } };
}

function isValidDateKey(key: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

export interface SignRequest {
  start: number;
  end: number;
  category: 'inner_awareness' | 'action' | 'form' | 'context';
}

export function validateSignShape(body: Record<string, unknown>): { fields: SignRequest } | { errors: Fields } {
  const errors: Fields = {};
  const start = asWhole(body['start']);
  const end = asWhole(body['end']);
  if (start === null || end === null) errors['range'] = MESSAGES.range;
  const cat = asString(body['category']);
  if (cat === null || !['inner_awareness', 'action', 'form', 'context'].includes(cat)) errors['category'] = MESSAGES.category;
  if (Object.keys(errors).length > 0) return { errors };
  return {
    fields: {
      start: start as number,
      end: end as number,
      category: cat as SignRequest['category'],
    },
  };
}
