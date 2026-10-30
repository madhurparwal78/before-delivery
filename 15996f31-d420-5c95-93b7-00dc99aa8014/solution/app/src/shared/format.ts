// Human text formats shared by the server (messages, emails, PDF) and the browser.
// Every date is a Pacific calendar date; money is integer cents; frames are integer tenths.

const PACIFIC = "America/Los_Angeles";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function money(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const whole = Math.trunc(Math.abs(cents) / 100);
  const rest = Math.abs(cents) % 100;
  return `${sign}$${whole.toLocaleString("en-US")}.${String(rest).padStart(2, "0")}`;
}

export function frames(tenths: number): string {
  return `${Math.trunc(tenths / 10)}.${tenths % 10}`;
}

/** "Madera" → "Madera County"; a county already written with the word is shown as stored. */
export function countyName(county: string): string {
  return /\bcounty$/i.test(county.trim()) ? county : `${county} County`;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A strict YYYY-MM-DD calendar date, or null. */
export function parseIsoDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = ISO_DATE.exec(value);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day ? value : null;
}

/** "2027-02-05" → "Feb 5, 2027" */
export function humanDate(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  return `${MONTHS[month - 1]} ${day}, ${year}`;
}

/** Parses "2027-02-05" or "Feb 5, 2027" into an ISO calendar date. */
export function parseDateInput(text: string): string | null {
  const trimmed = text.trim();
  const iso = parseIsoDate(trimmed);
  if (iso) return iso;
  const match = /^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(trimmed);
  if (!match) return null;
  const month = MONTHS.findIndex((name) => name.toLowerCase() === match[1].toLowerCase());
  if (month < 0) return null;
  return parseIsoDate(`${match[3]}-${String(month + 1).padStart(2, "0")}-${match[2].padStart(2, "0")}`);
}

interface WallClock {
  date: string;
  hour: number;
  minute: number;
}

const pacificParts = new Intl.DateTimeFormat("en-US", {
  timeZone: PACIFIC,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** The Pacific calendar date and 24-hour wall clock of an instant. */
export function pacificWallClock(instant: Date): WallClock {
  const parts = Object.fromEntries(pacificParts.formatToParts(instant).map((part) => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour), minute: Number(parts.minute) };
}

/** The America/Los_Angeles calendar date of an instant. */
export function pacificDate(instant: Date): string {
  return pacificWallClock(instant).date;
}

/** "Feb 5, 2027, 3:30 PM" in Pacific time. */
export function humanDateTime(instant: Date): string {
  const { date, hour, minute } = pacificWallClock(instant);
  return `${humanDate(date)}, ${humanTime(hour, minute)}`;
}

/** "3:30 PM" from a 24-hour wall clock. */
export function humanTime(hour: number, minute: number): string {
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelve}:${String(minute).padStart(2, "0")} ${hour < 12 ? "AM" : "PM"}`;
}

/** Parses "15:30", "3:30 PM" or "3:30pm" into a 24-hour wall clock. */
export function parseTimeInput(text: string): { hour: number; minute: number } | null {
  const match = /^(\d{1,2}):(\d{2})\s*([AaPp][Mm])?$/.exec(text.trim());
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const meridiem = match[3]?.toUpperCase();
  if (minute > 59) return null;
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (meridiem === "PM" ? 12 : 0);
  } else if (hour > 23) {
    return null;
  }
  return { hour, minute };
}

/** The instant of a Pacific wall-clock time, written with its Pacific UTC offset. */
export function pacificWallToIso(date: string, hour: number, minute: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const asUtc = Date.UTC(year, month - 1, day, hour, minute);
  let instant = asUtc;
  for (let pass = 0; pass < 2; pass += 1) {
    const seen = pacificWallClock(new Date(instant));
    const [sy, sm, sd] = seen.date.split("-").map(Number);
    const seenAsUtc = Date.UTC(sy, sm - 1, sd, seen.hour, seen.minute);
    instant += asUtc - seenAsUtc;
  }
  const offsetMinutes = Math.round((asUtc - instant) / 60000);
  const sign = offsetMinutes < 0 ? "-" : "+";
  const absolute = Math.abs(offsetMinutes);
  const offset = `${sign}${String(Math.trunc(absolute / 60)).padStart(2, "0")}:${String(absolute % 60).padStart(2, "0")}`;
  return `${date}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00${offset}`;
}

export function addDays(iso: string, days: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}
