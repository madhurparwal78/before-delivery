// The household zone: the one place that turns instants into household wall time and back.
// Every household day, offset, daylight-saving rule and household-time label goes through here,
// on the server and in the browser alike.

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

interface Wall {
  date: string;
  hour: number;
  minute: number;
  second: number;
}

const pad = (value: number, size = 2): string => String(value).padStart(size, "0");

const clockText = (hour: number, minute: number): string => `${pad(hour)}:${pad(minute)}`;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const INSTANT_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;
const WALL_RE = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/;
const CLOCK_RE = /^(\d{2}):(\d{2})$/;

/** A real calendar date written YYYY-MM-DD, or null. */
export function parseDate(text: unknown): string | null {
  if (typeof text !== "string") return null;
  const match = DATE_RE.exec(text);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day
    ? text
    : null;
}

/** A 24-hour clock time HH:MM from 00:00 to 23:59, as [hour, minute], or null. */
export function parseClock(text: unknown): [number, number] | null {
  if (typeof text !== "string") return null;
  const match = CLOCK_RE.exec(text);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour <= 23 && minute <= 59 ? [hour, minute] : null;
}

/** An ISO-8601 instant with seconds and an offset (or Z), as epoch milliseconds, or null. */
export function parseInstant(text: unknown): number | null {
  if (typeof text !== "string") return null;
  const match = INSTANT_RE.exec(text);
  if (!match) return null;
  if (!parseDate(`${match[1]}-${match[2]}-${match[3]}`)) return null;
  if (Number(match[4]) > 23 || Number(match[5]) > 59 || Number(match[6]) > 59) return null;
  const zone = match[8] ?? "Z";
  if (zone !== "Z" && (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4, 6)) > 59)) return null;
  const value = Date.parse(text);
  return Number.isFinite(value) ? value : null;
}

/** A household wall date-time YYYY-MM-DDTHH:MM, or null. */
export function parseWallDateTime(text: unknown): { date: string; hour: number; minute: number } | null {
  if (typeof text !== "string") return null;
  const match = WALL_RE.exec(text);
  if (!match || !parseDate(match[1])) return null;
  const clock = parseClock(`${match[2]}:${match[3]}`);
  return clock ? { date: match[1] as string, hour: clock[0], minute: clock[1] } : null;
}

export function addDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  const moved = new Date(Date.UTC(year, month - 1, day + days));
  return `${pad(moved.getUTCFullYear(), 4)}-${pad(moved.getUTCMonth() + 1)}-${pad(moved.getUTCDate())}`;
}

/** Days from `from` to `to` (both YYYY-MM-DD). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / (24 * HOUR));
}

/** 0 = Sunday … 6 = Saturday. */
export function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/** "Sunday 1 November 2026". */
export function longDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  return `${DAY_NAMES[weekdayOf(date)]} ${day} ${MONTH_NAMES[month - 1]} ${year}`;
}

/** "Sat". */
export function shortWeekday(date: string): string {
  return (DAY_NAMES[weekdayOf(date)] as string).slice(0, 3);
}

export class HouseholdZone {
  readonly name: string;
  private readonly format: Intl.DateTimeFormat;

  constructor(name: string) {
    this.name = name;
    this.format = new Intl.DateTimeFormat("en-US", {
      timeZone: name,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      timeZoneName: "short",
    });
  }

  private parts(instant: number): Wall & { abbr: string } {
    const found: Record<string, string> = {};
    for (const part of this.format.formatToParts(new Date(instant))) found[part.type] = part.value;
    return {
      date: `${found.year}-${found.month}-${found.day}`,
      hour: Number(found.hour) % 24,
      minute: Number(found.minute),
      second: Number(found.second),
      abbr: found.timeZoneName ?? "",
    };
  }

  wall(instant: number): Wall {
    const { date, hour, minute, second } = this.parts(instant);
    return { date, hour, minute, second };
  }

  /** The household day (YYYY-MM-DD) containing the instant. */
  day(instant: number): string {
    return this.parts(instant).date;
  }

  /** The zone's short name at the instant, for example CDT or CST. */
  abbr(instant: number): string {
    return this.parts(instant).abbr;
  }

  /** Offset from UTC in minutes at the instant (negative west of Greenwich). */
  offsetMinutes(instant: number): number {
    const wall = this.wall(instant);
    const [year, month, day] = wall.date.split("-").map(Number) as [number, number, number];
    const asUtc = Date.UTC(year, month - 1, day, wall.hour, wall.minute, wall.second);
    return Math.round((asUtc - Math.floor(instant / 1000) * 1000) / MINUTE);
  }

  /** "-05:00". */
  offsetText(instant: number): string {
    const minutes = this.offsetMinutes(instant);
    const sign = minutes < 0 ? "-" : "+";
    const size = Math.abs(minutes);
    return `${sign}${pad(Math.floor(size / 60))}:${pad(size % 60)}`;
  }

  /** ISO-8601 with seconds and the household offset: 2026-11-01T01:30:00-05:00. */
  iso(instant: number): string {
    const wall = this.wall(instant);
    return `${wall.date}T${clockText(wall.hour, wall.minute)}:${pad(wall.second)}${this.offsetText(instant)}`;
  }

  /** "HH:MM" household time. */
  clock(instant: number): string {
    const wall = this.wall(instant);
    return clockText(wall.hour, wall.minute);
  }

  /** "HH:MM:SS" household time. */
  clockSeconds(instant: number): string {
    const wall = this.wall(instant);
    return `${clockText(wall.hour, wall.minute)}:${pad(wall.second)}`;
  }

  /** Every instant whose household wall time is date hour:minute, earliest first (0, 1 or 2). */
  wallInstants(date: string, hour: number, minute: number): number[] {
    const [year, month, day] = date.split("-").map(Number) as [number, number, number];
    const asUtc = Date.UTC(year, month - 1, day, hour, minute);
    const offsets = new Set([
      this.offsetMinutes(asUtc - 24 * HOUR),
      this.offsetMinutes(asUtc),
      this.offsetMinutes(asUtc + 24 * HOUR),
    ]);
    const found: number[] = [];
    for (const offset of offsets) {
      const candidate = asUtc - offset * MINUTE;
      const wall = this.wall(candidate);
      if (wall.date === date && wall.hour === hour && wall.minute === minute && !found.includes(candidate)) {
        found.push(candidate);
      }
    }
    return found.sort((a, b) => a - b);
  }

  /** The first occurrence of a wall time, or null when the wall time is skipped by a clock change. */
  firstOccurrence(date: string, hour: number, minute: number): number | null {
    return this.wallInstants(date, hour, minute)[0] ?? null;
  }

  /**
   * When a recurring wall time happens on a household day: its first occurrence, or, inside the
   * hour skipped when clocks spring forward, the instant the clocks jump (03:00 CDT).
   */
  occurrence(date: string, hour: number, minute: number): number {
    const first = this.firstOccurrence(date, hour, minute);
    if (first !== null) return first;
    const [year, month, day] = date.split("-").map(Number) as [number, number, number];
    const asUtc = Date.UTC(year, month - 1, day, hour, minute);
    let low = asUtc - this.offsetMinutes(asUtc - 24 * HOUR) * MINUTE - 3 * HOUR;
    let high = low + 6 * HOUR;
    const before = this.offsetMinutes(low);
    while (high - low > MINUTE) {
      const middle = low + Math.floor((high - low) / (2 * MINUTE)) * MINUTE;
      if (this.offsetMinutes(middle) === before) low = middle;
      else high = middle;
    }
    return high;
  }

  /**
   * The plan address rule for a wall time on a day: the occurrence with the given offset, else its
   * first occurrence; a wall time the clocks skip means 03:00.
   */
  addressInstant(date: string, hour: number, minute: number, offset: string | null): number {
    const candidates = this.wallInstants(date, hour, minute);
    return candidates.find((candidate) => offset !== null && this.offsetText(candidate) === offset)
      ?? candidates[0] ?? this.occurrence(date, 3, 0);
  }

  /** The first instant of a household day (its midnight). */
  dayStart(date: string): number {
    return this.occurrence(date, 0, 0);
  }

  /** The first instant after a household day. */
  dayEnd(date: string): number {
    return this.dayStart(addDays(date, 1));
  }

  /** Whether the instant's wall time happens twice that day (the repeated hour of a fall-back day). */
  inRepeatedHour(instant: number): boolean {
    const wall = this.wall(instant);
    return [instant - HOUR, instant + HOUR].some((other) => {
      const seen = this.wall(other);
      return seen.date === wall.date && seen.hour === wall.hour && seen.minute === wall.minute;
    });
  }

  /** One mark per hour of the household day, with the two-digit wall hour and the zone name. */
  hourMarks(date: string): { at: number; label: string; abbr: string }[] {
    const marks: { at: number; label: string; abbr: string }[] = [];
    const end = this.dayEnd(date);
    for (let at = this.dayStart(date); at < end; at += HOUR) {
      marks.push({ at, label: pad(this.wall(at).hour), abbr: this.abbr(at) });
    }
    return marks;
  }
}
