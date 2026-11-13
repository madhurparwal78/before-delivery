/** Share-link validity is decided here, on every read, from the hiker's zone. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function todayInZone(timeZone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function isIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function isShareExpired(
  expiresOn: string | null,
  timeZone: string,
  now: Date = new Date(),
): boolean {
  if (expiresOn === null) return false;
  return expiresOn < todayInZone(timeZone, now);
}

export function isKnownTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}
