import { MONTHS_SHORT, WEEKDAYS_SHORT } from './format.js';

export interface ZonedIso {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
}

/**
 * Read the wall-clock fields straight out of an ISO 8601 string that already carries
 * the network offset, so neither side has to convert a time zone.
 */
export function parseZonedIso(iso: string): ZonedIso {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso);
  if (!match) throw new Error(`Not a zoned ISO time: ${iso}`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return {
    year,
    month,
    day,
    hour: Number(match[4]),
    minute: Number(match[5]),
    weekday: new Date(Date.UTC(year, month - 1, day)).getUTCDay(),
  };
}

/** `Fri 13 Nov` */
export function dateLabel(iso: string): string {
  const p = parseZonedIso(iso);
  return `${WEEKDAYS_SHORT[p.weekday]} ${p.day} ${MONTHS_SHORT[p.month - 1]}`;
}

/** `Fri 13 Nov 2026` */
export function dateLabelWithYear(iso: string): string {
  return `${dateLabel(iso)} ${parseZonedIso(iso).year}`;
}

/** `08:30` */
export function timeLabel(iso: string): string {
  const p = parseZonedIso(iso);
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

/** `2026-11-13` */
export function dateKey(iso: string): string {
  const p = parseZonedIso(iso);
  return `${String(p.year).padStart(4, '0')}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}
