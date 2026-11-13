// Dates in a tournament's own time zone.
export function dateInZone(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
}

export function validTimeZone(timeZone: string): boolean {
  if (timeZone === 'UTC') return true;
  return Intl.supportedValuesOf('timeZone').includes(timeZone);
}

export function ordinal(place: number): string {
  const tens = place % 100;
  if (tens >= 11 && tens <= 13) return `${place}th`;
  return `${place}${({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[place % 10] ?? 'th'}`;
}
