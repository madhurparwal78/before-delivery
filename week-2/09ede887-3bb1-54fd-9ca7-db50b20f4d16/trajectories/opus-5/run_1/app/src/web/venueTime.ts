const VENUE_ZONE = 'America/Halifax';

const clockFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: VENUE_ZONE,
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

const dayClockFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: VENUE_ZONE,
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

const dayFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: VENUE_ZONE,
  weekday: 'short',
  month: 'short',
  day: 'numeric',
});

const zoneFormat = new Intl.DateTimeFormat('en-US', { timeZone: VENUE_ZONE, timeZoneName: 'short' });
const offsetFormat = new Intl.DateTimeFormat('en-US', { timeZone: VENUE_ZONE, timeZoneName: 'longOffset' });

/** A venue wall-clock `HH:MM` as `11:30 AM`, without needing the browser zone. */
export function clockLabel(wallClock: string): string {
  const [hourText, minuteText] = wallClock.split(':');
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const suffix = hour < 12 ? 'AM' : 'PM';
  const shown = hour % 12 === 0 ? 12 : hour % 12;
  return `${shown}:${String(minute).padStart(2, '0')} ${suffix}`;
}

export function rangeLabel(start: string, end: string): string {
  return start === end ? clockLabel(start) : `${clockLabel(start)} - ${clockLabel(end)}`;
}

/** An instant in venue time as `11:42 AM`, seconds dropped. */
export function instantClockLabel(instant: string): string {
  return clockFormat.format(new Date(instant));
}

/** An instant in venue time as `Sat, Oct 31, 1:00 PM`. */
export function instantDayClockLabel(instant: string): string {
  return dayClockFormat.format(new Date(instant));
}

/** A session date and wall clock as `Sun, Nov 1, 11:00 AM`. */
export function dateClockLabel(date: string, wallClock: string): string {
  return `${dayLabel(date)}, ${clockLabel(wallClock)}`;
}

export function dayLabel(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  // Noon keeps the calendar day the same in the venue zone.
  return dayFormat.format(new Date(Date.UTC(year ?? 2026, (month ?? 1) - 1, day ?? 1, 12)));
}

/** The abbreviation and offset in force during that day's sessions. */
export function venueTimeLine(instantDuringDay: string): string {
  const moment = new Date(instantDuringDay);
  const abbreviation =
    zoneFormat.formatToParts(moment).find((part) => part.type === 'timeZoneName')?.value ?? 'AST';
  const offset = offsetFormat.formatToParts(moment).find((part) => part.type === 'timeZoneName')?.value ?? 'GMT-04:00';
  const hours = Number(offset.replace('GMT', '').split(':')[0]);
  const sign = hours < 0 ? '\u2212' : '+';
  return `All times are Port Ashby time (${abbreviation}, UTC${sign}${Math.abs(hours)}).`;
}

/** Noon on each conference day, used for the day tabs and the venue-time line. */
export const DAY_INSTANTS: Readonly<Record<1 | 2, string>> = {
  1: '2026-10-31T15:00:00Z',
  2: '2026-11-01T16:00:00Z',
};

export const DAY_DATES: Readonly<Record<1 | 2, string>> = { 1: '2026-10-31', 2: '2026-11-01' };
