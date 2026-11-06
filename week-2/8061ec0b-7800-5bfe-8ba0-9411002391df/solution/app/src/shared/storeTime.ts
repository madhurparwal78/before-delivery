// The store's calendar: America/Chicago dates, wall-clock conversion and the published date formats.

const STORE_TIME_ZONE = "America/Chicago";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October",
  "November", "December"];

const partsFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: STORE_TIME_ZONE, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", timeZoneName: "short",
});

interface WallClock { year: number; month: number; day: number; hour: number; minute: number; second: number; zone: string }

function wallClock(instant: Date): WallClock {
  const parts = Object.fromEntries(partsFormat.formatToParts(instant).map((p) => [p.type, p.value]));
  return {
    year: Number(parts.year), month: Number(parts.month), day: Number(parts.day), hour: Number(parts.hour),
    minute: Number(parts.minute), second: Number(parts.second), zone: parts.timeZoneName ?? "",
  };
}

function isoDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function dateParts(date: string): [number, number, number] {
  const [y, m, d] = date.split("-").map(Number);
  return [y, m, d];
}

/** The store-calendar date ("YYYY-MM-DD") of an instant. */
export function storeDateOf(instant: Date): string {
  const w = wallClock(instant);
  return isoDate(w.year, w.month, w.day);
}

/** The instant at which the store's wall clock reads `hour:minute` on `date`. */
export function storeWallClockInstant(date: string, hour: number, minute: number): Date {
  const [y, m, d] = dateParts(date);
  const asUtc = Date.UTC(y, m - 1, d, hour, minute);
  let guess = asUtc;
  for (let i = 0; i < 2; i++) {
    const w = wallClock(new Date(guess));
    const offset = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second) - guess;
    guess = asUtc - offset;
  }
  return new Date(guess);
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = dateParts(date);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return isoDate(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** Calendar months added to `date`, the day clamped to the target month's last day. */
export function addMonthsClamped(date: string, months: number): string {
  const [y, m, d] = dateParts(date);
  const index = y * 12 + (m - 1) + months;
  const year = Math.trunc(index / 12);
  const month = (index % 12) + 1;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return isoDate(year, month, Math.min(d, lastDay));
}

/** 0 = Sunday … 6 = Saturday. */
export function weekdayOf(date: string): number {
  const [y, m, d] = dateParts(date);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function isCalendarDate(text: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const [y, m, d] = dateParts(text);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/** "November 3, 2026" for a store-calendar date. */
export function formatDate(date: string): string {
  const [y, m, d] = dateParts(date);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

/** "November 2, 2026, 5:00 PM CST" in store time, with the abbreviation in force at that instant. */
export function formatDateTime(instant: Date | string): string {
  const w = wallClock(typeof instant === "string" ? new Date(instant) : instant);
  const hour12 = w.hour % 12 === 0 ? 12 : w.hour % 12;
  return `${MONTHS[w.month - 1]} ${w.day}, ${w.year}, ${hour12}:${String(w.minute).padStart(2, "0")} ${w.hour < 12 ? "AM" : "PM"} ${w.zone}`;
}

/** ISO 8601 UTC to the second ("2026-11-04T23:00:00Z"). */
export function isoSecond(instant: Date): string {
  return instant.toISOString().replace(/\.\d{3}Z$/, "Z");
}
