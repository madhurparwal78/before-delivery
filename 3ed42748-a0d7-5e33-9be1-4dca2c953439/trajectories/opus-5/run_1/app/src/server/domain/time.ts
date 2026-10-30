/** Every time the API returns: ISO 8601 in UTC with `Z` and three fractional-second digits. */
export function isoTime(value: Date): string {
  return value.toISOString();
}
