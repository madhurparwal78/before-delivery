export const AGENCY_TZ = 'America/New_York';

const partsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: AGENCY_TZ,
  hour12: false,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

export interface AgencyParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function agencyParts(date: Date): AgencyParts {
  const parts = partsFormatter.formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const found = parts.find((part) => part.type === type);
    return Number(found ? found.value : '0');
  };
  const hour = read('hour');
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: hour === 24 ? 0 : hour,
    minute: read('minute'),
    second: read('second'),
  };
}

/** Minutes that agency time is offset from UTC at the given instant (negative west of UTC). */
export function agencyOffsetMinutes(date: Date): number {
  const p = agencyParts(date);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}

const pad = (value: number, width = 2): string => String(Math.abs(value)).padStart(width, '0');

/** Parses `YYYY-MM-DDTHH:MM` written in agency time. */
export function parseAgencyDateTime(text: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(text.trim());
  if (!match) return null;
  const [, y, mo, d, h, mi] = match;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  const hour = Number(h);
  const minute = Number(mi);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
  const naive = Date.UTC(year, month - 1, day, hour, minute);
  let instant = new Date(naive);
  for (let round = 0; round < 3; round += 1) {
    const offset = agencyOffsetMinutes(instant);
    instant = new Date(naive - offset * 60000);
  }
  const check = agencyParts(instant);
  if (check.year !== year || check.month !== month || check.day !== day) return null;
  return instant;
}

/** Parses `YYYY-MM-DD` and returns it unchanged when it names a real date. */
export function parseAgencyDate(text: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text.trim());
  if (!match) return null;
  const [, y, mo, d] = match;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() + 1 !== month || probe.getUTCDate() !== day) {
    return null;
  }
  return `${y}-${mo}-${d}`;
}

export function toIsoWithOffset(date: Date): string {
  const p = agencyParts(date);
  const offset = agencyOffsetMinutes(date);
  const sign = offset < 0 ? '-' : '+';
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}` +
    `${sign}${pad(Math.trunc(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`;
}

export function agencyDateOf(date: Date): string {
  const p = agencyParts(date);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

export function agencyClock(date: Date): string {
  const p = agencyParts(date);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

/** "Tue 27 Oct" */
export function agencyCardDate(date: Date): string {
  const p = agencyParts(date);
  const weekday = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
  return `${WEEKDAYS_SHORT[weekday]} ${p.day} ${MONTHS_SHORT[p.month - 1]}`;
}

/** "Tuesday 27 October" */
export function agencyDayHeading(date: Date): string {
  const p = agencyParts(date);
  const weekday = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
  return `${WEEKDAYS_LONG[weekday]} ${p.day} ${MONTHS_LONG[p.month - 1]}`;
}


/** Start of the hour containing the instant, in agency time. */
export function floorToAgencyHour(date: Date): Date {
  const p = agencyParts(date);
  const floored = parseAgencyDateTime(
    `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:00`,
  );
  if (!floored) throw new Error('cannot floor instant to agency hour');
  return floored;
}


export function addDaysToAgencyDate(day: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) throw new Error(`not an agency date: ${day}`);
  const shifted = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days));
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}
