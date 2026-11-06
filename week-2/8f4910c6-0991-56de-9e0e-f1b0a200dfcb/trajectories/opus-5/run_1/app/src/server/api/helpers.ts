import { validation } from '../http/errors.js';
import type { Reply } from '../http/router.js';

export function json(status: number, body: unknown, headers?: Record<string, string>): Reply {
  return headers ? { status, json: body, headers } : { status, json: body };
}

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const fieldCopy = {
  required: (label: string): string => `Enter ${label.toLowerCase()}.`,
  email: (): string => 'Enter an email address like name@example.com.',
  bioOverLimit: (used: number): string => `Your bio is ${used} characters; the limit is 600.`,
  notAnImage: (): string => 'That file is not a JPEG, PNG or WebP photo.',
  springForwardGap: (city: string): string => `That time does not exist in ${city}: clocks skip that hour.`,
  holdNotFuture: (): string => 'Choose a time in the future.',
  holdNotBeforeRelease: (time: string): string => `Choose a time before the automatic release at ${time}.`,
  jobDayOutOfRange: (): string =>
    "Options can be placed only while this day's automatic release is still ahead, up to 31 Dec 2027.",
  trayTalentGone: (name: string): string => `${name} is no longer available; remove them to continue.`,
  password: (): string => 'Choose a password of at least 12 characters.',
  chooseFrom: (label: string): string => `Enter ${label.toLowerCase()}.`,
  wholeNumber: (label: string): string => `Enter ${label.toLowerCase()} as a whole number.`,
  outOfRange: (label: string): string => `Enter ${label.toLowerCase()} within the allowed range.`,
  rosterHeader: (): string => 'The header row does not match the roster export format.',
} as const;

/** Collects field errors so a form can show every problem at once. */
export class FieldErrors {
  private readonly errors: Record<string, string> = {};

  add(field: string, copy: string): void {
    if (!this.errors[field]) this.errors[field] = copy;
  }

  throwIfAny(): void {
    if (Object.keys(this.errors).length > 0) throw validation({ ...this.errors });
  }
}

export function readString(body: Record<string, unknown>, key: string): string | null {
  const value = body[key];
  return typeof value === 'string' ? value : null;
}

export function readNumber(body: Record<string, unknown>, key: string): number | null {
  const value = body[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function readRecord(body: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const value = body[key];
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function readArray(body: Record<string, unknown>, key: string): unknown[] | null {
  const value = body[key];
  return Array.isArray(value) ? value : null;
}

/** Single-line fields never keep control characters, so headers stay safe. */
export function cleanSingleLine(value: string): string {
  return value.replace(/[\u0000-\u0008\u000a-\u001f\u007f]+/g, ' ').trim();
}

export function countGraphemes(value: string): number {
  const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
  let count = 0;
  for (const _ of segmenter.segment(value)) count += 1;
  return count;
}
