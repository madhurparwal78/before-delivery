// The one place venue-local calendar dates and due/expiry instants are computed.

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Venue-local calendar date of an instant, as YYYY-MM-DD. */
export function localDate(at: Date, timeZone: string): string {
  const dtf = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  return dtf.format(at);
}

/** The venue-local midnight that starts a date, as an instant. */
export function startOfLocalDay(date: string, timeZone: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  if (y === undefined || m === undefined || d === undefined) throw new Error(`bad date ${date}`);
  // Find the instant whose local date is this date and whose local time is 00:00,
  // handling DST shifts with two offset corrections.
  let offset = offsetMs(new Date(Date.UTC(y, m - 1, d, 12)), timeZone);
  let ts = Date.UTC(y, m - 1, d, 0) - offset;
  for (let i = 0; i < 2; i++) {
    offset = offsetMs(new Date(ts), timeZone);
    const candidate = Date.UTC(y, m - 1, d, 0) - offset;
    if (candidate === ts) break;
    ts = candidate;
  }
  return new Date(ts);
}

function offsetMs(at: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', { timeZone, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const parts = dtf.formatToParts(at);
  const get = (t: string): number => Number(parts.find((p) => p.type === t)?.value ?? '0');
  const asUTC = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') === 24 ? 0 : get('hour'), get('minute'), get('second'));
  return asUTC - (at.getTime() - (at.getTime() % 1000));
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  if (y === undefined || m === undefined || d === undefined) throw new Error(`bad date ${date}`);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** 23:59:59 venue-local time on the given venue-local calendar date. */
export function endOfLocalDay234959(date: string, timeZone: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  if (y === undefined || m === undefined || d === undefined) throw new Error(`bad date ${date}`);
  const targetLocal = Date.UTC(y, m - 1, d, 23, 59, 59);
  let ts = targetLocal - offsetMs(new Date(targetLocal), timeZone);
  for (let i = 0; i < 3; i++) {
    const off = offsetMs(new Date(ts), timeZone);
    const candidate = targetLocal - off;
    if (candidate === ts) break;
    ts = candidate;
  }
  return new Date(ts);
}

/** `<date>` format: weekday, day, month and year, e.g. Tue 16 Mar 2027. */
export function formatDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  if (y === undefined || m === undefined || d === undefined) throw new Error(`bad date ${date}`);
  const t = new Date(Date.UTC(y, m - 1, d));
  return `${WEEKDAYS[t.getUTCDay()]} ${d} ${MONTHS[m - 1]} ${y}`;
}

/** `<due>` format: date followed by `, 23:59:59 (<IANA zone>)`. */
export function formatDue(at: Date, timeZone: string): string {
  const date = localDate(at, timeZone);
  const clock = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(at);
  return `${formatDate(date)}, ${clock}, 23:59:59 (${timeZone})`;
}

/** Quote validity: 23:59:59 venue-local on the 14th calendar day after issue. */
export function quoteValidUntil(issuedAt: Date, timeZone: string): Date {
  return endOfLocalDay234959(addDays(localDate(issuedAt, timeZone), 14), timeZone);
}

/** Milestone due date: 23:59:59 venue-local on the 14th calendar day after the trigger. */
export function milestoneDueAt(triggerAt: Date, timeZone: string): Date {
  return endOfLocalDay234959(addDays(localDate(triggerAt, timeZone), 14), timeZone);
}

export function bookableWindow(todayLocal: string): { from: string; to: string } {
  return { from: addDays(todayLocal, 21), to: addDays(todayLocal, 365) };
}

