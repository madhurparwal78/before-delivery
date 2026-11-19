/** ISO-8601 UTC instants with exactly three fractional-second digits. */
export function isoInstant(ms: number): string {
  return new Date(ms).toISOString().replace(/(\.\d{3})Z$/, '$1Z');
}
