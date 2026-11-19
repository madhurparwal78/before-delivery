// Scheduled wall-clock times and local calendar days in the facilitator's IANA time zone.

const formatters = new Map<string, Intl.DateTimeFormat>();

function parts(instant: number, zone: string) {
  let formatter = formatters.get(zone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-GB", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(zone, formatter);
  }
  const out: Record<string, number> = {};
  for (const p of formatter.formatToParts(new Date(instant))) if (p.type !== "literal") out[p.type] = Number(p.value);
  return out as { year: number; month: number; day: number; hour: number; minute: number; second: number };
}

/** The wall clock of an instant, as if it were UTC, in milliseconds. */
function wallOf(instant: number, zone: string): number {
  const p = parts(instant, zone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
}

const WALL = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)$/;

export type Resolution = { ok: true; instant: Date } | { ok: false; reason: "format" | "gap" };

/**
 * Resolves a local `YYYY-MM-DDTHH:MM` to an instant. A time in a spring-forward gap does not exist;
 * a time in a fall-back overlap resolves to the earlier instant.
 */
export function resolveWallTime(value: unknown, zone: string): Resolution {
  const match = typeof value === "string" ? WALL.exec(value) : null;
  if (!match) return { ok: false, reason: "format" };
  const [, y, mo, d, h, mi] = match.map(Number) as [number, number, number, number, number, number];
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  const check = new Date(wall);
  if (check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d || h > 23 || mi > 59) return { ok: false, reason: "format" };
  const offsets = new Set([-1, 1].map((days) => wallOf(wall + days * 86_400_000, zone) - (wall + days * 86_400_000)));
  const candidates = [...offsets].map((offset) => wall - offset).filter((instant) => wallOf(instant, zone) === wall);
  if (candidates.length === 0) return { ok: false, reason: "gap" };
  return { ok: true, instant: new Date(Math.min(...candidates)) };
}

/** The local calendar day of an instant, `YYYY-MM-DD`. */
export function localDay(instant: Date, zone: string): string {
  const p = parts(instant.getTime(), zone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** Whole seconds, rounded up, from an instant until the next local midnight. */
export function secondsToLocalMidnight(instant: Date, zone: string): number {
  const p = parts(instant.getTime(), zone);
  const next = new Date(Date.UTC(p.year, p.month - 1, p.day + 1));
  const day = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
  let midnight = resolveWallTime(`${day}T00:00`, zone);
  for (let minute = 1; !midnight.ok && minute < 180; minute += 1) {
    midnight = resolveWallTime(`${day}T${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`, zone);
  }
  if (!midnight.ok) throw new Error(`no midnight in ${zone}`);
  return Math.ceil((midnight.instant.getTime() - instant.getTime()) / 1000);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "4 Mar 2027, 14:00" style text for emails, in the given zone. */
export function formatLocal(instant: Date, zone: string): string {
  const p = parts(instant.getTime(), zone);
  return `${p.day} ${MONTHS[p.month - 1]} ${p.year}, ${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}
