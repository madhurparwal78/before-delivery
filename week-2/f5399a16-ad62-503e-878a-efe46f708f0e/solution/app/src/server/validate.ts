// Reading fields from a body. Each returns the value, or records its published message.

import { COPY } from '../shared/copy';
import { isRealClock, isRealDate } from '../shared/time';
import { FRAME_RATES, type FrameRate } from '../shared/timecode';
import { invalid } from './http';

export type Fields = Record<string, string>;

/** The largest whole number a column holds. */
const WHOLE_LIMIT = 2_147_483_647;

export function throwIfAny(fields: Fields): void {
  if (Object.keys(fields).length) throw invalid(fields);
}

/** The address given in a raw JSON body, before anything else about it is judged. */
export function addressGiven(raw: Buffer): string | null {
  try {
    const email = (JSON.parse(raw.toString('utf8')) as { email?: unknown }).email;
    return typeof email === 'string' && !email.includes('\0') ? email.toLowerCase() : null;
  } catch {
    return null;
  }
}

export function isMail(value: unknown): value is string {
  return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function filled(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

export function checkName(fields: Fields, key: string, value: unknown): string {
  if (!filled(value)) fields[key] = COPY.typeName;
  return value as string;
}

export function checkMail(fields: Fields, key: string, value: unknown): string {
  if (!isMail(value)) fields[key] = COPY.typeMail;
  return value as string;
}

export function checkDate(fields: Fields, key: string, value: unknown): string {
  if (!isRealDate(value)) fields[key] = COPY.typeDate;
  return value as string;
}

export function checkClock(fields: Fields, key: string, value: unknown): string {
  if (!isRealClock(value)) fields[key] = COPY.typeTime;
  return value as string;
}

export function checkOneOf<T extends string | number>(fields: Fields, key: string, value: unknown, allowed: readonly T[], message: string): T {
  if (!allowed.includes(value as T)) fields[key] = message;
  return value as T;
}

export function checkRate(fields: Fields, key: string, value: unknown): FrameRate {
  return checkOneOf(fields, key, value, FRAME_RATES, 'Pick a frame rate.');
}

export function checkStamp(fields: Fields, value: unknown): string {
  if (!filled(value)) fields.stamp = 'Read this again before saving.';
  return value as string;
}

export function checkWhole(fields: Fields, key: string, value: unknown, minimum: number, message: string): number {
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > WHOLE_LIMIT) fields[key] = message;
  return value as number;
}
