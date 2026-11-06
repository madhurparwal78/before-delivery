// Org-timezone calendar arithmetic for budget periods and rate scheduling.

export type ZoneName = string;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/;

/** Format an instant as YYYY-MM-DD HH:MM in the zone. */
export function formatLocal(dt: Date, zone: ZoneName): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(dt);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}

/**
 * Resolve a local wall-clock time "YYYY-MM-DDTHH:MM:SS" in the zone.
 * Returns null when that local time does not exist (skipped by a DST jump);
 * picks the first occurrence when it occurs twice.
 */
export function resolveLocal(local: string, zone: ZoneName): Date | null {
  const m = DATE_RE.exec(local);
  if (!m) return null;
  const [, ys, ms, ds, hs, mins, secs] = m;
  const y = Number(ys), mo = Number(ms), d = Number(ds), h = Number(hs), mi = Number(mins), se = Number(secs);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || se > 59) return null;
  const naive = Date.UTC(y, mo - 1, d, h, mi, se);
  const wanted = `${ys}-${ms}-${ds}T${hs}:${mins}:${secs}`;
  // Probe offsets around the naive instant.
  const probes = [naive - 26 * 3600e3, naive - 6 * 3600e3, naive, naive + 6 * 3600e3, naive + 26 * 3600e3];
  const offsets = [...new Set(probes.map((p) => tzOffsetMs(new Date(p), zone)))];
  const valid = offsets
    .map((o) => new Date(naive - o))
    .filter((inst) => formatLocalSeconds(inst, zone) === wanted)
    .map((inst) => inst.getTime());
  if (valid.length === 0) return null;
  return new Date(Math.min(...valid));
}

/** Full local timestamp with seconds, "YYYY-MM-DDTHH:MM:SS". */
function formatLocalSeconds(dt: Date, zone: ZoneName): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(dt);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}`;
}

/** Offset of the zone at the given instant, in ms east of UTC. */
export function tzOffsetMs(at: Date, zone: ZoneName): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? "0");
  const asUTC = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") % 24,
    get("minute"),
    get("second"),
  );
  return asUTC - at.getTime();
}

/** The budget period containing the instant: midnight on the 1st to midnight on the next 1st, in the zone. */
export function budgetPeriod(at: Date, zone: ZoneName): { startsAt: Date; endsAt: Date; label: string } {
  const localNow = formatLocal(at, zone);
  const [ys, ms] = localNow.split(" ")[0].split("-");
  const year = Number(ys), month = Number(ms);
  const startLocal = resolveLocal(`${firstOfMonth(year, month)}T00:00:00`, zone);
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const endLocal = resolveLocal(`${firstOfMonth(nextYear, nextMonth)}T00:00:00`, zone);
  if (!startLocal || !endLocal) throw new Error("budget period boundary resolution failed");
  return { startsAt: startLocal, endsAt: endLocal, label: monthLabel(month, year) };
}

function firstOfMonth(year: number, month: number): string {
  return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-01`;
}

function monthLabel(month: number, year: number): string {
  const names = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return `${names[month - 1]} ${year}`;
}

/** A date written as day, month name and year in the org zone, e.g. "1 November 2026". */
export function formatLongDate(at: Date, zone: ZoneName): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: zone, day: "numeric", month: "long", year: "numeric" }).format(at);
}

/** UTC ISO 8601 with a Z suffix. */
export function isoZ(at: Date): string {
  return at.toISOString().replace(/\.\d{3}Z$/, "Z");
}
