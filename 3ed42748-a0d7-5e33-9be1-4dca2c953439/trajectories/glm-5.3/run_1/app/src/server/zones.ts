// The studio time zone and the board date: the single home of zone acceptance and
// studio wall-time resolution, including skipped and repeated local times.

const ALWAYS_ACCEPTED = new Set([
  "UTC",
  "America/Vancouver",
  "America/St_Johns",
  "Europe/London",
  "Asia/Kolkata",
  "Asia/Kathmandu",
  "Australia/Adelaide",
  "Australia/Eucla",
  "Australia/Lord_Howe",
  "Pacific/Chatham",
]);

const nodeZones = new Set(Intl.supportedValuesOf("timeZone"));

/** Exact, case-sensitive match against the accepted set. */
export function isValidZone(name: unknown): name is string {
  if (typeof name !== "string" || name.length === 0) return false;
  return nodeZones.has(name) || ALWAYS_ACCEPTED.has(name);
}

/** Local wall-clock parts of an instant in the studio zone. */
export function zoneParts(zone: string, ms: number): { year: number; month: number; day: number; hour: number; minute: number; second: number; ms: number } {
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  });
  const parts = dtf.formatToParts(new Date(ms));
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute"), second: get("second"), ms: ms % 1000 };
}

export function zoneOffsetMs(zone: string, ms: number): number {
  const p = zoneParts(zone, ms);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second, p.ms);
  return asUtc - ms;
}

/** The board date for a moment: local date if the local wall clock reads 04:00:00.000 or later, else the previous local date. */
export function boardDate(zone: string, now = Date.now()): string {
  const p = zoneParts(zone, now);
  if (p.hour >= 4) return fmt(p);
  // Before 4am local: the board date is the previous local calendar date. Now is at most
  // four hours past local midnight (offsets are whole minutes), so stepping back hourly
  // reaches it quickly; the first date that differs from today's is the previous one.
  const today = zoneParts(zone, now);
  for (let i = 1; i <= 24; i++) {
    const q = zoneParts(zone, now - i * 3600_000);
    if (q.year !== today.year || q.month !== today.month || q.day !== today.day) return fmt(q);
  }
  return fmt(today);
}

const PAD = (n: number, w = 2) => String(n).padStart(w, "0");
function fmt(p: { year: number; month: number; day: number }): string {
  return `${p.year}-${PAD(p.month)}-${PAD(p.day)}`;
}

/**
 * Resolve a studio wall time `YYYY-MM-DDTHH:MM` to an instant in the zone.
 * - repeated times resolve to the earlier instant (the offset from before the change);
 * - skipped times return null.
 */
export function resolveLocalTime(zone: string, local: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m;
  const guess = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi));
  // Candidate instants: offsets within ±1 day of the naive guess.
  const candidates: number[] = [];
  for (const probe of [guess - 12 * 3600_000, guess, guess + 12 * 3600_000]) {
    const off = zoneOffsetMs(zone, probe);
    candidates.push(guess - off);
  }
  // A candidate is valid when its wall time in the zone equals the requested wall time.
  const valid = candidates.filter((t) => {
    const p = zoneParts(zone, t);
    return p.year === Number(y) && p.month === Number(mo) && p.day === Number(d) && p.hour === Number(h) && p.minute === Number(mi);
  });
  if (valid.length === 0) return null; // the clocks skip this wall time
  return Math.min(...valid); // earlier instant when it happens twice
}

/** Format an instant as studio wall time `YYYY-MM-DD HH:MM`. */
export function formatLocal(zone: string, ms: number): string {
  const p = zoneParts(zone, ms);
  return `${p.year}-${PAD(p.month)}-${PAD(p.day)} ${PAD(p.hour)}:${PAD(p.minute)}`;
}
