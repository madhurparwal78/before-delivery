import { config } from './config';

/**
 * The server clock. PILOTLIGHT_CLOCK_START pins it at process start; from there it
 * advances in real time. Every server-side time rule reads this clock.
 */
const offsetMs = config.clockStart === null ? 0 : Date.parse(config.clockStart) - Date.now();

export function nowMs(): number {
  return Date.now() + offsetMs;
}

export function now(): Date {
  return new Date(nowMs());
}

/** ISO-8601 UTC with exactly three fractional-second digits. */
export function iso(value: Date | number): string {
  const date = typeof value === 'number' ? new Date(value) : value;
  return date.toISOString().replace(/\.(\d{3})\d*Z$/, '.$1Z');
}

export function isoOrNull(value: Date | number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return iso(value);
}

/** RFC 7231 date, to the second, from the server clock. */
export function httpDate(): string {
  return new Date(Math.floor(nowMs() / 1000) * 1000).toUTCString();
}
