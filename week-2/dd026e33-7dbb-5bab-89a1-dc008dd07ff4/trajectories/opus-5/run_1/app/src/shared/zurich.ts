/** Every date and time a person sees is Europe/Zurich, whatever the device time zone. */

export const HOUSE_TIME_ZONE = 'Europe/Zurich';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const partsFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: HOUSE_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

export interface ZurichParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

export function zurichParts(instant: Date): ZurichParts {
  const map = new Map<string, string>();
  for (const part of partsFormat.formatToParts(instant)) map.set(part.type, part.value);
  const hour = Number(map.get('hour'));
  return {
    year: Number(map.get('year')),
    month: Number(map.get('month')),
    day: Number(map.get('day')),
    hour: hour === 24 ? 0 : hour,
    minute: Number(map.get('minute')),
    second: Number(map.get('second')),
  };
}

function pad(value: number, width = 2): string {
  return String(value).padStart(width, '0');
}

/** The Zurich calendar date of an instant, as YYYY-MM-DD. */
export function zurichDate(instant: Date): string {
  const p = zurichParts(instant);
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}`;
}

/** The Zurich local slot form of an instant, as YYYY-MM-DDTHH:MM. */
export function zurichLocal(instant: Date): string {
  const p = zurichParts(instant);
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

export interface LocalFields {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
}

/** Converts Zurich wall-clock fields to the matching instant. */
export function zurichToInstant(fields: LocalFields): Date {
  const naive = Date.UTC(fields.year, fields.month - 1, fields.day, fields.hour, fields.minute, 0, 0);
  let guess = naive;
  for (let round = 0; round < 3; round += 1) {
    const p = zurichParts(new Date(guess));
    const seen = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, 0, 0);
    const drift = naive - seen;
    if (drift === 0) break;
    guess += drift;
  }
  return new Date(guess);
}

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const LOCAL_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

export function parseDateOnly(value: string): LocalFields | null {
  const match = DATE_PATTERN.exec(value);
  if (!match) return null;
  const [, y, m, d] = match;
  const fields = { year: Number(y), month: Number(m), day: Number(d), hour: 0, minute: 0 };
  if (!isRealDate(fields)) return null;
  return fields;
}

export function parseLocalSlot(value: string): LocalFields | null {
  const match = LOCAL_PATTERN.exec(value);
  if (!match) return null;
  const [, y, m, d, h, min] = match;
  const fields = {
    year: Number(y),
    month: Number(m),
    day: Number(d),
    hour: Number(h),
    minute: Number(min),
  };
  if (!isRealDate(fields) || fields.hour > 23 || fields.minute > 59) return null;
  return fields;
}

function isRealDate(fields: LocalFields): boolean {
  if (fields.month < 1 || fields.month > 12 || fields.day < 1) return false;
  const probe = new Date(Date.UTC(fields.year, fields.month - 1, fields.day));
  return probe.getUTCMonth() === fields.month - 1 && probe.getUTCDate() === fields.day;
}

/** Zero for Sunday, through six for Saturday, for a Zurich calendar date. */
export function weekdayOf(fields: LocalFields): number {
  return new Date(Date.UTC(fields.year, fields.month - 1, fields.day)).getUTCDay();
}

export function localToDateOnly(fields: LocalFields): string {
  return `${pad(fields.year, 4)}-${pad(fields.month)}-${pad(fields.day)}`;
}

export function localToSlot(fields: LocalFields): string {
  return `${localToDateOnly(fields)}T${pad(fields.hour)}:${pad(fields.minute)}`;
}

/** `3 Nov 2026` from a YYYY-MM-DD Zurich calendar date. */
export function dateLabel(dateOnly: string): string {
  const fields = parseDateOnly(dateOnly);
  if (!fields) return dateOnly;
  return `${fields.day} ${MONTHS[fields.month - 1]} ${fields.year}`;
}

/** `3 Nov 2026` for the Zurich calendar date of an instant. */
export function instantDateLabel(instant: Date): string {
  return dateLabel(zurichDate(instant));
}

/** `Tue 3 Nov 2026, 10:30` from a Zurich local YYYY-MM-DDTHH:MM. */
export function slotLabel(slot: string): string {
  const fields = parseLocalSlot(slot);
  if (!fields) return slot;
  return `${WEEKDAYS[weekdayOf(fields)]} ${fields.day} ${MONTHS[fields.month - 1]} ${fields.year}, ${pad(fields.hour)}:${pad(fields.minute)}`;
}

/** `Tue 3 Nov 2026, 10:42` for the Zurich date and time of an instant. */
export function momentLabel(instant: Date): string {
  return slotLabel(zurichLocal(instant));
}

export function addSeconds(instant: Date, seconds: number): Date {
  return new Date(instant.getTime() + seconds * 1000);
}

/** The Zurich calendar date `days` after an instant. */
export function zurichDatePlusDays(instant: Date, days: number): string {
  const p = zurichParts(instant);
  const shifted = new Date(Date.UTC(p.year, p.month - 1, p.day + days));
  return `${pad(shifted.getUTCFullYear(), 4)}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}
