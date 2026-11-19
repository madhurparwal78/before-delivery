import { CLINIC_TZ } from './settings.js';

const dtf = (opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat =>
  new Intl.DateTimeFormat('en-GB', { timeZone: CLINIC_TZ, ...opts });

const fmtDate = dtf({ year: 'numeric', month: '2-digit', day: '2-digit' });
const fmtTime = dtf({ hour: '2-digit', minute: '2-digit', hour12: false });
const fmtParts = dtf({ year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', hour12: false });

export function clinicDateOf(date: Date): string {
  // YYYY-MM-DD in clinic time
  return fmtDate.format(date).split('/').reverse().join('-');
}

export function clinicTimeOf(date: Date): string {
  return fmtTime.format(date).replace('24:', '00:');
}

const parts = (date: Date) => {
  const p = fmtParts.formatToParts(date);
  const o: Record<string, string> = {};
  for (const x of p) o[x.type] = x.value;
  return o;
};

export function clinicHourMinute(date: Date): { hour: number; minute: number } {
  const p = parts(date);
  return { hour: Number(p.hour), minute: Number(p.minute) };
}

export function clinicDateParts(date: Date): { y: number; m: number; d: number } {
  const p = parts(date);
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day) };
}

// Offset of the clinic zone from UTC in minutes at the given instant.
export function tzOffsetMinutes(date: Date): number {
  const p = parts(date);
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  const naive = new Date(asUtc);
  return (naive.getTime() - date.getTime()) / 60000;
}

// Convert a clinic-time wall clock (Y,M,D,h,m) to a UTC instant, resolving DST.
export function clinicToUtc(y: number, m: number, d: number, h: number, min: number, pickFirst: boolean): Date | null {
  // candidate offsets: offsets at plausible instants for that date
  const probes = [
    Date.UTC(y, m - 1, d, 12, 0),
    Date.UTC(y, m - 1, d, 0, 30),
    Date.UTC(y, m - 1, d, 23, 30),
  ];
  const offsets = new Set(probes.map((ms) => tzOffsetMinutes(new Date(ms))));
  // Typical zone offsets; try each to find instants whose wall time matches.
  const results: Date[] = [];
  for (const off of offsets) {
    const t = Date.UTC(y, m - 1, d, h, min) - off * 60000;
    const dd = new Date(t);
    const p = parts(dd);
    if (Number(p.year) === y && Number(p.month) === m && Number(p.day) === d && Number(p.hour) === h && Number(p.minute) === min) {
      results.push(dd);
    }
  }
  results.sort((a, b) => a.getTime() - b.getTime());
  if (results.length === 0) return null; // skipped time
  return pickFirst ? results[0] : results[results.length - 1];
}

export function clinicDateToUtcMidnight(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  // midnight clinic time (first occurrence) - offset near that date
  return clinicToUtc(y, m, d, 0, 0, true) ?? new Date(Date.UTC(y, m - 1, d));
}

export function addClinicDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d) + days * 86400000);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}

export function clinicDayShort(date: Date): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: CLINIC_TZ, weekday: 'short' }).format(date);
}

export function clinicDayMonth(date: Date): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: CLINIC_TZ, day: '2-digit', month: 'short' }).format(date);
}
