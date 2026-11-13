// Field validation rules, in the published order.
import { errors } from './errors.js';

export type Body = Record<string, unknown>;

export function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function isEmail(value: unknown): boolean {
  return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

// A phone number is a run of at least seven digits that may start with + and
// may have a single space, dash or dot between digits.
export function isPhone(value: unknown): boolean {
  const s = typeof value === 'string' ? value.trim() : '';
  if (!/^\+?[\d .-]+$/.test(s)) return false;
  return /^\+?(\d[ .-]?){6,}\d$/.test(s);
}

// Remove review paths so a quoted link is never refused as a phone number.
export function stripReviewPaths(value: string): string {
  return value.replace(/\/companies\/[a-z0-9-]+\/reviews\/[a-z0-9-]+/gi, '');
}

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
const LOOSE_PHONE_RE = /\+?\d(?:[ .-]?\d){6,}/;

export function containsContact(value: unknown): 'contains_email' | 'contains_phone' | null {
  const bare = stripReviewPaths(text(value));
  if (EMAIL_RE.test(bare)) return 'contains_email';
  if (LOOSE_PHONE_RE.test(bare)) return 'contains_phone';
  return null;
}

export const COPY = {
  display_name: 'Use 2 to 40 characters.',
  email: 'Enter an email address.',
  password: 'Use at least 10 characters.',
  company_id: 'Choose a company.',
  rating: 'Choose a rating from 1 to 5.',
  title_review: 'Add a title of 5 to 120 characters.',
  body: 'Write 20 to 3,000 characters.',
  role_family: 'Choose a role.',
  city: 'Choose a city.',
  pay: 'Enter yearly pay between ₹1,00,000 and ₹50,00,000.',
  pay_order: 'The top of the range must be at least the bottom.',
  years: 'Enter 0 to 40 years.',
  outcome: 'Choose what happened.',
  reason: 'Choose a reason.',
  details: 'Add 5 to 200 characters.',
  reply_body: 'Write 20 to 2,000 characters.',
  title_job: 'Use 3 to 120 characters.',
  remote: 'Choose a work pattern.',
  description: 'Write 40 to 5,000 characters.',
  candidate_name: 'Use 2 to 100 characters.',
  phone: 'Enter a phone number or leave it empty.',
  cover_note: 'Use at most 2,000 characters.',
  resume: 'Choose a PDF resume.',
  channel_body: 'Write 1 to 2,000 characters.',
  verification_email: 'Use an address at',
} as const;

export interface Fields {
  [field: string]: string;
}

export function requireString(
  body: Body,
  field: string,
  min: number,
  max: number,
  copy: string,
  fields: Fields,
): string {
  const value = body[field];
  if (typeof value !== 'string') {
    fields[field] = copy;
    return '';
  }
  const len = value.trim().length;
  if (len < min || len > max) fields[field] = copy;
  return value;
}

export function requireInt(
  body: Body,
  field: string,
  min: number,
  max: number,
  copy: string,
  fields: Fields,
): number | null {
  const value = body[field];
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    fields[field] = copy;
    return null;
  }
  return value;
}

export function requireEnum<T extends string>(
  body: Body,
  field: string,
  values: readonly T[],
  copy: string,
  fields: Fields,
): T | null {
  const value = body[field];
  if (typeof value !== 'string' || !(values as readonly string[]).includes(value)) {
    fields[field] = copy;
    return null;
  }
  return value as T;
}

export function throwFields(fields: Fields): void {
  if (Object.keys(fields).length > 0) throw errors.validation(fields);
}
