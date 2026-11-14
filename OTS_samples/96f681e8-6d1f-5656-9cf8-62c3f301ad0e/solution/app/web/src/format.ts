export function euros(cents: number): string {
  return `€${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

export function clubDate(start: string): string {
  return start.slice(0, 10);
}

export function clubTime(start: string): string {
  return start.slice(11, 16);
}

export function level(value: number): string {
  return value.toFixed(1);
}

export function spokenDuration(seconds: number): string {
  let unit = "second";
  let count = seconds;
  if (seconds % 3600 === 0) {
    unit = "hour";
    count = seconds / 3600;
  } else if (seconds % 60 === 0) {
    unit = "minute";
    count = seconds / 60;
  }
  return `${count} ${unit}${count === 1 ? "" : "s"}`;
}

export function addDays(day: string, days: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return date.toISOString().slice(0, 10);
}

export function validDay(text: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  return addDays(text, 0) === text;
}

/** The club's IANA timezone, as `GET /api/club` reports it; set once before the first paint. */
let clubParts = partsIn("Europe/Madrid");

function partsIn(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
}

export function setClubTimezone(timeZone: string): void {
  try {
    clubParts = partsIn(timeZone);
  } catch {
    // An unknown zone keeps the default; the server names the zone it uses on every answer that needs it.
  }
}

function partsOf(instantMs: number): Record<string, string> {
  return Object.fromEntries(clubParts.formatToParts(instantMs).map((p) => [p.type, p.value]));
}

/** An instant written as club date and time: `YYYY-MM-DD HH:MM`. */
export function clubDateTime(iso: string): string {
  const parts = partsOf(Date.parse(iso));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

/** The club date of an instant, written YYYY-MM-DD: the date in the club's timezone, never the browser's. */
export function clubToday(instantMs: number): string {
  const parts = partsOf(instantMs);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** Players in a full match. */
export const playersPerMatch = 4;

/** Levels from 1.0 to 7.0 in steps of 0.5, as the club writes them. */
export const levelOptions = Array.from({ length: 13 }, (_, i) => (1 + i * 0.5).toFixed(1));
