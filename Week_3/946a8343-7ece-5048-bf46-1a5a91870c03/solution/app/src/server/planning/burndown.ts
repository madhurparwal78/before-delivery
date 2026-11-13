// The milestone burndown: one point per day from start to due, computed from the issues' weight and state history.

export interface HistoryEvent {
  readonly at: number;
  readonly weight: number | null;
  readonly state: "opened" | "closed";
}

interface BurndownPoint {
  readonly day: string;
  readonly remaining: number;
  readonly future: boolean;
}

const DAY_MS = 86_400_000;
const MAX_DAYS = 3660;

function zoneParts(ms: number, zone: string): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(new Date(ms));
  const pick = (type: string): number => Number(parts.find((part) => part.type === type)?.value ?? "0");
  return { year: pick("year"), month: pick("month"), day: pick("day"), hour: pick("hour"), minute: pick("minute"), second: pick("second") };
}

function offsetAt(ms: number, zone: string): number {
  const p = zoneParts(ms, zone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

/** The calendar day (`YYYY-MM-DD`) a moment falls on in a zone. */
export function localDate(ms: number, zone: string): string {
  const p = zoneParts(ms, zone);
  return `${pad(p.year, 4)}-${pad(p.month, 2)}-${pad(p.day, 2)}`;
}

/** The first moment of a calendar day in a zone. */
export function dayStart(date: string, zone: string): number {
  const [year, month, day] = date.split("-").map(Number);
  const wall = Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1);
  const first = wall - offsetAt(wall, zone);
  return wall - offsetAt(first, zone);
}

export function addDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const moved = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1) + days * DAY_MS);
  return `${pad(moved.getUTCFullYear(), 4)}-${pad(moved.getUTCMonth() + 1, 2)}-${pad(moved.getUTCDate(), 2)}`;
}

/** Every day from `start` to `due`, both included. */
export function daysBetween(start: string, due: string): string[] {
  const days: string[] = [];
  for (let day = start; day <= due && days.length < MAX_DAYS; day = addDays(day, 1)) days.push(day);
  return days;
}

/** A real calendar date written `YYYY-MM-DD`. */
export function isDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === (month ?? 1) - 1 && parsed.getUTCDate() === day;
}

function remainingAt(histories: ReadonlyMap<number, readonly HistoryEvent[]>, cutoff: number): number {
  let total = 0;
  for (const events of histories.values()) {
    let latest: HistoryEvent | undefined;
    for (const event of events) {
      if (event.at < cutoff) latest = event;
    }
    if (latest !== undefined && latest.state === "opened") total += latest.weight ?? 0;
  }
  return total;
}

/** `remaining` for day d sums the weights at the end of d of the issues that were open then. Days after the current day in
 *  the milestone's zone are `future` and show the value of now. Events must be in the order they were logged. */
export function burndown(
  milestone: { readonly start: string; readonly due: string; readonly zone: string },
  histories: ReadonlyMap<number, readonly HistoryEvent[]>,
  nowMs: number,
): BurndownPoint[] {
  const today = localDate(nowMs, milestone.zone);
  return daysBetween(milestone.start, milestone.due).map((day) => {
    const future = day > today;
    const cutoff = future ? Number.POSITIVE_INFINITY : dayStart(addDays(day, 1), milestone.zone);
    return { day, remaining: remainingAt(histories, cutoff), future };
  });
}
