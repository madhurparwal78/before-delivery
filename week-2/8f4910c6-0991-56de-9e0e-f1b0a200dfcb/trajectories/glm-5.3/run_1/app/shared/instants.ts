/** Instant helpers. Instants are ISO 8601 UTC whole seconds. */

const R_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function toInstant(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function nowInstant(): string {
  return toInstant(new Date());
}

export function parseDateOnly(value: string): { y: number; m: number; d: number } | null {
  const m = R_DATE.exec(value);
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return { y, m: mo, d };
}

/** Format a Date as YYYY-MM-DD in the given zone. */
export function dateOnlyInZone(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(instant);
  return parts;
}
