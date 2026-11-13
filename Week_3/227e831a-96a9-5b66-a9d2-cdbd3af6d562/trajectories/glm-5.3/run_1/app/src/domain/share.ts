import type { ListState, PaperSize, DisplayUnit } from './types.js';

/**
 * Share-link validity. One decision, made on every read: a link with no
 * expiry is always valid; a link with an expiry is valid through 23:59:59 of
 * that date in the hiker's current time zone.
 */

export interface ShareExpiry {
  readonly expiresOn: string | null;
}

/** True when the link has expired at the given moment in the hiker's zone. */
export function shareExpired(expiresOn: string | null, now: Date, timeZone: string): boolean {
  if (expiresOn === null) return false;
  const todayInZone = dateInZone(now, timeZone);
  return expiresOn < todayInZone;
}

/** Today's date in the hiker's zone, as YYYY-MM-DD. */
export function dateInZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  return parts;
}

/** Today's date in the hiker's zone, as YYYY-MM-DD (en-CA gives ISO-shaped output). */
export function todayInZone(timeZone: string, now: Date): string {
  return dateInZone(now, timeZone);
}

/** The hiker profile the share and sheet rules read. */
export interface HikerProfile {
  readonly displayName: string;
  readonly unit: DisplayUnit;
  readonly goalGrams: number;
  readonly timeZone: string;
  readonly paperSize: PaperSize;
}
