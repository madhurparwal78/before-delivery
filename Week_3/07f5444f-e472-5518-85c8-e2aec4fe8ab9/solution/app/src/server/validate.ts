// Readers for untrusted request data: they check types instead of asserting them.

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function field(body: unknown, name: string): unknown {
  return isRecord(body) ? body[name] : undefined;
}

export function isWholeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

export function isIntegerIn(value: unknown, min: number, max: number): value is number {
  return isWholeNumber(value) && value >= min && value <= max;
}

const TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(?:Z|[+-](\d{2}):(\d{2}))$/;

/** An ISO 8601 timestamp with an explicit offset or Z, read as an instant; null otherwise. */
export function readInstant(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = TIMESTAMP.exec(value);
  if (!match) return null;
  const [year, month, day, hour, minute, second, offsetHours, offsetMinutes] = match.slice(1).map((v) => Number(v ?? 0));
  const calendar = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1));
  if (calendar.getUTCDate() !== day || calendar.getUTCMonth() !== (month ?? 1) - 1) return null;
  if ((hour ?? 0) > 23 || (minute ?? 0) > 59 || (second ?? 0) > 59 || (offsetHours ?? 0) > 23 || (offsetMinutes ?? 0) > 59) return null;
  const instant = Date.parse(value);
  return Number.isNaN(instant) ? null : instant;
}

/** 1 to 80 visible ASCII characters. */
export function readIdempotencyKey(value: string | string[] | undefined): string | null {
  return typeof value === "string" && /^[\x21-\x7e]{1,80}$/.test(value) ? value : null;
}
