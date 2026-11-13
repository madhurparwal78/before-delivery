// District time: window status, the ordering horizon, window labels and district dates are decided
// here, against the server's own clock, and nowhere else.
import type { FieldErrors } from "./http.ts";

export const DISTRICT_ZONE = "Australia/Sydney";

export type WindowStatus = "upcoming" | "open" | "closing" | "closed";

const HOUR_MS = 3_600_000;
const CLOSING_MS = 30 * 60_000;
const HORIZON_MS = 240 * HOUR_MS;

export function windowStatus(opensAt: Date, closesAt: Date, now: Date): WindowStatus {
  if (now < opensAt) return "upcoming";
  if (now >= closesAt) return "closed";
  if (now.getTime() >= closesAt.getTime() - CLOSING_MS) return "closing";
  return "open";
}

type Horizon = "too_early" | "orderable" | "window_closed";

export function orderingHorizon(opensAt: Date, closesAt: Date, now: Date): Horizon {
  if (now.getTime() < opensAt.getTime() - HORIZON_MS) return "too_early";
  if (now >= closesAt) return "window_closed";
  return "orderable";
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const districtParts = new Intl.DateTimeFormat("en-AU", {
  timeZone: DISTRICT_ZONE,
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  hourCycle: "h23",
});

interface DistrictClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

function inDistrict(instant: Date): DistrictClock {
  const parts = Object.fromEntries(
    districtParts.formatToParts(instant).map((part) => [part.type, part.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

const two = (n: number) => String(n).padStart(2, "0");

const sameReading = (a: DistrictClock, b: DistrictClock) =>
  a.year === b.year && a.month === b.month && a.day === b.day && a.hour === b.hour && a.minute === b.minute;

/** The repeated-hour mark: the district clock reads the same an hour later on the first pass of
 * April's repeated hour (AEDT) and an hour earlier on the second (AEST); every other instant has none. */
function repeatedHourMark(instant: Date, t: DistrictClock): string {
  if (sameReading(t, inDistrict(new Date(instant.getTime() + HOUR_MS)))) return " AEDT";
  if (sameReading(t, inDistrict(new Date(instant.getTime() - HOUR_MS)))) return " AEST";
  return "";
}

function districtStamp(instant: Date): string {
  const t = inDistrict(instant);
  const weekday = DAYS[new Date(Date.UTC(t.year, t.month - 1, t.day)).getUTCDay()];
  return `${weekday} ${t.day} ${MONTHS[t.month - 1]} ${two(t.hour)}:${two(t.minute)}${repeatedHourMark(instant, t)}`;
}

/** `<Ddd> <D> <Mon> <HH:MM> to <Ddd> <D> <Mon> <HH:MM>` in the district zone, with the repeated-hour mark. */
export function windowLabel(opensAt: Date, closesAt: Date): string {
  return `${districtStamp(opensAt)} to ${districtStamp(closesAt)}`;
}

/** An instant written for people in the district zone, used in notice bodies. */
export function districtInstant(instant: Date): string {
  const t = inDistrict(instant);
  const weekday = DAYS[new Date(Date.UTC(t.year, t.month - 1, t.day)).getUTCDay()];
  return `${weekday} ${t.day} ${MONTHS[t.month - 1]} ${t.year} ${two(t.hour)}:${two(t.minute)} (${DISTRICT_ZONE} time)`;
}

/** The API instant form: UTC, truncated down to the whole second, ending in Z. */
export function isoInstant(instant: Date): string {
  return instant.toISOString().replace(/\.\d{3}Z$/, "Z");
}

const DATE_TEXT = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A valid `YYYY-MM-DD` calendar date as its day number since the epoch, else null. */
function parseDate(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = DATE_TEXT.exec(value);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const utc = Date.UTC(year, month - 1, day);
  const check = new Date(utc);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return utc / 86_400_000;
}

const PERIOD_MAX_DAYS = 92;

export interface DistrictPeriod {
  from: string;
  to: string;
}

/** The district-date period rule: `from` and `to` are YYYY-MM-DD district dates, `to` on or after
 * `from`, at most 92 days with both ends counted. Failures are added to `errors`; null when invalid. */
export function districtPeriod(from: unknown, to: unknown, errors: FieldErrors): DistrictPeriod | null {
  const first = parseDate(from);
  const last = parseDate(to);
  if (first === null) errors.add("from", "Give the first day as YYYY-MM-DD.");
  if (last === null) errors.add("to", "Give the last day as YYYY-MM-DD.");
  else if (first !== null && last < first) errors.add("to", "The last day must be on or after the first day.");
  else if (first !== null && last - first + 1 > PERIOD_MAX_DAYS) errors.add("to", "A period covers at most 92 days.");
  return first !== null && last !== null && last >= first && last - first + 1 <= PERIOD_MAX_DAYS
    ? { from: from as string, to: to as string }
    : null;
}

const INSTANT_TEXT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

/** An instant in the API form `YYYY-MM-DDTHH:MM:SSZ` that names a real moment, else null. */
export function parseInstant(value: unknown): Date | null {
  if (typeof value !== "string" || !INSTANT_TEXT.test(value)) return null;
  const instant = new Date(value);
  return !Number.isNaN(instant.getTime()) && isoInstant(instant) === value ? instant : null;
}

/** A restriction's effective minute: the publish instant truncated down to the whole UTC minute. */
export function effectiveMinute(instant: Date): Date {
  return new Date(Math.floor(instant.getTime() / 60_000) * 60_000);
}

/** Whole minutes from a window's opening to its restriction's effective minute, 0 when at or before it. */
export function minutesBefore(opensAt: Date, effectiveAt: Date): number {
  return Math.max(0, Math.floor((effectiveAt.getTime() - opensAt.getTime()) / 60_000));
}

export const HOUR = HOUR_MS;
