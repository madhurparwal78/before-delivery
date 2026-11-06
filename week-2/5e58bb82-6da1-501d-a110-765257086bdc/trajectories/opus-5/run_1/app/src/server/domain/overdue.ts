/**
 * The one overdue check. A vessel is overdue when its hours since service are
 * strictly greater than its own service interval; exactly the interval is allowed.
 */
export function isOverdue(hoursSinceService: number, serviceIntervalH: number): boolean {
  return hoursSinceService > serviceIntervalH;
}

export const MIN_SERVICE_INTERVAL_H = 50;
export const MAX_SERVICE_INTERVAL_H = 1000;

export function validServiceInterval(value: unknown): value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return false;
  if (value < MIN_SERVICE_INTERVAL_H || value > MAX_SERVICE_INTERVAL_H) return false;
  return Math.abs(value * 10 - Math.round(value * 10)) < 1e-9;
}
