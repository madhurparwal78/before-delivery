import {
  CivilDate,
  addDays,
  dayOfWeek,
  formatDate,
  lastDayOfMonth,
  longDateString,
  parseDate,
} from '../shared/dates';

const CENTRAL = 'America/Chicago';

const centralDateFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: CENTRAL,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * The Central date of an instant the server sent. The browser's own clock and
 * zone never take part: only the practice instant and the practice zone do.
 */
export function centralDate(instant: string): string {
  return centralDateFormat.format(new Date(instant)).replace(/\//g, '-');
}

export function centralMonth(instant: string): string {
  return centralDate(instant).slice(0, 7);
}

export function centralYear(instant: string): string {
  return centralDate(instant).slice(0, 4);
}

/** Monday to Sunday, around a Central date. */
export function weekRange(date: string): { from: string; to: string } {
  const civil = parseDate(date);
  const weekday = dayOfWeek(civil);
  const backToMonday = weekday === 0 ? 6 : weekday - 1;
  const monday = addDays(civil, -backToMonday);
  return { from: formatDate(monday), to: formatDate(addDays(monday, 6)) };
}

export function monthDays(month: string): CivilDate[] {
  const year = Number(month.slice(0, 4));
  const monthNumber = Number(month.slice(5, 7));
  const days: CivilDate[] = [];
  for (let day = 1; day <= lastDayOfMonth(year, monthNumber); day += 1) {
    days.push({ y: year, m: monthNumber, d: day });
  }
  return days;
}

/** Whole Monday-to-Sunday weeks covering a month, with blanks at each end. */
export function monthWeeks(month: string): (CivilDate | null)[][] {
  const days = monthDays(month);
  const weeks: (CivilDate | null)[][] = [];
  let current: (CivilDate | null)[] = [];
  const first = days[0];
  const leading = dayOfWeek(first) === 0 ? 6 : dayOfWeek(first) - 1;
  for (let index = 0; index < leading; index += 1) current.push(null);
  for (const day of days) {
    current.push(day);
    if (current.length === 7) {
      weeks.push(current);
      current = [];
    }
  }
  if (current.length > 0) {
    while (current.length < 7) current.push(null);
    weeks.push(current);
  }
  return weeks;
}

const centralPartsFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: CENTRAL,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

function centralOffsetMs(instantMs: number): number {
  const parts = centralPartsFormat.formatToParts(new Date(instantMs));
  const read = (type: string): number => {
    const part = parts.find((candidate) => candidate.type === type);
    return part ? Number(part.value) : 0;
  };
  const asIfUtc = Date.UTC(
    read('year'),
    read('month') - 1,
    read('day'),
    read('hour'),
    read('minute'),
    read('second'),
  );
  return asIfUtc - Math.floor(instantMs / 1000) * 1000;
}

/** The instant of a Central wall-clock hour on a Central date. */
export function centralInstant(date: string, hour: number): number {
  const civil = parseDate(date);
  const target = Date.UTC(civil.y, civil.m - 1, civil.d, hour, 0, 0, 0);
  let guess = target - centralOffsetMs(target);
  guess = target - centralOffsetMs(guess);
  return guess;
}

const centralClockFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: CENTRAL,
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

/** `Monday June 15, 9:00 am Central` for an instant the server sent. */
export function centralStamp(instant: string): string {
  const date = centralDate(instant);
  const time = centralClockFormat.format(new Date(instant)).replace(/\s?([AP])M/, (_, half: string) =>
    half === 'A' ? ' am' : ' pm',
  );
  return `${longDateString(date)}, ${time} Central`;
}

export function shiftMonth(month: string, delta: number): string {
  const year = Number(month.slice(0, 4));
  const monthNumber = Number(month.slice(5, 7));
  const total = year * 12 + (monthNumber - 1) + delta;
  const nextYear = Math.floor(total / 12);
  const nextMonth = (total % 12) + 1;
  return `${String(nextYear).padStart(4, '0')}-${String(nextMonth).padStart(2, '0')}`;
}
