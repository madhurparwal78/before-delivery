/**
 * Zurich date/time handling — the single decision place for every label a
 * person sees. Everything renders in Europe/Zurich whatever the server host
 * or browser device zone is.
 */
export const ZURICH = 'Europe/Zurich';

const dateFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: ZURICH,
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});
const dayMonthFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: ZURICH,
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});
const timeFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: ZURICH,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** `3 Nov 2026` */
export function zurichDate(ts: string | Date): string {
  return dayMonthFmt.format(typeof ts === 'string' ? new Date(ts) : ts);
}

/** `Tue 3 Nov 2026, 10:30` */
export function zurichSlotLabel(ts: string | Date): string {
  const date = typeof ts === 'string' ? new Date(ts) : ts;
  const withWeekday = dateFmt.format(date).replace(',', '');
  return `${withWeekday}, ${timeFmt.format(date)}`;
}

/** `Tue 3 Nov 2026, 10:42` (same form; kept separate for clarity of intent) */
export function zurichMomentLabel(ts: string | Date): string {
  return zurichSlotLabel(ts);
}

/** Zurich calendar date (YYYY-MM-DD) of an instant. */
export function zurichDateISO(ts: string | Date): string {
  const date = typeof ts === 'string' ? new Date(ts) : ts;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: ZURICH,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
  return parts;
}

/** Zurich wall-clock parts of an instant. */
export function zurichParts(ts: Date): { year: number; month: number; day: number; hour: number; minute: number; weekday: number } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: ZURICH,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
    weekday: 'short',
  });
  const parts = fmt.formatToParts(ts);
  const get = (type: string): number => Number(parts.find((part) => part.type === type)?.value ?? '0');
  const weekdayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const weekday = weekdayNames.indexOf(parts.find((part) => part.type === 'weekday')?.value ?? '');
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour') % 24,
    minute: get('minute'),
    weekday,
  };
}

/** Seconds since the epoch for a Zurich local slot string `YYYY-MM-DDTHH:MM`. */
export function zurichSlotToUtc(slot: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(slot);
  if (!match) return NaN;
  const [, y, mo, d, h, mi] = match;
  // Zurich wall time as a UTC-naive instant, then shifted by the live offset
  const naive = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi));
  const offset = zurichOffsetMs(new Date(naive));
  return naive - offset;
}

/** The Zurich offset from UTC in ms at the given instant (CET +1h or CEST +2h). */
export function zurichOffsetMs(at: Date): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: ZURICH,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = dtf.formatToParts(at);
  const get = (type: string): number => Number(parts.find((part) => part.type === type)?.value ?? '0');
  const asZurich = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
  return asZurich - at.getTime();
}
