import { config } from './config';

/**
 * The app clock: the host's time plus APP_CLOCK_OFFSET_SECONDS, read once at
 * start. Every server-side time judgement and every stored or sent instant
 * comes from here, never from the database's own clock.
 */
const offsetMs = config.appClockOffsetSeconds * 1000;

export function nowMs(): number {
  return Date.now() + offsetMs;
}

export function nowDate(): Date {
  return new Date(nowMs());
}

export function isoOf(value: Date | number): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

export function isoOrNull(value: Date | number | null): string | null {
  return value === null ? null : isoOf(value);
}
