/** Clinic time (Europe/London). The only place a zone is applied; the browser's own zone is never consulted. */
export const CLINIC_ZONE = 'Europe/London';

const parts = new Intl.DateTimeFormat('en-GB', {
  timeZone: CLINIC_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
  weekday: 'short',
});

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

interface ClinicParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function clinicParts(instant: Date): ClinicParts {
  const out: Record<string, string> = {};
  for (const p of parts.formatToParts(instant)) out[p.type] = p.value;
  return {
    year: Number(out.year),
    month: Number(out.month),
    day: Number(out.day),
    hour: Number(out.hour),
    minute: Number(out.minute),
    second: Number(out.second),
  };
}

const pad = (n: number) => String(n).padStart(2, '0');

export function clinicDate(instant: Date): string {
  const p = clinicParts(instant);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

export function clinicHm(instant: Date): string {
  const p = clinicParts(instant);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

/** Minutes since clinic midnight. */
export function clinicMinuteOfDay(instant: Date): number {
  const p = clinicParts(instant);
  return p.hour * 60 + p.minute;
}

function wallMs(p: ClinicParts): number {
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
}

/**
 * The instant of a clinic wall time. A time that does not exist (clocks going forward) returns null; a time that
 * occurs twice (clocks going back) means its first occurrence.
 */
export function clinicInstant(date: string, hour: number, minute: number): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return null;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  const wall = Date.UTC(year, month - 1, day, hour, minute, 0);
  if (new Date(Date.UTC(year, month - 1, day)).getUTCDate() !== day) return null;
  for (const offsetHours of [1, 0]) {
    const candidate = new Date(wall - offsetHours * 3_600_000);
    const back = clinicParts(candidate);
    if (wallMs(back) === wall) return candidate;
  }
  return null;
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** `Tue 17 Nov` */
export function dayLabel(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return `${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${pad(d)} ${MONTHS[m - 1]}`;
}

/** `Tue 17 Nov 2026` */
export function longDayLabel(date: string): string {
  return `${dayLabel(date)} ${date.slice(0, 4)}`;
}

/** `17 Nov 2026` */
export function dueLabel(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return `${pad(d)} ${MONTHS[m - 1]} ${y}`;
}


export function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
}
