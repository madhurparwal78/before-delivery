/** The one place that counts loft working days. */

const DAY_MS = 86400000;

export function parseDate(date: string): number {
  return Date.parse(`${date}T00:00:00Z`);
}

export function formatDate(stamp: number): string {
  return new Date(stamp).toISOString().slice(0, 10);
}

/** Monday to Friday, and not a seeded loft closure. */
function isWorkingDay(stamp: number, closures: ReadonlySet<string>): boolean {
  const weekday = new Date(stamp).getUTCDay();
  if (weekday === 0 || weekday === 6) return false;
  return !closures.has(formatDate(stamp));
}

/** The nth loft working day after a date. */
export function workingDaysAfter(date: string, days: number, closures: ReadonlySet<string>): string {
  let stamp = parseDate(date);
  let counted = 0;
  while (counted < days) {
    stamp += DAY_MS;
    if (isWorkingDay(stamp, closures)) counted += 1;
  }
  return formatDate(stamp);
}

export const REMEASURE_WORKING_DAYS = 5;

export function remeasureDue(measuredOn: string, closures: ReadonlySet<string>): string {
  return workingDaysAfter(measuredOn, REMEASURE_WORKING_DAYS, closures);
}
