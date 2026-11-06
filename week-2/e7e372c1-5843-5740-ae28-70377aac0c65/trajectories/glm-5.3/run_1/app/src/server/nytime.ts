// America/New_York offsets for 2026 (the only year this product needs) plus
// the single wall-time-to-instant conversion rule used everywhere.

const EASTERN_OFFSETS_2026 = [
  // [startUtcEpochMs, offsetMinutes]; EST = -300, EDT = -240.
  // DST ends 2026-11-01 02:00 local; DST begins 2027-03-14 02:00 local.
  [0, -240], // EDT until 2026-11-01 06:00 UTC
  [Date.UTC(2026, 10, 1, 6, 0, 0), -300], // EST after fall back
  [Date.UTC(2027, 2, 14, 7, 0, 0), -240], // EDT after spring forward 2027
  [Date.UTC(2027, 10, 7, 6, 0, 0), -300],
  [Date.UTC(2028, 2, 12, 7, 0, 0), -240],
  [Date.UTC(2028, 10, 5, 6, 0, 0), -300],
] as const;

export function offsetMinutesAt(epochMs: number): number {
  let offset = -300;
  for (const [start, minutes] of EASTERN_OFFSETS_2026) {
    if (epochMs >= start) offset = minutes;
  }
  return offset;
}

/** Milliseconds since epoch of a New York wall time (date parts in local terms). */
export function wallTimeToEpochMs(
  year: number,
  month1: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
): number | null {
  const candidate = Date.UTC(year, month1 - 1, day, hour, minute, second);
  const offset = offsetMinutesAt(candidate);
  const firstTry = candidate - offset * 60_000;
  // Fall-back ambiguity: a wall time occurring twice means the earlier instant.
  if (offsetMinutesAt(firstTry) !== offset) {
    const secondTry = candidate - (offset - 60) * 60_000;
    if (offsetMinutesAt(secondTry) === offset) return Math.min(firstTry, secondTry);
  }
  // Spring-forward gap: a wall time that does not exist.
  const checkOffset = offsetMinutesAt(firstTry);
  if (checkOffset !== offset) {
    const alt = candidate - (offset + 60) * 60_000;
    if (offsetMinutesAt(alt) === offset) return null;
    if (offsetMinutesAt(candidate - (offset - 60) * 60_000) === offset) return null;
  }
  return firstTry;
}

export interface NyParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number; // 0 Sunday .. 6 Saturday
  offsetMinutes: number;
}

export function epochMsToNyParts(epochMs: number): NyParts {
  const offset = offsetMinutesAt(epochMs);
  const shifted = epochMs + offset * 60_000;
  const d = new Date(shifted);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    second: d.getUTCSeconds(),
    weekday: d.getUTCDay(),
    offsetMinutes: offset,
  };
}

function pad(n: number, len = 2): string {
  return n.toString().padStart(len, "0");
}

export function nyDateString(epochMs: number): string {
  const p = epochMsToNyParts(epochMs);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

export function nyTimeString(epochMs: number): string {
  const p = epochMsToNyParts(epochMs);
  return `${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`;
}

export function nyWallTimeString(epochMs: number): string {
  return `${nyDateString(epochMs)} ${nyTimeString(epochMs)}`;
}

export function isoString(epochMs: number): string {
  const p = epochMsToNyParts(epochMs);
  const offset = p.offsetMinutes;
  const sign = offset < 0 ? "-" : "+";
  const abs = Math.abs(offset);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

export function parseNyDate(dateStr: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2] ?? "0");
  const day = Number(m[3] ?? "0");
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (year < 2000 || year > 2100) return null;
  const t = wallTimeToEpochMs(year, month, day, 0, 0, 0);
  if (t === null) return null;
  // sanity: date must be a real calendar date
  const parts = epochMsToNyParts(t);
  if (parts.day !== day || parts.month !== month || parts.year !== year) return null;
  return t;
}

export function parseNyWallTime(text: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(text.trim());
  if (!m) return null;
  const t = wallTimeToEpochMs(
    Number(m[1]),
    Number(m[2] ?? "0"),
    Number(m[3] ?? "0"),
    Number(m[4] ?? "0"),
    Number(m[5] ?? "0"),
    Number(m[6] ?? "0"),
  );
  if (t === null) return null;
  return t;
}

export function parseIsoInstant(text: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/.exec(text.trim());
  if (!m) return null;
  let offsetMinutes = 0;
  const zone = m[7] ?? "Z";
  if (zone !== "Z") {
    const sign = zone.startsWith("-") ? -1 : 1;
    const oh = Number(zone.slice(1, 3));
    const om = Number(zone.slice(4, 6));
    if (oh > 14 || om > 59) return null;
    offsetMinutes = sign * (oh * 60 + om);
  }
  const utc = Date.UTC(
    Number(m[1]),
    Number(m[2] ?? "1") - 1,
    Number(m[3] ?? "1"),
    Number(m[4] ?? "0"),
    Number(m[5] ?? "0"),
    Number(m[6] ?? "0"),
  );
  if (Number.isNaN(utc)) return null;
  return utc - offsetMinutes * 60_000;
}

export function unixSeconds(epochMs: number): number {
  return Math.floor(epochMs / 1000);
}

export function fromUnixSeconds(sec: number): number {
  return sec * 1000;
}
