/** Time zone helpers using Intl. Server and browser share these. */

export interface ZoneParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  millis: number;
}

const OFFSET_CACHE = new Map<string, { [minute: number]: number }>();
const ZONE_CHECK = new Map<string, boolean>();

export function isValidTimeZone(zone: string): boolean {
  const cached = ZONE_CHECK.get(zone);
  if (cached !== undefined) return cached;
  let ok = false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    ok = true;
  } catch {
    ok = false;
  }
  ZONE_CHECK.set(zone, ok);
  return ok;
}

/** Offset minutes east of UTC for `zone` at instant `ms`. */
export function zoneOffsetMs(zone: string, ms: number): number {
  const minute = Math.floor(ms / 60000);
  const byZone = OFFSET_CACHE.get(zone);
  if (byZone) {
    const hit = byZone[minute];
    if (hit !== undefined) return hit;
  }
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(new Date(ms));
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? "0";
  const asUTC = Date.UTC(
    Number(get("year")),
    Number(get("month")) - 1,
    Number(get("day")),
    Number(get("hour")) % 24,
    Number(get("minute")),
    Number(get("second")),
  );
  const offset = asUTC - Math.floor(ms / 1000) * 1000;
  const store = OFFSET_CACHE.get(zone) ?? {};
  store[minute] = offset;
  OFFSET_CACHE.set(zone, store);
  return offset;
}

export function offsetLabel(offsetMs: number): string {
  const sign = offsetMs < 0 ? "-" : "+";
  const abs = Math.abs(offsetMs);
  const h = Math.floor(abs / 3600000);
  const m = Math.floor((abs % 3600000) / 60000);
  return `${sign}${pad2(h)}:${pad2(m)}`;
}

function pad2(n: number): string {
  return n < 10 ? "0" + n : String(n);
}

export function localParts(zone: string, ms: number): ZoneParts {
  const offset = zoneOffsetMs(zone, ms);
  const d = new Date(ms + offset);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    second: d.getUTCSeconds(),
    millis: d.getUTCMilliseconds(),
  };
}

/** Display time: YYYY-MM-DD HH:MM:SS +HH:MM in the viewer's zone. */
export function formatInZone(zone: string, ms: number): string {
  const p = localParts(zone, ms);
  const offset = zoneOffsetMs(zone, ms);
  return (
    `${pad4(p.year)}-${pad2(p.month)}-${pad2(p.day)} ` +
    `${pad2(p.hour)}:${pad2(p.minute)}:${pad2(p.second)} ${offsetLabel(offset)}`
  );
}

function pad4(n: number): string {
  let s = String(n);
  while (s.length < 4) s = "0" + s;
  return s;
}

/** Parse YYYY-MM-DD HH:MM:SS as wall time in `zone`. Ambiguous times take the earlier instant. */
export function parseWallTime(zone: string, text: string): { ok: boolean; ms?: number; exists?: boolean } {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(text.trim());
  if (!m) return { ok: false };
  const [, y, mo, d, h, mi, s] = m;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  const hour = Number(h);
  const minute = Number(mi);
  const second = Number(s);
  const naive = Date.UTC(year, month - 1, day, hour, minute, second);
  // Candidate offsets around the wall time, resolved by iterating candidate offsets.
  const candidates: number[] = [];
  const dayStart = naive - 26 * 3600000;
  for (let t = dayStart; t <= naive + 26 * 3600000; t += 15 * 60000) {
    const off = zoneOffsetMs(zone, t);
    if (!candidates.includes(off)) candidates.push(off);
  }
  const results: number[] = [];
  for (const off of candidates) {
    const ms = naive - off;
    const parts = localParts(zone, ms);
    if (
      parts.year === year && parts.month === month && parts.day === day &&
      parts.hour === hour && parts.minute === minute && parts.second === second
    ) {
      results.push(ms);
    }
  }
  if (results.length === 0) return { ok: true, exists: false };
  results.sort((a, b) => a - b);
  return { ok: true, ms: results[0], exists: true };
}

/** Local midnight (00:00) of the UTC day holding `ms`, in `zone`, as a UTC instant. */
export function localMidnightOf(zone: string, ms: number): number {
  const p = localParts(zone, ms);
  return parseWallTime(zone, `${pad4(p.year)}-${pad2(p.month)}-${pad2(p.day)} 00:00:00`).ms ?? ms;
}
