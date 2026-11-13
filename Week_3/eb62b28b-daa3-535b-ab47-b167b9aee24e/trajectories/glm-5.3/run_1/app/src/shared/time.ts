import { DateTime, type Zone } from "luxon";

export const TIME_ZONE_IDS: Record<string, string> = {
  newYork: "America/New_York",
  chicago: "America/Chicago",
  denver: "America/Denver",
  phoenix: "America/Phoenix",
  losAngeles: "America/Los_Angeles",
};

export const ZONE_CITY: Record<string, string> = {
  newYork: "New York",
  chicago: "Chicago",
  denver: "Denver",
  phoenix: "Phoenix",
  losAngeles: "Los Angeles",
};

export const PHOENIX_ZONE: Zone | string = "America/Phoenix";

export function zoneFor(timeZone: string): string {
  return TIME_ZONE_IDS[timeZone] ?? "UTC";
}

export function cityFor(timeZone: string): string {
  return ZONE_CITY[timeZone] ?? "UTC";
}

/** Format an instant as `Mon 15 Mar 2027` in the given zone. */
export function formatDateIn(instant: Date, timeZoneId: string): string {
  return DateTime.fromJSDate(instant, { zone: timeZoneId }).toFormat("ccc dd MMM yyyy");
}

/** Format an instant as `Mon 15 Mar 2027, 07:20 Denver time` naming the city. */
export function formatDateTimeIn(instant: Date, timeZoneId: string, city: string): string {
  return `${formatDateIn(instant, timeZoneId)}, ${DateTime.fromJSDate(instant, { zone: timeZoneId }).toFormat("HH:mm")} ${city} time`;
}

/** Format an instant as `Mon 15 Mar 2027, 07:20`. */
export function formatDateTimeNoZone(instant: Date, timeZoneId: string): string {
  return `${formatDateIn(instant, timeZoneId)}, ${DateTime.fromJSDate(instant, { zone: timeZoneId }).toFormat("HH:mm")}`;
}

/** Local date `YYYY-MM-DD` for an instant in a zone. */
export function localDateIn(instant: Date, timeZoneId: string): string {
  return DateTime.fromJSDate(instant, { zone: timeZoneId }).toFormat("yyyy-MM-dd");
}

/** Local time `HH:MM` for an instant in a zone. */
export function localTimeIn(instant: Date, timeZoneId: string): string {
  return DateTime.fromJSDate(instant, { zone: timeZoneId }).toFormat("HH:mm");
}

/** Whole-second UTC instant string like `2027-03-15T13:00:00Z`. */
export function instantZ(instant: Date): string {
  return DateTime.fromJSDate(instant, { zone: "utc" }).toFormat("yyyy-MM-dd'T'HH:mm:ss'Z'");
}

/** Build a UTC Date from a local date + time in a zone. */
export function instantFromLocal(date: string, time: string, timeZoneId: string): Date {
  return DateTime.fromISO(`${date}T${time}:00`, { zone: timeZoneId }).toJSDate();
}

/** Whole years of age on a local date in a zone. */
export function ageInWholeYears(bornOn: string, onLocalDate: string): number {
  const birth = DateTime.fromISO(bornOn);
  const on = DateTime.fromISO(onLocalDate);
  let age = on.year - birth.year;
  const beforeBirthday =
    on.month < birth.month || (on.month === birth.month && on.day < birth.day);
  if (beforeBirthday) age -= 1;
  return age;
}

export type AgeBand = "age18To39" | "age40To59" | "age60Plus";

export function ageBandFor(ageYears: number): AgeBand {
  if (ageYears >= 60) return "age60Plus";
  if (ageYears >= 40) return "age40To59";
  return "age18To39";
}

/** Next local midnight after the given instant in a zone (whole seconds). */
export function nextLocalMidnight(instant: Date, timeZoneId: string): Date {
  const next = DateTime.fromJSDate(instant, { zone: timeZoneId }).plus({ days: 1 }).startOf("day");
  return next.toJSDate();
}
