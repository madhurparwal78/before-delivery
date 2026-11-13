// Server time: Tidecraft keeps its register on Pacific time (America/Los_Angeles).
// Every vested count, expiry, close, cancellation and lapse is decided here.

const PT_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const dateFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
});
const timeFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'America/Los_Angeles', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
});

/** Calendar date in PT as {y, m (1-12), d}. */
export function ptDate(at: Date): { y: number; m: number; d: number } {
  const parts = dateFmt.formatToParts(at);
  const y = Number(parts.find((p) => p.type === 'year')?.value);
  const m = Number(parts.find((p) => p.type === 'month')?.value);
  const d = Number(parts.find((p) => p.type === 'day')?.value);
  return { y, m, d };
}

/** The server's date in PT, as YYYY-MM-DD. */
export function serverDate(at: Date): string {
  const { y, m, d } = ptDate(at);
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Milliseconds into the current PT day. */
export function ptTimeOfDayMs(at: Date): number {
  const hhmmss = timeFmt.format(at);
  const [h, m, s] = hhmmss.split(':').map(Number);
  return h * 3_600_000 + m * 60_000 + s * 1000 + (at.getMilliseconds() ?? 0);
}

/** Start of the given PT date as a UTC instant (midnight Pacific). */
export function ptStartOfDay(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return ptDateToInstant(y, m, d, 0, 0, 0);
}

function ptDateToInstant(y: number, m: number, d: number, hh: number, mm: number, ss: number, ms = 0): Date {
  // Find the UTC offset by probing (handles PST/PDT).
  const probe = Date.UTC(y, m - 1, d, hh, mm, ss, ms);
  const offset = ptOffsetMs(new Date(probe));
  return new Date(probe - offset);
}

function ptOffsetMs(at: Date): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const parts = dtf.formatToParts(at);
  const num = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUTC = Date.UTC(num('year'), num('month') - 1, num('day'),
    num('hour') % 24, num('minute'), num('second'));
  return asUTC - Math.floor(at.getTime() / 1000) * 1000;
}

/** Instant for a PT date at 00:00:00 (midnight). */
export function midnightPT(dateStr: string): Date {
  return ptStartOfDay(dateStr);
}

export function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

export function daysInMonth(y: number, m: number): number {
  return [31, isLeapYear(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]! as number;
}

function pad(n: number, w = 2): string {
  return String(n).padStart(w, '0');
}

export function toISODate(y: number, m: number, d: number): string {
  return `${pad(y, 4)}-${pad(m)}-${pad(d)}`;
}

/** The date m calendar months after start; when that day is absent, the last day of the month. */
export function addMonthsClamped(start: string, m: number): string {
  const [sy, sm, sd] = start.split('-').map(Number);
  const total = (sy! * 12 + (sm! - 1)) + m;
  const y = Math.floor(total / 12);
  const mo = total % 12 + 1;
  const d = Math.min(sd!, daysInMonth(y, mo));
  return toISODate(y, mo, d);
}

/** Days between two PT dates (a - b), using UTC midnights of those calendar dates. */
export function dateDiffDays(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(ay!, am! - 1, ad!) - Date.UTC(by!, bm! - 1, bd!)) / 86_400_000);
}

/** Display: 28 Feb 2027. */
export function formatDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return `${d} ${PT_MONTHS[m! - 1]} ${y}`;
}

/** Display: 3 Nov 2026, 14:05:09 PT. */
export function formatInstant(at: Date): string {
  const { y, m, d } = ptDate(at);
  const hhmmss = timeFmt.format(at);
  return `${d} ${PT_MONTHS[m - 1]} ${y}, ${hhmmss} PT`;
}

export function toISOString(at: Date): string {
  return at.toISOString().replace(/(\.\d{3})Z$/, (ms) => ms);
}

export function parseISOInstant(s: string): Date {
  return new Date(s);
}
