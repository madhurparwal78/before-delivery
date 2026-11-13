// Evening-date and UTC-offset rules, shared by browser and server (DP-25, DP-63).

export const siteTimeZones = [
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Phoenix",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Budapest",
  "Africa/Johannesburg",
  "Asia/Tokyo",
  "Australia/Sydney",
  "Pacific/Auckland",
] as const;

export type SiteTimeZone = (typeof siteTimeZones)[number];

// Parse an input timestamp: YYYY-MM-DDTHH:MM:SSZ or with 1-3 fraction digits.
export interface ParsedTime {
  readonly epochMs: number;
  readonly text: string; // canonical YYYY-MM-DDTHH:MM:SSZ
}

const inputRe = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,3})?Z$/;

export function parseInputTime(value: string): ParsedTime | null {
  const m = inputRe.exec(value ?? "");
  if (!m) return null;
  const [y, mo, d, h, mi, s] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6])];
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return null;
  const ms = Date.UTC(y, mo - 1, d, h, mi, s);
  if (Number.isNaN(ms)) return null;
  const date = new Date(ms);
  if (date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null; // rejects 2026-02-30
  return { epochMs: ms, text: canonicalUtc(ms) };
}

export function canonicalUtc(epochMs: number): string {
  const date = new Date(epochMs);
  const p = (n: number, width = 2) => String(n).padStart(width, "0");
  return `${p(date.getUTCFullYear(), 4)}-${p(date.getUTCMonth() + 1)}-${p(date.getUTCDate())}T${p(date.getUTCHours())}:${p(date.getUTCMinutes())}:${p(date.getUTCSeconds())}Z`;
}

// Offset of a zone at an instant, as +HH:MM / -HH:MM with ASCII hyphen-minus.
export function utcOffset(epochMs: number, timeZone: string): string {
  const dtf = new Intl.DateTimeFormat("en-US", { timeZone, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const parts = dtf.formatToParts(new Date(epochMs));
  const get = (type: Intl.DateTimeFormatPartTypes): number => Number(parts.find((p) => p.type === type)?.value ?? "0");
  let hour = get("hour");
  if (hour === 24) hour = 0;
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), hour, get("minute"), get("second"));
  let diffMin = Math.round((asUtc - Math.floor(epochMs / 1000) * 1000) / 60000);
  if (diffMin >= 24 * 60) diffMin -= 24 * 60;
  if (diffMin <= -24 * 60) diffMin += 24 * 60;
  const sign = diffMin < 0 ? "-" : "+";
  const abs = Math.abs(diffMin);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return `${sign}${hh}:${mm}`;
}

export function offsetMinutes(epochMs: number, timeZone: string): number {
  const off = utcOffset(epochMs, timeZone);
  const sign = off[0] === "-" ? -1 : 1;
  const [hh, mm] = off.slice(1).split(":");
  return sign * (Number(hh) * 60 + Number(mm));
}

// The wall clock in the site zone as HH:MM.
export function localHHMM(epochMs: number, timeZone: string): string {
  const dtf = new Intl.DateTimeFormat("en-GB", { timeZone, hour12: false, hour: "2-digit", minute: "2-digit" });
  return dtf.format(new Date(epochMs));
}

// The site-zone calendar date of the instant, as YYYY-MM-DD.
export function localDate(epochMs: number, timeZone: string): string {
  const dtf = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  return dtf.format(new Date(epochMs));
}

// A session's evening date: the site-zone calendar date, or the day before
// when the local start time is earlier than 12:00.
export function eveningDateFor(startEpochMs: number, timeZone: string): string {
  const date = localDate(startEpochMs, timeZone);
  const hm = localHHMM(startEpochMs, timeZone);
  const hour = Number(hm.slice(0, 2));
  if (hour < 12) {
    const dayBefore = new Date(startEpochMs - 24 * 60 * 60 * 1000);
    // Use the zone's calendar date of a moment 24h earlier.
    return localDate(dayBefore.getTime(), timeZone);
  }
  return date;
}

export const OBSERVATION_WINDOW_HOURS = 18;

export function observedAtWithinSession(observedEpochMs: number, startEpochMs: number): boolean {
  if (observedEpochMs < startEpochMs) return false;
  return observedEpochMs - startEpochMs < OBSERVATION_WINDOW_HOURS * 60 * 60 * 1000;
}

export const START_FUTURE_TOLERANCE_SECONDS = 60;
export const EDIT_FUTURE_TOLERANCE_SECONDS = 60;

export function parseHHMMDate(value: string): ParsedTime | null {
  // "YYYY-MM-DD HH:MM" -> "YYYY-MM-DDTHH:MM:00Z"
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(value ?? "");
  if (!m) return null;
  const [, y, mo, d, h, mi] = m;
  return parseInputTime(`${y}-${mo}-${d}T${h}:${mi}:00Z`);
}
