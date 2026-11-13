/** India time (Asia/Kolkata) dates. Promises and return windows are decided in these terms. */

const INDIA_OFFSET_MINUTES = 330;

export function indiaDate(at: Date = new Date()): string {
  const shifted = new Date(at.getTime() + INDIA_OFFSET_MINUTES * 60_000);
  return shifted.toISOString().slice(0, 10);
}

export function addDays(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split('-').map((part) => Number(part));
  const at = new Date(Date.UTC(year, month - 1, day));
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}


