/** Every time-dependent decision and every timestamp in a response comes from the server's clock. */
export function now(): Date {
  return new Date();
}

export function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return new Date(String(value)).toISOString();
}

export function isoOrNull(value: unknown): string | null {
  return value === null || value === undefined ? null : iso(value);
}

export function secondsUntil(value: unknown, from: Date = now()): number {
  return Math.floor((new Date(value instanceof Date ? value : String(value)).getTime() - from.getTime()) / 1000);
}
