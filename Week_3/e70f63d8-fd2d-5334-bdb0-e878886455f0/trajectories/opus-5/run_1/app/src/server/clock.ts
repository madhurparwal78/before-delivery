import { config } from './config.js';

let offsetMs = 0;

export function setNow(iso: string | null): Date {
  offsetMs = iso === null ? 0 : new Date(iso).getTime() - Date.now();
  return now();
}

export function now(): Date {
  return new Date(Date.now() + offsetMs);
}

/** The calendar date in APP_TZ, as `YYYY-MM-DD`. */
export function today(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: config.appTz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now());
  return parts;
}
