// Festival time rules: Europe/Brussels wall time, the 05:00–05:00 festival day,
// and the autumn clock change. Instants are Date ms; wall strings are "YYYY-MM-DDTHH:MM".

const BRUSSELS = "Europe/Brussels";

export interface WallParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
}

function brusselsFormatter(): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: BRUSSELS,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

let partsCache: Intl.DateTimeFormat | null = null;
export function wallParts(at: Date): WallParts {
  partsCache ??= brusselsFormatter();
  const p = partsCache.formatToParts(at);
  const get = (t: string): number => Number(p.find((x) => x.type === t)?.value ?? "0");
  let hour = get("hour");
  if (hour === 24) hour = 0;
  return { year: get("year"), month: get("month"), day: get("day"), hour, minute: get("minute") };
}

export function pad(n: number, w = 2): string {
  return String(n).padStart(w, "0");
}

export function wallString(at: Date): string {
  const p = wallParts(at);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

export function offsetMinutes(at: Date, timeZone = BRUSSELS): number {
  const p = wallParts(at);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  const guess = Math.round((asUtc - at.getTime()) / 60000);
  // Round to the nearest legal offset (multiples of 15 minutes).
  return Math.round(guess / 15) * 15;
}

export function instantFromWall(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  offsetMin: number,
): Date {
  return new Date(Date.UTC(year, month - 1, day, hour, minute) - offsetMin * 60000);
}

// Offsets (minutes) Brussels uses on the given wall date. DST changes only on the
// change dates themselves, so a plain date has one offset and a change date two.
export function legalOffsets(year: number, month: number, day: number): number[] {
  const early = offsetForWall(year, month, day, 0, 30);
  const late = offsetForWall(year, month, day, 23, 30);
  const set = new Set<number>([...early, ...late]);
  return [...set].sort((a, b) => b - a);
}

function sameWall(a: WallParts, year: number, month: number, day: number, hour: number, minute: number): boolean {
  return a.year === year && a.month === month && a.day === day && a.hour === hour && a.minute === minute;
}

// Offsets at which the given wall time exists: [+120] summer, [+60] winter, both
// during the repeated hour, none in the spring gap.
export function offsetForWall(year: number, month: number, day: number, hour: number, minute: number): number[] {
  const out: number[] = [];
  for (const cand of [120, 60]) {
    const at = instantFromWall(year, month, day, hour, minute, cand);
    if (sameWall(wallParts(at), year, month, day, hour, minute)) out.push(cand);
  }
  return out;
}

export type WallParseResult =
  | { ok: true; at: Date; offsetMin: number }
  | { ok: false; code: "invalid" | "offset_mismatch" | "nonexistent_local_time" };

// A wall time without an offset resolves to the first (summer-time) occurrence when it falls
// in the repeated hour of the autumn change. An explicit offset is honoured when Brussels
// uses it at that wall time.
export function parseWall(value: string | undefined | null): WallParseResult {
  if (typeof value !== "string") return { ok: false, code: "invalid" };
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(Z|[+-]\d{2}:\d{2})?$/.exec(value);
  if (!m) return { ok: false, code: "invalid" };
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) {
    return { ok: false, code: "invalid" };
  }
  const candidates = offsetForWall(year, month, day, hour, minute);
  if (m[6] === undefined) {
    if (candidates.length === 0) return { ok: false, code: "nonexistent_local_time" };
    // First occurrence: the largest offset is the earlier instant.
    return { ok: true, at: instantFromWall(year, month, day, hour, minute, candidates[0]), offsetMin: candidates[0] };
  }
  if (candidates.length === 0) return { ok: false, code: "nonexistent_local_time" };
  const offMin = m[6] === "Z" ? 0 : Number(m[6].slice(1, 3)) * 60 + Number(m[6].slice(4, 6));
  const signed = m[6][0] === "-" ? -offMin : offMin;
  if (!candidates.includes(signed)) return { ok: false, code: "offset_mismatch" };
  return { ok: true, at: instantFromWall(year, month, day, hour, minute, signed), offsetMin: signed };
}

// A festival day runs from 05:00 on D to 05:00 on D+1, Brussels time.
export function festivalDayOf(at: Date): string {
  const p = wallParts(at);
  if (p.hour >= 5) return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
  const prev = new Date(Date.UTC(p.year, p.month - 1, p.day) - 86400000);
  return `${prev.getUTCFullYear()}-${pad(prev.getUTCMonth() + 1)}-${pad(prev.getUTCDate())}`;
}

export function festivalDayStart(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  const candidates = offsetForWall(y, m, d, 5, 0);
  return instantFromWall(y, m, d, 5, 0, candidates[0] ?? 120);
}

export function festivalDayEnd(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d) + 86400000);
  const ny = next.getUTCFullYear();
  const nm = next.getUTCMonth() + 1;
  const nd = next.getUTCDate();
  const candidates = offsetForWall(ny, nm, nd, 5, 0);
  return instantFromWall(ny, nm, nd, 5, 0, candidates[0] ?? 120);
}

export function dayLabel(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const at = instantFromWall(y, m, d, 12, 0, 60);
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: BRUSSELS,
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  return fmt.format(at);
}

export function formatDate(day: string): string {
  const parts = day.split("-").map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return day;
  const [y, m, d] = parts;
  const at = instantFromWall(y, m, d, 12, 0, 60);
  return new Intl.DateTimeFormat("en-GB", { timeZone: BRUSSELS, day: "numeric", month: "short", year: "numeric" }).format(at);
}

// Brussels wall time "HH:MM" for an instant, with " CEST"/" CET" inside a repeated hour.
export function formatClock(at: Date, markRepeated = false): string {
  const p = wallParts(at);
  const off = offsetMinutes(at);
  let s = `${pad(p.hour)}:${pad(p.minute)}`;
  if (markRepeated && p.hour === 2 && off === 120) s += " CEST";
  if (markRepeated && p.hour === 2 && off === 60) s += " CET";
  return s;
}

export function deadlineFormat(at: Date): string {
  const p = wallParts(at);
  const wd = new Intl.DateTimeFormat("en-GB", { timeZone: BRUSSELS, weekday: "short" }).format(at);
  const mon = new Intl.DateTimeFormat("en-GB", { timeZone: BRUSSELS, month: "short" }).format(at);
  return `${wd} ${p.day} ${mon}, ${pad(p.hour)}:${pad(p.minute)}`;
}

export function sessionClock(at: Date): string {
  const p = wallParts(at);
  const wd = new Intl.DateTimeFormat("en-GB", { timeZone: BRUSSELS, weekday: "short" }).format(at);
  const mon = new Intl.DateTimeFormat("en-GB", { timeZone: BRUSSELS, month: "short" }).format(at);
  return `${wd} ${p.day} ${mon} · ${pad(p.hour)}:${pad(p.minute)}`;
}

export function localIso(at: Date): string {
  const p = wallParts(at);
  const off = offsetMinutes(at);
  const sign = off < 0 ? "-" : "+";
  const a = Math.abs(off);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:00${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

export function utcIso(at: Date): string {
  return at.toISOString().replace(/\.\d{3}Z$/, "Z");
}
