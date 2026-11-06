// Provider-time calendar rules. Every date the API exchanges is a provider calendar date (YYYY-MM-DD).

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

const parts = (zone: string, instant: Date): Record<string, number> => {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const out: Record<string, number> = {};
  for (const part of formatter.formatToParts(instant)) {
    if (part.type !== "literal") out[part.type] = parseInt(part.value, 10);
  }
  return out;
};

/** Milliseconds the zone's wall clock is ahead of UTC at `instant` (DST-aware). */
const zoneOffsetMs = (zone: string, instant: Date): number => {
  const p = parts(zone, instant);
  const wall = Date.UTC(p.year ?? 0, (p.month ?? 1) - 1, p.day ?? 1, p.hour ?? 0, p.minute ?? 0, p.second ?? 0);
  return wall - (instant.getTime() - instant.getUTCMilliseconds());
};

/** True for a real calendar date written YYYY-MM-DD. */
export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = DATE_RE.exec(value);
  if (!match) return false;
  const [year, month, day] = [match[1], match[2], match[3]].map((x) => parseInt(x ?? "", 10));
  const probe = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1));
  return probe.getUTCFullYear() === year && probe.getUTCMonth() + 1 === month && probe.getUTCDate() === day;
}

/** The provider calendar date of an instant. */
export function providerDate(zone: string, instant: Date): string {
  const p = parts(zone, instant);
  const pad = (n: number | undefined, width: number) => String(n ?? 0).padStart(width, "0");
  return `${pad(p.year, 4)}-${pad(p.month, 2)}-${pad(p.day, 2)}`;
}

/** The UTC instant of a wall-clock time on a provider calendar date, using that date's own offset. */
function providerInstant(zone: string, date: string, hour: number, minute: number, second: number, ms: number): Date {
  const match = DATE_RE.exec(date);
  if (!match) throw new Error(`not a calendar date: ${date}`);
  const wall = Date.UTC(parseInt(match[1] ?? "", 10), parseInt(match[2] ?? "", 10) - 1, parseInt(match[3] ?? "", 10), hour, minute, second, ms);
  let guess = wall;
  for (let i = 0; i < 3; i += 1) {
    const next = wall - zoneOffsetMs(zone, new Date(guess));
    if (next === guess) break;
    guess = next;
  }
  return new Date(guess);
}

/** A cohort's close instant: 23:59:59.999 on its close date in provider time. */
export const cohortClosesAt = (zone: string, closeDate: string): Date => providerInstant(zone, closeDate, 23, 59, 59, 999);

/** The start of a provider calendar date (00:00 provider time). */
export const providerMidnight = (zone: string, date: string): Date => providerInstant(zone, date, 0, 0, 0, 0);

/** Days from `from` to `to`, both counted. */
export function inclusiveDays(from: string, to: string): number {
  const start = Date.UTC(parseInt(from.slice(0, 4), 10), parseInt(from.slice(5, 7), 10) - 1, parseInt(from.slice(8, 10), 10));
  const end = Date.UTC(parseInt(to.slice(0, 4), 10), parseInt(to.slice(5, 7), 10) - 1, parseInt(to.slice(8, 10), 10));
  return (end - start) / 86_400_000 + 1;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** `<Mon D, YYYY>` for a provider calendar date, as the brief writes it (Apr 3, 2030). */
export function monDYyyy(date: string): string {
  return `${MONTHS[parseInt(date.slice(5, 7), 10) - 1] ?? ""} ${parseInt(date.slice(8, 10), 10)}, ${date.slice(0, 4)}`;
}

/** Adds whole calendar months in UTC, clamping to the last day of a shorter month. */
export function addCalendarMonths(instant: Date, months: number): Date {
  const target = new Date(instant.getTime());
  const day = target.getUTCDate();
  target.setUTCDate(1);
  target.setUTCMonth(target.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target;
}
