/** Office time (America/Chicago): conversion, the DST rule, office dates and business days. */
export const OFFICE_TIME_ZONE = "America/Chicago";

const parts = new Intl.DateTimeFormat("en-US", {
  timeZone: OFFICE_TIME_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  timeZoneName: "short",
});

interface OfficeMoment {
  date: string;
  time: string;
  second: number;
  offset: "CST" | "CDT";
}

export function officeMoment(instant: Date): OfficeMoment {
  const found: Record<string, string> = {};
  for (const part of parts.formatToParts(instant)) found[part.type] = part.value;
  return {
    date: `${found.year}-${found.month}-${found.day}`,
    time: `${found.hour}:${found.minute}`,
    second: Number(found.second),
    offset: found.timeZoneName === "CDT" ? "CDT" : "CST",
  };
}

export function officeDate(instant: Date): string {
  return officeMoment(instant).date;
}

export function offsetAt(instant: Date): "CST" | "CDT" {
  return officeMoment(instant).offset;
}

const MINUTE = 60_000;

function localAsUtc(date: string, time: string): number {
  return Date.parse(`${date}T${time}:00Z`);
}

interface OfficeInstant {
  at: Date;
  shifted: boolean;
}

/**
 * The instant of a local office wall-clock time.
 * A time skipped by spring-forward moves to the first valid minute after it (shifted);
 * a time repeated by fall-back means its first occurrence.
 */
export function officeInstant(date: string, time: string): OfficeInstant {
  const wanted = localAsUtc(date, time);
  for (const hours of [5, 6]) {
    const candidate = new Date(wanted + hours * 3_600_000);
    const seen = officeMoment(candidate);
    if (seen.date === date && seen.time === time) return { at: candidate, shifted: false };
  }
  for (let minutes = 1; minutes <= 180; minutes++) {
    const probe = new Date(wanted + 5 * 3_600_000 + minutes * MINUTE);
    const seen = officeMoment(probe);
    if (localAsUtc(seen.date, seen.time) >= wanted) return { at: probe, shifted: true };
  }
  throw new Error(`office time ${date} ${time} cannot be resolved`);
}

export function officeMidnight(date: string): Date {
  return officeInstant(date, "00:00").at;
}

export function addDays(date: string, days: number): string {
  const moved = new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000);
  return moved.toISOString().slice(0, 10);
}

export function isRealDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function isLocalMinute(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return false;
  return isRealDate(value.slice(0, 10)) && Number(value.slice(11, 13)) < 24 && Number(value.slice(14, 16)) < 60;
}

function weekday(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

function isBusinessDay(date: string): boolean {
  const day = weekday(date);
  return day >= 1 && day <= 5;
}

/** The nth office business day after the date (Monday to Friday). */
export function businessDaysAfter(date: string, count: number): string {
  let current = date;
  let remaining = count;
  while (remaining > 0) {
    current = addDays(current, 1);
    if (isBusinessDay(current)) remaining--;
  }
  return current;
}

export function firstBusinessDayOnOrAfter(date: string): string {
  let current = date;
  while (!isBusinessDay(current)) current = addDays(current, 1);
  return current;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** `<office date>` display: Fri 1 Jan */
export function officeDateText(date: string): string {
  return `${WEEKDAYS[weekday(date)]} ${Number(date.slice(8, 10))} ${MONTHS[Number(date.slice(5, 7)) - 1]}`;
}

/** `<office stamp>` display: Thu 5 Nov, 14:05 CST */
export function officeStamp(instant: Date): string {
  const moment = officeMoment(instant);
  return `${officeDateText(moment.date)}, ${moment.time} ${moment.offset}`;
}

export function utcIso(instant: Date): string {
  return instant.toISOString();
}

/** Local office `YYYY-MM-DDTHH:MM` of an instant. */
export function localMinute(instant: Date): string {
  const moment = officeMoment(instant);
  return `${moment.date}T${moment.time}`;
}

export function quarterOf(date: string): { year: number; quarter: number; start: string } {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const quarter = Math.floor((month - 1) / 3) + 1;
  return { year, quarter, start: `${year}-${String((quarter - 1) * 3 + 1).padStart(2, "0")}-01` };
}

export function nextNineteen(after: Date): Date {
  const today = officeDate(after);
  const candidate = officeInstant(today, "19:00").at;
  if (candidate.getTime() > after.getTime()) return candidate;
  return officeInstant(addDays(today, 1), "19:00").at;
}
