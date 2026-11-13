/**
 * The app clock and every IST conversion live here and nowhere else.
 * The offset is held in Postgres so all copies share one clock.
 */
const IST_OFFSET_MIN = 330;
const MS_PER_MIN = 60_000;
const MS_PER_DAY = 86_400_000;

let offsetMs = 0;
let frozenMs: number | null = null;

export function setClockOffset(ms: number, frozen: number | null = null): void {
  offsetMs = ms;
  frozenMs = frozen;
}

export function appNow(): Date {
  return new Date(appNowMs());
}

export function appNowMs(): number {
  return frozenMs ?? Date.now() + offsetMs;
}

let refreshedAt = 0;

/** The shared clock is re-read often enough that every copy answers on the same instant. */
export function clockNeedsRefresh(): boolean {
  const now = Date.now();
  if (now - refreshedAt < 250) return false;
  refreshedAt = now;
  return true;
}

export interface IstFields {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number;
}

function shifted(at: Date): Date {
  return new Date(at.getTime() + IST_OFFSET_MIN * MS_PER_MIN);
}

export function istFields(at: Date): IstFields {
  const s = shifted(at);
  return {
    year: s.getUTCFullYear(),
    month: s.getUTCMonth() + 1,
    day: s.getUTCDate(),
    hour: s.getUTCHours(),
    minute: s.getUTCMinutes(),
    second: s.getUTCSeconds(),
    weekday: s.getUTCDay(),
  };
}

export function istDate(at: Date): string {
  const f = istFields(at);
  return `${f.year}-${pad(f.month)}-${pad(f.day)}`;
}

export function istMinutesOfDay(at: Date): number {
  const f = istFields(at);
  return f.hour * 60 + f.minute;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map((p) => Number(p));
  if (!y || !m || !d) return false;
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const probe = new Date(Date.UTC(y, m - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
}

/** The instant at `minutes` past midnight IST on an IST calendar date. */
export function istInstant(date: string, minutes = 0): Date {
  const [y, m, d] = date.split('-').map((p) => Number(p));
  const base = Date.UTC(y as number, (m as number) - 1, d as number);
  return new Date(base - IST_OFFSET_MIN * MS_PER_MIN + minutes * MS_PER_MIN);
}

export function addIstDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map((p) => Number(p));
  const next = new Date(Date.UTC(y as number, (m as number) - 1, (d as number) + days));
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
}

export function istDaysBetween(from: string, to: string): number {
  return Math.round((istInstant(to).getTime() - istInstant(from).getTime()) / MS_PER_DAY);
}

export function istWeekday(date: string): number {
  const [y, m, d] = date.split('-').map((p) => Number(p));
  return new Date(Date.UTC(y as number, (m as number) - 1, d as number)).getUTCDay();
}

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const WEEKDAY_LONG = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;
const MONTH_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/** `30 Oct` */
export function labelDMon(date: string): string {
  const [, m, d] = date.split('-').map((p) => Number(p));
  return `${d} ${MONTH_SHORT[(m as number) - 1]}`;
}

/** `Fri 6 Nov` */
export function labelDddDMon(date: string): string {
  return `${WEEKDAY_SHORT[istWeekday(date)]} ${labelDMon(date)}`;
}

/** `30 Oct 2026` */
export function labelDMonYear(date: string): string {
  const [y] = date.split('-');
  return `${labelDMon(date)} ${y}`;
}

export function labelWeekday(date: string): string {
  return WEEKDAY_LONG[istWeekday(date)] as string;
}

function hour12(hour: number): number {
  const h = hour % 12;
  return h === 0 ? 12 : h;
}

/** `6:00 pm` */
export function labelHmm(at: Date): string {
  const f = istFields(at);
  return `${hour12(f.hour)}:${pad(f.minute)} ${f.hour < 12 ? 'am' : 'pm'}`;
}

export function labelHour(at: Date): string {
  const f = istFields(at);
  return `${hour12(f.hour)} ${f.hour < 12 ? 'am' : 'pm'}`;
}

/** `6:00 pm IST` */
export function labelTimeIst(at: Date): string {
  return `${labelHmm(at)} IST`;
}

/** `11:30` — the cluster display, the one exception to the IST suffix rule. */
export function clusterTime(at: Date): string {
  const f = istFields(at);
  return `${hour12(f.hour)}:${pad(f.minute)}`;
}

/** `30 Oct, 6:00 pm IST` */
export function labelDMonTimeIst(at: Date): string {
  return `${labelDMon(istDate(at))}, ${labelTimeIst(at)}`;
}

/** `9:00 am IST`, or `30 Oct, 9:00 am IST` when the instant is on an earlier IST date. */
export function labelAsOf(at: Date, now: Date): string {
  return istDate(at) === istDate(now) ? labelTimeIst(at) : labelDMonTimeIst(at);
}

/** `Today, Wed 28 Oct` / `Tomorrow, Thu 29 Oct` / `Fri 30 Oct` */
export function labelDay(date: string, now: Date): string {
  const today = istDate(now);
  const delta = istDaysBetween(today, date);
  if (delta === 0) return `Today, ${labelDddDMon(date)}`;
  if (delta === 1) return `Tomorrow, ${labelDddDMon(date)}`;
  return labelDddDMon(date);
}

export function iso(at: Date): string {
  const f = istFields(at);
  return `${f.year}-${pad(f.month)}-${pad(f.day)}T${pad(f.hour)}:${pad(f.minute)}:${pad(
    f.second,
  )}+05:30`;
}

/** `YYYY-MM-DDTHH:mm` in IST, as used in slot ledger keys. */
export function istSlotKey(at: Date): string {
  const f = istFields(at);
  return `${f.year}-${pad(f.month)}-${pad(f.day)}T${pad(f.hour)}:${pad(f.minute)}`;
}

export function parseIsoInstant(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(value)) {
    return null;
  }
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? null : at;
}

