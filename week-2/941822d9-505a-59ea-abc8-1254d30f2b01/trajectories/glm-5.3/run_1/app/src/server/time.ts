import { PROVIDER } from "./config.ts";

// Provider-time date and instant rules live here and nowhere else.

const dateTimeFormat = (): Intl.DateTimeFormat =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: PROVIDER.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

const partsFormat = (): Intl.DateTimeFormat =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: PROVIDER.timezone,
    year: "numeric",
    month: "short",
    day: "numeric",
  });

/** YYYY-MM-DD of an instant in the provider's time zone. */
export function providerDateOf(instant: Date): string {
  return dateTimeFormat().format(instant);
}

/** Today's date in the provider's time zone. */
export const providerToday = (): string => providerDateOf(new Date());

/** The UTC instant of 00:00:00.000 on a provider date, using that date's DST rules. */
export function providerStartOfDate(date: string): Date {
  return instantOfProviderWallClock(date, 0, 0, 0, 0);
}

/** The UTC instant of 23:59:59.999 on a provider date (the cohort close instant). */
export function providerCloseInstant(date: string): Date {
  return instantOfProviderWallClock(date, 23, 59, 59, 999);
}

// Chicago never changes clocks between 00:00:00 and 23:59:59 on any date, so
// one offset probe at midday pins the whole date.
function instantOfProviderWallClock(date: string, h: number, mi: number, s: number, ms: number): Date {
  const [y = 1970, mo = 1, d = 1] = date.split("-").map(Number);
  const wallMs = Date.UTC(y, (mo ?? 1) - 1, d, h, mi, s, ms);
  const probe = Date.UTC(y, (mo ?? 1) - 1, d, 12);
  const off = timezoneOffsetMs(probe);
  return new Date(wallMs - off);
}

function timezoneOffsetMs(instant: number): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: PROVIDER.timezone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(new Date(instant));
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value);
  const asUTC = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
  return asUTC - instant;
}

/** "Apr 3, 2030" for a provider date. */
export function displayDate(date: string): string {
  const [y = 1970, m = 1, d = 1] = date.split("-").map(Number);
  const anchor = Date.UTC(y, (m ?? 1) - 1, d, 12);
  return partsFormat().format(new Date(anchor));
}

export const isIsoDate = (raw: unknown): raw is string =>
  typeof raw === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw) && !Number.isNaN(Date.parse(`${raw}T00:00:00Z`));

/** "Apr 3, 2030 at 11:59 PM CT" — the close line shown for cohorts. */
export function closeLine(date: string): string {
  return `${displayDate(date)} at 11:59 PM CT`;
}

export function isoInstant(d: Date): string {
  return d.toISOString();
}
