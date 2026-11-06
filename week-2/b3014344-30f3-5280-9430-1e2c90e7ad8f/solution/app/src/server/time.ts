// Studio time: America/Argentina/Buenos_Aires, a fixed UTC-03:00 offset with no daylight saving.

export const ZONE = "America/Argentina/Buenos_Aires";
const OFFSET_MS = 3 * 3600 * 1000;

/** ISO 8601 instant with the studio offset, e.g. 2026-11-01T14:05:09-03:00. */
export function studioInstant(at: Date): string {
  const local = new Date(at.getTime() - OFFSET_MS);
  return `${local.toISOString().slice(0, 19)}-03:00`;
}

/** The Buenos Aires calendar date of an instant, YYYY-MM-DD. */
export function studioDate(at: Date): string {
  return new Date(at.getTime() - OFFSET_MS).toISOString().slice(0, 10);
}

/** Adds whole calendar months to a YYYY-MM-DD date, clamping to the month's last day. */
export function addMonths(isoDate: string, months: number): string {
  const [year, month, day] = isoDate.split("-").map(Number) as [number, number, number];
  const first = new Date(Date.UTC(year, month - 1 + months, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(day, last));
  return first.toISOString().slice(0, 10);
}

/** Whole days from one YYYY-MM-DD date to another. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** Midnight in Buenos Aires at the start of a YYYY-MM-DD date. */
export function studioMidnight(isoDate: string): Date {
  return new Date(Date.parse(`${isoDate}T00:00:00-03:00`));
}
