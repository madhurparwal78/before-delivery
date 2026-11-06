import { fromZonedParts, toZonedParts, zoneOffsetMinutes } from './zone.js';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** The one place that renders a display string: Tuesday 2 March 2027, 09:00 museum time */
export function display(date: Date, timeZone: string): string {
  const p = toZonedParts(timeZone, date);
  return `${WEEKDAYS[p.weekday]} ${p.day} ${MONTHS[p.month - 1]} ${p.year}, ${pad(p.hour)}:${pad(p.minute)} museum time`;
}

/** A Date at a wall-clock time in the museum's zone. */
export function zonedTime(
  year: number, month: number, day: number, hour: number, minute: number, timeZone: string
): Date {
  return fromZonedParts(timeZone, year, month, day, hour, minute);
}

export function yearMonthDay(date: Date, timeZone: string): string {
  const p = toZonedParts(timeZone, date);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

export function isoWithZone(date: Date, timeZone: string): string {
  const offset = zoneOffsetMinutes(timeZone, date);
  const sign = offset < 0 ? '-' : '+';
  const abs = Math.abs(offset);
  return `${date.toISOString().slice(0, 19)}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

export function parseDateParts(text: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
    return null;
  }
  return { year, month, day };
}

/** Open days from runStart to runEnd inclusive, skipping the museum's closed weekdays. */
export function openHours(
  runStart: string, runEnd: string, closedWeekdays: number[], hoursPerDay: number
): number {
  const start = new Date(`${runStart}T00:00:00Z`).getTime();
  const end = new Date(`${runEnd}T00:00:00Z`).getTime();
  let days = 0;
  for (let t = start; t <= end; t += 86_400_000) {
    if (!closedWeekdays.includes(new Date(t).getUTCDay())) days += 1;
  }
  return days * hoursPerDay;
}
