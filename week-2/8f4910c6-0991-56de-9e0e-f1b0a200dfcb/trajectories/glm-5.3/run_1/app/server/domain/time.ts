import { OFFICE_META, type Office } from "../../shared/domain.js";

/** Time-zone aware helpers for office-local dates, auto release and hold-until. */

export const AUTO_RELEASE_HOUR = 12;

function partsIn(instant: Date, timeZone: string): Intl.DateTimeFormatPart[] {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "short", hour12: false }).formatToParts(instant);
}

export function dateInZone(instant: Date, timeZone: string): string {
  const p = partsIn(instant, timeZone);
  return `${p.find((x) => x.type === "year")!.value}-${p.find((x) => x.type === "month")!.value}-${p.find((x) => x.type === "day")!.value}`;
}

function weekdayIndex(dateOnly: string): number {
  const [y, m, d] = dateOnly.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function isBusinessDay(dateOnly: string, closures: Set<string>): boolean {
  const wd = weekdayIndex(dateOnly);
  if (wd === 0 || wd === 6) return false;
  return !closures.has(dateOnly);
}

export function addDays(dateOnly: string, days: number): string {
  const [y, m, d] = dateOnly.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
}

/** Latest business day strictly before the job day. */
export function previousBusinessDay(jobDate: string, closures: Set<string>): string {
  let d = addDays(jobDate, -1);
  while (!isBusinessDay(d, closures)) d = addDays(d, -1);
  return d;
}

/** Resolve a wall-clock time in a zone to the earliest matching instant. Returns null for a gap. */
export function resolveLocal(local: string, timeZone: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(local);
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]), h = Number(m[4]), mi = Number(m[5]);
  const s = m[6] ? Number(m[6]) : 0;
  const naiveUtc = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
  const want = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}T${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  // Scan for the earliest candidate instant whose parts in the zone equal the wanted local time.
  for (let offsetMs = -20 * 3600 * 1000; offsetMs <= 20 * 3600 * 1000; offsetMs += 60 * 1000) {
    const candidate = new Date(naiveUtc.getTime() + offsetMs);
    const p = partsIn(candidate, timeZone);
    const hourPart = p.find((x) => x.type === "hour")!.value === "24" ? "00" : p.find((x) => x.type === "hour")!.value;
    const cand = `${p.find((x) => x.type === "year")!.value}-${p.find((x) => x.type === "month")!.value}-${p.find((x) => x.type === "day")!.value}T${hourPart}:${p.find((x) => x.type === "minute")!.value}:${p.find((x) => x.type === "second")!.value}`;
    if (cand === want) {
      // earliest match: fall back to a finer scan around this point
      for (let fine = -2 * 60 * 1000; fine <= 2 * 60 * 1000; fine += 1000) {
        const exact = new Date(candidate.getTime() + fine);
        const p2 = partsIn(exact, timeZone);
        const h2 = p2.find((x) => x.type === "hour")!.value === "24" ? "00" : p2.find((x) => x.type === "hour")!.value;
        const cand2 = `${p2.find((x) => x.type === "year")!.value}-${p2.find((x) => x.type === "month")!.value}-${p2.find((x) => x.type === "day")!.value}T${h2}:${p2.find((x) => x.type === "minute")!.value}:${p2.find((x) => x.type === "second")!.value}`;
        if (cand2 === want) return exact;
      }
      return candidate;
    }
  }
  return null;
}

/** True when the local time does not exist (spring-forward gap). */
export function isGapLocal(local: string, timeZone: string): boolean {
  return resolveLocal(local, timeZone) === null;
}

export function autoReleaseInstant(jobDate: string, office: Office, closures: Set<string>): Date {
  const releaseDay = previousBusinessDay(jobDate, closures);
  const at = resolveLocal(`${releaseDay}T${String(AUTO_RELEASE_HOUR).padStart(2, "0")}:00:00`, OFFICE_META[office].timeZone);
  if (!at) throw new Error(`No instant for ${releaseDay} in ${office}`);
  return at;
}
