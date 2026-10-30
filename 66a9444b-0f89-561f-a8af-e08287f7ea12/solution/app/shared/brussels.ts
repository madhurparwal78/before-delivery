// Festival time: every wall time is Europe/Brussels, whatever the server's or browser's time zone.
// The festival-day rule, the repeated-hour rule and every displayed time format live here.

export const TIME_ZONE = "Europe/Brussels";
const DAY_START_HOUR = 5;
/** Brussels only ever uses +02:00 (CEST) and +01:00 (CET); summer first resolves the repeated hour. */
const OFFSETS_SUMMER_FIRST = [120, 60] as const;

type WallParts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

const partsFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: TIME_ZONE, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit",
});

function wallParts(instant: number): WallParts {
  const get: Record<string, number> = {};
  for (const part of partsFormat.formatToParts(new Date(instant))) {
    if (part.type !== "literal") get[part.type] = Number(part.value);
  }
  return { year: get.year!, month: get.month!, day: get.day!, hour: get.hour!, minute: get.minute!, second: get.second! };
}

function wallAsUtc(p: WallParts): number {
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
}

function offsetMinutesAt(instant: number): number {
  return Math.round((wallAsUtc(wallParts(instant)) - Math.floor(instant / 1000) * 1000) / 60_000);
}

/** The instants at which this wall time occurs, summer occurrence first (0, 1 or 2 of them). */
function occurrences(p: WallParts): { instant: number; offset: number }[] {
  const base = wallAsUtc(p);
  return OFFSETS_SUMMER_FIRST
    .map((offset) => ({ instant: base - offset * 60_000, offset }))
    .filter((candidate) => offsetMinutesAt(candidate.instant) === candidate.offset);
}

type WallResult =
  | { ok: true; instant: number }
  | { ok: false; error: "invalid" | "offset_mismatch" | "nonexistent_local_time" };

const WALL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?([+-]\d{2}:\d{2})?$/;

/**
 * Resolves a Brussels wall time. Without an offset the repeated hour means its first (summer) occurrence;
 * an explicit offset must be one Brussels uses at that wall time; a time in the spring gap does not exist.
 */
export function parseWall(text: unknown): WallResult {
  if (typeof text !== "string") return { ok: false, error: "invalid" };
  const m = WALL_RE.exec(text.trim());
  if (!m) return { ok: false, error: "invalid" };
  const p: WallParts = { year: +m[1]!, month: +m[2]!, day: +m[3]!, hour: +m[4]!, minute: +m[5]!, second: +(m[6] ?? 0) };
  const check = new Date(Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second));
  if (check.getUTCMonth() !== p.month - 1 || check.getUTCDate() !== p.day || p.hour > 23 || p.minute > 59 || p.second > 59) {
    return { ok: false, error: "invalid" };
  }
  const found = occurrences(p);
  if (!found.length) return { ok: false, error: "nonexistent_local_time" };
  if (m[7]) {
    const sign = m[7][0] === "-" ? -1 : 1;
    const offset = sign * (Number(m[7].slice(1, 3)) * 60 + Number(m[7].slice(4, 6)));
    const match = found.find((candidate) => candidate.offset === offset);
    return match ? { ok: true, instant: match.instant } : { ok: false, error: "offset_mismatch" };
  }
  return { ok: true, instant: found[0]!.instant };
}

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

function offsetText(minutes: number): string {
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  return `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/** The `_local` form: Brussels wall time with its offset, e.g. 2027-10-31T02:15:00+02:00. */
export function localIso(instant: number): string {
  const p = wallParts(instant);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}${offsetText(offsetMinutesAt(instant))}`;
}

function dateKey(p: { year: number; month: number; day: number }): string {
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return dateKey({ year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate() });
}

/** A festival day D runs from 05:00 on D to 05:00 on D + 1, Brussels time. */
export function festivalDayOf(instant: number): string {
  const p = wallParts(instant);
  const date = dateKey(p);
  return p.hour < DAY_START_HOUR ? addDays(date, -1) : date;
}

export function festivalDayBounds(date: string): { startsAt: number; endsAt: number } {
  const at = (d: string) => {
    const [year, month, day] = d.split("-").map(Number) as [number, number, number];
    return occurrences({ year, month, day, hour: DAY_START_HOUR, minute: 0, second: 0 })[0]!.instant;
  };
  return { startsAt: at(date), endsAt: at(addDays(date, 1)) };
}

export function datesBetween(first: string, last: string): string[] {
  const out: string[] = [];
  for (let d = first; d <= last; d = addDays(d, 1)) out.push(d);
  return out;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Fri 29 Oct" for a date key. */
export function dayLabel(date: string): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d));
  return `${WEEKDAYS[t.getUTCDay()]} ${d} ${MONTHS[m - 1]}`;
}

function inRepeatedHour(instant: number): boolean {
  return occurrences(wallParts(instant)).length === 2;
}

/** "HH:MM", with " CEST" or " CET" appended inside the repeated hour of a clock change. */
export function clockTime(instant: number): string {
  const p = wallParts(instant);
  const text = `${pad(p.hour)}:${pad(p.minute)}`;
  if (!inRepeatedHour(instant)) return text;
  return `${text} ${offsetMinutesAt(instant) === 120 ? "CEST" : "CET"}`;
}

/** "Ddd D Mon, HH:MM". */
export function deadlineText(instant: number): string {
  return `${dayLabel(dateKey(wallParts(instant)))}, ${clockTime(instant)}`;
}

/** "D Mon YYYY". */
export function dateText(instant: number): string {
  const p = wallParts(instant);
  return `${p.day} ${MONTHS[p.month - 1]} ${p.year}`;
}

/** Schedule rows: "Ddd D Mon · HH:MM–HH:MM". */
export function sessionTimeText(startsAt: number, endsAt: number): string {
  return `${dayLabel(dateKey(wallParts(startsAt)))} · ${clockTime(startsAt)}–${clockTime(endsAt)}`;
}
