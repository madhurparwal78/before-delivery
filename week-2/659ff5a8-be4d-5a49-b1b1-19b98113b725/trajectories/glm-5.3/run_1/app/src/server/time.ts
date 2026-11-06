// Time and time-zone helpers. All server arithmetic uses UTC; club-local
// formatting goes through the club's IANA time zone with the Intl API.

export interface ClubLocalDateTime {
  y: number;
  m: number;
  d: number;
  hh: number;
  mm: number;
}

export function timeZoneIsValid(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Convert a club-local wall date/time to a UTC instant. */
export function localToUtc(date: string, time: string, tz: string): Date {
  const match = time.match(/^(\d{2}):(\d{2})$/);
  if (!match) throw new Error(`Invalid local time ${time}`);
  return wallToUtc(Date.parse(`${date}T00:00:00Z`), Number(match[1]), Number(match[2]), tz);
}

function wallToUtc(midnightUtc: number, hh: number, mm: number, tz: string): Date {
  const guess = new Date(midnightUtc + ((hh * 60 + mm) - offsetMinutes(midnightUtc, tz)) * 60_000);
  // A DST boundary inside the day can need one correction.
  const corrected = new Date(midnightUtc + ((hh * 60 + mm) - offsetMinutes(guess.getTime(), tz)) * 60_000);
  return corrected;
}

function offsetMinutes(utcMs: number, tz: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const parts = dtf.formatToParts(new Date(utcMs));
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  const asUtc = Date.UTC(
    Number(map.year), Number(map.month) - 1, Number(map.day),
    Number(map.hour) % 24, Number(map.minute), Number(map.second),
  );
  return Math.round((asUtc - utcMs) / 60_000);
}

/** Format an instant as a club-local "YYYY-MM-DD HH:MM" string. */
export function formatLocalDateTime(at: Date, tz: string): string {
  const p = localParts(at, tz);
  return `${p.y}-${pad(p.m)}-${pad(p.d)} ${pad(p.hh)}:${pad(p.mm)}`;
}

export function formatLocalDate(at: Date, tz: string): string {
  const p = localParts(at, tz);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
}

export function formatUtcDateTime(at: Date): string {
  return `${at.toISOString().slice(0, 10)} ${at.toISOString().slice(11, 16)}`;
}

export function localParts(at: Date, tz: string): ClubLocalDateTime {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  });
  const map: Record<string, string> = {};
  for (const p of dtf.formatToParts(at)) map[p.type] = p.value;
  return {
    y: Number(map.year), m: Number(map.month), d: Number(map.day),
    hh: Number(map.hour) % 24, mm: Number(map.minute),
  };
}

/** Current club-local date and clock minute. */
export function nowLocal(tz: string): ClubLocalDateTime {
  return localParts(new Date(), tz);
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}
