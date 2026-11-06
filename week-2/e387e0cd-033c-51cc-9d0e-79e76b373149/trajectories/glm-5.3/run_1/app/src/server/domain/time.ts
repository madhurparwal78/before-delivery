// Business time: instants, business dates, business months and local-midnight
// boundaries per workspace time zone. Local midnight always exists in the
// seeded zones (transitions happen later in the local morning).
export function offsetMinutes(instant: Date, timeZone: string): number {
  const fmt = new Intl.DateTimeFormat('en-GB', { timeZone, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const parts: Record<string, number> = {};
  for (const p of fmt.formatToParts(instant)) {
    if (p.type !== 'literal') parts[p.type] = Number(p.value);
  }
  const asUTC = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour === 24 ? 0 : parts.hour, parts.minute, parts.second);
  return Math.round((asUTC - instant.getTime()) / 60000);
}

export function localMidnightUtc(businessDate: string, timeZone: string): Date {
  const [y, m, d] = businessDate.split('-').map(Number);
  let guess = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
  for (let i = 0; i < 3; i++) {
    const offset = offsetMinutes(guess, timeZone);
    const next = new Date(Date.UTC(y, m - 1, d, 0, 0, 0) - offset * 60000);
    if (next.getTime() === guess.getTime()) break;
    guess = next;
  }
  return new Date(Math.floor(guess.getTime() / 1000) * 1000);
}

export function businessDateInZone(instant: Date, timeZone: string): string {
  const fmt = new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(instant)) {
    if (p.type !== 'literal') parts[p.type] = p.value;
  }
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function businessMonthInZone(instant: Date, timeZone: string): string {
  return businessDateInZone(instant, timeZone).slice(0, 7);
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const total = y * 12 + (m - 1) + delta;
  const year = Math.floor(total / 12);
  const mon = (total % 12 + 12) % 12 + 1;
  return `${year}-${mon.toString().padStart(2, '0')}`;
}

export function zonedTime(businessDate: string, wallClock: string, timeZone: string): Date {
  const [h, mi] = wallClock.split(':').map(Number);
  const [y, m, d] = businessDate.split('-').map(Number);
  let guess = new Date(Date.UTC(y, m - 1, d, h === 24 ? 0 : h, mi, 0));
  for (let i = 0; i < 3; i++) {
    const offset = offsetMinutes(guess, timeZone);
    const next = new Date(Date.UTC(y, m - 1, d, h === 24 ? 0 : h, mi, 0) - offset * 60000);
    if (next.getTime() === guess.getTime()) break;
    guess = next;
  }
  return new Date(Math.floor(guess.getTime() / 1000) * 1000);
}

export function addDays(businessDate: string, days: number): string {
  const [y, m, d] = businessDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return `${dt.getUTCFullYear()}-${(dt.getUTCMonth() + 1).toString().padStart(2, '0')}-${dt.getUTCDate().toString().padStart(2, '0')}`;
}

export function hoursBetween(start: Date, end: Date): number {
  return Math.round((end.getTime() - start.getTime()) / 3600000);
}

export function formatInstant(instant: Date): string {
  return `${instant.toISOString().slice(0, 19)}Z`;
}

export function dateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  const names = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return `${names[m - 1]} ${y}`;
}

export function firstOfNextMonthUtc(month: string, timeZone: string): Date {
  return localMidnightUtc(`${shiftMonth(month, 1)}-01`, timeZone);
}
