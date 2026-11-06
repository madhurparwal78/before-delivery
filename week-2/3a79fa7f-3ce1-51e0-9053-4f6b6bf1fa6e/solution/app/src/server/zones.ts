// Local wall-clock time in an IANA zone, with the zone's daylight-saving rules, through Intl.
interface Wall {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: string;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(zone: string): Intl.DateTimeFormat {
  let f = formatters.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: zone, hourCycle: "h23", weekday: "short", year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit",
    });
    formatters.set(zone, f);
  }
  return f;
}

export function wallClock(instant: Date, zone: string): Wall {
  const parts = Object.fromEntries(formatter(zone).formatToParts(instant).map((p) => [p.type, p.value]));
  return {
    year: Number(parts.year), month: Number(parts.month), day: Number(parts.day),
    hour: Number(parts.hour), minute: Number(parts.minute), weekday: String(parts.weekday),
  };
}

function offsetMs(instant: Date, zone: string): number {
  const w = wallClock(instant, zone);
  return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute) - Math.floor(instant.getTime() / 60000) * 60000;
}

/** The UTC instant of a local date and time in `zone`. */
export function localToUtc(year: number, month: number, day: number, hour: number, minute: number, zone: string): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const first = guess - offsetMs(new Date(guess), zone);
  const second = guess - offsetMs(new Date(first), zone);
  return new Date(second);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const day = (w: Wall) => `${w.weekday} ${w.day} ${MONTHS[w.month - 1]} ${w.year}`;
const hm = (w: Wall) => `${String(w.hour).padStart(2, "0")}:${String(w.minute).padStart(2, "0")}`;

/** `<Weekday short> <D> <Month short> <YYYY>, <HH:MM> to <HH:MM> local time` in the location's zone. */
export function slotLabel(starts: Date, ends: Date, zone: string): string {
  const a = wallClock(starts, zone);
  return `${day(a)}, ${hm(a)} to ${hm(wallClock(ends, zone))} local time`;
}

/** `<Weekday short> <D> <Month short> <YYYY>, <HH:MM> <zone>`: a callback start in the caller's zone. */
export function callbackLabel(start: Date, zone: string): string {
  const a = wallClock(start, zone);
  return `${day(a)}, ${hm(a)} ${zone}`;
}

/** `<Weekday short> <D> <Month short> <YYYY>` and `<HH:MM>` of an instant in `zone`. */
export function dayAndTime(instant: Date, zone: string): { day: string; time: string } {
  const w = wallClock(instant, zone);
  return { day: day(w), time: hm(w) };
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** `<Weekday short>, <Month short> <D>` of a stored calendar date such as 2026-10-29: "Thu, Oct 29". */
export function shortDate(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  return `${WEEKDAYS[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}
