import { format as fnsFormat, parseISO, isValid, addDays as fnsAddDays } from "date-fns";
import { toDate, toZonedTime, fromZonedTime } from "date-fns-tz";

export type TownId = "porto" | "izmir" | "hoChiMinhCity" | "cairo";

export const TOWNS: Record<TownId, { zone: string; name: string }> = {
  porto: { zone: "Europe/Lisbon", name: "Porto" },
  izmir: { zone: "Europe/Istanbul", name: "Izmir" },
  hoChiMinhCity: { zone: "Asia/Ho_Chi_Minh", name: "Ho Chi Minh City" },
  cairo: { zone: "Africa/Cairo", name: "Cairo" },
};

export const LISBON = "Europe/Lisbon";
export const UTC = "UTC";

/** Whole-second UTC instant with a Z: the single instant form. */
export function instantOf(date: Date): string {
  const t = Math.floor(date.getTime() / 1000) * 1000;
  return `${fnsFormat(toDate(new Date(t), { timeZone: UTC }), "yyyy-MM-dd'T'HH:mm:ss")}Z`;
}

export function parseInstant(s: string): Date {
  return parseISO(s);
}

/** Weekday, day, month, year in a zone's own calendar: `Mon 29 Mar 2027`. */
export function shownDate(date: Date, zone: string): string {
  const z = toZonedTime(date, zone);
  return fnsFormat(z, "EEE d MMM yyyy");
}

/** 24-hour wall time in a zone: `05:20`. */
export function shownTime(date: Date, zone: string): string {
  const z = toZonedTime(date, zone);
  return fnsFormat(z, "HH:mm");
}

/** `Mon 29 Mar 2027, 05:20 <town> time`. */
export function shownDateTime(date: Date, zone: string, townName: string): string {
  const z = toZonedTime(date, zone);
  return `${fnsFormat(z, "EEE d MMM yyyy")}, ${fnsFormat(z, "HH:mm")} ${townName} time`;
}

/** The Lisbon calendar date of an instant, as YYYY-MM-DD. */
export function lisbonDate(date: Date): string {
  return fnsFormat(toZonedTime(date, LISBON), "yyyy-MM-dd");
}

/** The local calendar date in a zone, as YYYY-MM-DD. */
export function localDateOf(date: Date, zone: string): string {
  return fnsFormat(toZonedTime(date, zone), "yyyy-MM-dd");
}

/**
 * Turn a local wall date and time in a zone into an instant. A time the clock change skips
 * is refused. A time that happens twice takes the first instant. The single place decided.
 */
export function wallToInstant(
  localDate: string,
  localTime: string,
  zone: string,
): { at: Date } | { skipped: true } {
  const naive = `${localDate}T${localTime}:00`;
  const wallOf = (d: Date): string => {
    const z = toZonedTime(d, zone);
    return `${fnsFormat(z, "yyyy-MM-dd")}T${fnsFormat(z, "HH:mm:ss")}`;
  };
  const direct = fromZonedTime(naive, zone);
  if (wallOf(direct) === naive) {
    // fromZonedTime resolves an ambiguous autumn time to the earlier instant, which is
    // the first of the two, exactly as published.
    return { at: direct };
  }
  // A clock change makes the direct conversion land on a different wall time. The minute
  // may be skipped, or it may happen twice and fromZonedTime picked the later instant:
  // probe the minute before and the minute after for an earlier match.
  const minuteMs = 60 * 1000;
  for (const probe of [direct.getTime() - minuteMs, direct.getTime() + minuteMs, direct.getTime() - 2 * minuteMs, direct.getTime() - 3 * minuteMs]) {
    const candidate = new Date(probe);
    if (wallOf(candidate) === naive) return { at: new Date(Math.floor(probe / 1000) * 1000) };
  }
  return { skipped: true };
}

/** Hours in a calendar day of a zone: 23 or 25 across a clock change, else 24. */
export function dayHours(zone: string, date: string): number {
  const start = fromZonedTime(`${date}T00:00:00`, zone);
  const nextDate = fnsAddDays(parseISO(`${date}T00:00:00Z`), 1).toISOString().slice(0, 10);
  const next = fromZonedTime(`${nextDate}T00:00:00`, zone);
  return Math.round((next.getTime() - start.getTime()) / 3600000);
}

export function isValidLocalDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && isValid(parseISO(`${s}T00:00:00Z`));
}

export function isValidLocalTime(s: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}

/** The instant 23:59:59 local wall time on a date in a zone. */
export function endOfDayInstant(date: string, zone: string): Date {
  const direct = fromZonedTime(`${date}T23:59:59`, zone);
  return direct;
}

export function addSeconds(date: Date, seconds: number): Date {
  return new Date(date.getTime() + seconds * 1000);
}

export function nowUtc(): Date {
  return new Date(Math.floor(Date.now() / 1000) * 1000);
}
