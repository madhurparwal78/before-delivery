// Agency time is America/New_York. Nominal dates and wall-clock instants are
// distinct: nominal dates are day keys with no time or offset, instants are
// UTC moments rendered with an offset at the API edge.
export const MS_PER_MINUTE = 60_000;
export const AGENCY_TZ = 'America/New_York';

export function dateKeyInAgencyTz(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: AGENCY_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
}

// Wall-clock text in agency time (e.g. "2026-10-27T14:00") converted to an instant.
export function agencyWallClockToInstant(text: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(text);
  if (!m || m.length < 6) return null;
  const y = m[1]!; const mo = m[2]!; const d = m[3]!; const h = m[4]!; const mi = m[5]!;
  const approx = Date.parse(`${y}-${mo}-${d}T${h}:${mi}:00Z`);
  if (Number.isNaN(approx)) return null;
  // America/New_York is UTC-5 or UTC-4; try both mappings and verify by round-trip.
  for (const offsetMin of [300, 240]) {
    const inst = new Date(approx + offsetMin * MS_PER_MINUTE);
    if (dateKeyInAgencyTz(inst) === `${y}-${mo}-${d}` && timeOfDayInAgencyTz(inst) === `${h}:${mi}`) {
      return inst;
    }
  }
  return null;
}

export function timeOfDayInAgencyTz(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: AGENCY_TZ, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(d);
  return parts === '24:00' ? '00:00' : parts;
}

export function isoWithOffset(d: Date): string {
  const offMin = -d.getTimezoneOffset();
  const sign = offMin >= 0 ? '+' : '-';
  const abs = Math.abs(offMin);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  const t = new Date(d.getTime() - offMin * MS_PER_MINUTE);
  return `${t.toISOString().slice(0, 19)}${sign}${hh}:${mm}`;
}

export function parseInstant(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/.test(value)) {
    return null;
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

const NOMINAL_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Nominal agency date key -> a UTC midnight instant used for expiry comparisons.
export function parseNominalDate(s: string): number | null {
  if (!NOMINAL_DATE_RE.test(s)) return null;
  const parts = s.split('-').map(Number);
  const y = parts[0] ?? 0; const m = parts[1] ?? 0; const d = parts[2] ?? 0;
  if (m < 1 || m > 12 || d < 1) return null;
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  if (d > days || y < 100) return null;
  return Date.UTC(y, m - 1, d);
}

export function nominalDateToKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

export function todayKeyAgency(): string {
  return dateKeyInAgencyTz(new Date());
}

export function addDays(ms: number, days: number): number {
  return ms + days * 86_400_000;
}
