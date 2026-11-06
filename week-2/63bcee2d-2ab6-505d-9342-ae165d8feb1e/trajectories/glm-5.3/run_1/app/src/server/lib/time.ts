// Time formatting and Hong Kong working-day logic.
// Time zones: HK and MO use Asia/Hong_Kong (HKT, UTC+8), SG uses Asia/Singapore (SGT, UTC+8).
// Both are fixed +8 with no DST, so we can use fixed offsets.

export const HKT_OFFSET_MS = 8 * 60 * 60 * 1000;

export function hkNow(): Date {
  return new Date();
}

/** Format an instant like `3 Nov 2026, 14:05:32 HKT` (or SGT). */
export function instantText(date: Date, timeZone: 'HK' | 'SG' | 'MO'): string {
  const shifted = new Date(date.getTime() + HKT_OFFSET_MS);
  const day = shifted.getUTCDate();
  const month = MONTHS[shifted.getUTCMonth()];
  const year = shifted.getUTCFullYear();
  const hours = shifted.getUTCHours().toString().padStart(2, '0');
  const minutes = shifted.getUTCMinutes().toString().padStart(2, '0');
  const seconds = shifted.getUTCSeconds().toString().padStart(2, '0');
  const label = timeZone === 'SG' ? 'SGT' : 'HKT';
  return `${day} ${month} ${year}, ${hours}:${minutes}:${seconds} ${label}`;
}

/** Format a date like `3 Nov 2026`. */
export function dateText(dateIso: string): string {
  const [year, month, day] = dateIso.split('-').map((part) => parseInt(part, 10));
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Today's date in Hong Kong as YYYY-MM-DD. */
export function hkToday(): string {
  const shifted = new Date(Date.now() + HKT_OFFSET_MS);
  return shifted.toISOString().slice(0, 10);
}

/** The date part (HK) of an instant as YYYY-MM-DD. */
export function hkDateOf(instant: Date): string {
  return new Date(instant.getTime() + HKT_OFFSET_MS).toISOString().slice(0, 10);
}

/** The HKT clock time of an instant, in seconds since midnight. */
export function hkSecondsOfDay(instant: Date): number {
  const shifted = new Date(instant.getTime() + HKT_OFFSET_MS);
  return shifted.getUTCHours() * 3600 + shifted.getUTCMinutes() * 60 + shifted.getUTCSeconds();
}

export function toIso(date: Date): string {
  return date.toISOString().replace(/(\.\d{3})?Z$/, 'Z').replace('Z', 'Z');
}

const HK_HOLIDAYS = new Set<string>([
  '2026-01-01', '2026-02-17', '2026-02-18', '2026-02-19', '2026-04-03', '2026-04-04', '2026-04-06', '2026-04-07',
  '2026-05-01', '2026-05-25', '2026-06-19', '2026-07-01', '2026-09-26', '2026-10-01', '2026-10-19', '2026-12-25', '2026-12-26',
  '2027-01-01', '2027-02-06', '2027-02-08', '2027-02-09', '2027-03-26', '2027-03-27', '2027-03-29', '2027-04-05',
  '2027-05-01', '2027-05-13', '2027-06-09', '2027-07-01', '2027-09-16', '2027-10-01', '2027-10-08', '2027-12-25', '2027-12-27',
]);

export function isHkWorkingDay(dateIso: string): boolean {
  const date = new Date(`${dateIso}T12:00:00Z`);
  const weekday = date.getUTCDay();
  if (weekday === 0 || weekday === 6) return false;
  const year = date.getUTCFullYear();
  if (year <= 2027) return !HK_HOLIDAYS.has(dateIso);
  return true;
}

export function nextHkWorkingDay(dateIso: string): string {
  let candidate = addDays(dateIso, 1);
  while (!isHkWorkingDay(candidate)) {
    candidate = addDays(candidate, 1);
  }
  return candidate;
}

export function addHkWorkingDays(startIso: string, count: number): string {
  let candidate = startIso;
  let remaining = count;
  while (remaining > 0) {
    candidate = nextHkWorkingDay(candidate);
    remaining -= 1;
  }
  return candidate;
}

export function addDays(dateIso: string, days: number): string {
  const date = new Date(`${dateIso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * Review due date: the clock starts on the received HK date when that date is
 * a working day and the received instant is at or before 17:00:00 HKT exactly;
 * otherwise it starts on the next working day. Due five working days after the
 * start day, start day not counting.
 */
export function reviewDueOn(receivedAt: Date): string {
  const receivedDate = hkDateOf(receivedAt);
  const seconds = hkSecondsOfDay(receivedAt);
  let start = receivedDate;
  if (!isHkWorkingDay(receivedDate) || seconds > 17 * 3600) {
    start = nextHkWorkingDay(receivedDate);
  }
  return addHkWorkingDays(start, 5);
}

/** Defects end date: PC date plus whole months, clamped to the last day of a shorter month. */
export function defectsEndOn(practicalCompletionOn: string, months: number): string {
  const [year, month, day] = practicalCompletionOn.split('-').map((p) => parseInt(p, 10));
  let targetYear = year;
  let targetMonth = month + months;
  while (targetMonth > 12) {
    targetMonth -= 12;
    targetYear += 1;
  }
  const lastDay = new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate();
  const targetDay = Math.min(day, lastDay);
  return `${targetYear}-${targetMonth.toString().padStart(2, '0')}-${targetDay.toString().padStart(2, '0')}`;
}

/** Parse a wall-clock local date-time (project zone, fixed +8) to an instant. */
export function localToInstant(local: string): Date {
  const withSeconds = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local) ? `${local}:00` : local;
  return new Date(`${withSeconds}+08:00`);
}

export function formatLocalDateTime(instant: Date): string {
  const shifted = new Date(instant.getTime() + HKT_OFFSET_MS);
  return shifted.toISOString().slice(0, 19);
}

export function formatUtcCompact(instant: Date): string {
  return instant.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}
