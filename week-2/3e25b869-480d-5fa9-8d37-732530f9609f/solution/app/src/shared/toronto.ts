// Toronto time: the business time zone, its calendar, conversions and the published formats.
import type { Locale } from './catalog.js';

export const TIME_ZONE = 'America/Toronto';

const partsFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export function wallClock(instant: Date): WallClock {
  const out: Record<string, number> = {};
  for (const part of partsFormat.formatToParts(instant)) {
    if (part.type !== 'literal') out[part.type] = Number(part.value);
  }
  return {
    year: out.year ?? 0,
    month: out.month ?? 0,
    day: out.day ?? 0,
    hour: out.hour ?? 0,
    minute: out.minute ?? 0,
    second: out.second ?? 0,
  };
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0');
const isoDate = (y: number, m: number, d: number) => `${pad(y, 4)}-${pad(m)}-${pad(d)}`;

/** The Toronto calendar date of an instant, `YYYY-MM-DD`. */
export function torontoDate(instant: Date): string {
  const w = wallClock(instant);
  return isoDate(w.year, w.month, w.day);
}

/** The Toronto month of an instant, `YYYY-MM`. */
export function torontoMonth(instant: Date): string {
  return torontoDate(instant).slice(0, 7);
}

/**
 * A Toronto wall-clock time to its UTC instant. A time inside the spring-forward gap is `null`;
 * a time that occurs twice in the fall-back hour is its first (daylight) occurrence.
 */
export function torontoInstant(date: string, hour = 0, minute = 0): Date | null {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const naive = Date.UTC(y, m - 1, d, hour, minute);
  const matches = [4, 5]
    .map((offsetHours) => new Date(naive + offsetHours * 3600_000))
    .filter((candidate) => {
      const w = wallClock(candidate);
      return w.year === y && w.month === m && w.day === d && w.hour === hour && w.minute === minute;
    });
  return matches[0] ?? null;
}

/** 00:00 Toronto on a date (midnight always exists in Toronto). */
export function torontoMidnight(date: string): Date {
  return torontoInstant(date) as Date;
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const moved = new Date(Date.UTC(y, m - 1, d + days));
  return isoDate(moved.getUTCFullYear(), moved.getUTCMonth() + 1, moved.getUTCDate());
}

/** Day of week of a calendar date, 0 = Sunday. */
export function weekday(date: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** `months` months after `anchor`, on `day` or the month's last day when that month is shorter. */
export function addMonths(anchor: string, months: number, day: number): string {
  const [y, m] = anchor.split('-').map(Number) as [number, number];
  const index = y * 12 + (m - 1) + months;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return isoDate(year, month, Math.min(day, lastDay));
}

/** The UTC edges of a Toronto month: [00:00 on its 1st, 00:00 on the next month's 1st). */
export function monthEdges(month: string): [Date, Date] {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const next = m === 12 ? isoDate(y + 1, 1, 1) : isoDate(y, m + 1, 1);
  return [torontoMidnight(isoDate(y, m, 1)), torontoMidnight(next)];
}

const MONTHS = {
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  fr: ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'],
};
const WEEKDAYS = {
  en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  fr: ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'],
};

const frenchDay = (day: number) => (day === 1 ? '1er' : String(day));

/** "November 30, 2026" / "30 novembre 2026". */
export function longDate(date: string, locale: Locale): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return locale === 'fr-CA' ? `${frenchDay(d)} ${MONTHS.fr[m - 1]} ${y}` : `${MONTHS.en[m - 1]} ${d}, ${y}`;
}

/** "Sunday, November 1, 2026 at 10:00 (Toronto time)" / "dimanche 1er novembre 2026 à 10 h 00 (heure de Toronto)". */
export function dropTime(instant: Date, locale: Locale): string {
  const w = wallClock(instant);
  const day = weekday(isoDate(w.year, w.month, w.day));
  return locale === 'fr-CA'
    ? `${WEEKDAYS.fr[day]} ${frenchDay(w.day)} ${MONTHS.fr[w.month - 1]} ${w.year} à ${w.hour} h ${pad(w.minute)} (heure de Toronto)`
    : `${WEEKDAYS.en[day]}, ${MONTHS.en[w.month - 1]} ${w.day}, ${w.year} at ${w.hour}:${pad(w.minute)} (Toronto time)`;
}

/** "H:MM" / "H h MM" in Toronto. */
export function clockTime(instant: Date, locale: Locale): string {
  const w = wallClock(instant);
  return locale === 'fr-CA' ? `${w.hour} h ${pad(w.minute)}` : `${w.hour}:${pad(w.minute)}`;
}

/** "YYYY-MM-DDTHH:MM" in Toronto. */
export function localMinute(instant: Date): string {
  const w = wallClock(instant);
  return `${isoDate(w.year, w.month, w.day)}T${pad(w.hour)}:${pad(w.minute)}`;
}
