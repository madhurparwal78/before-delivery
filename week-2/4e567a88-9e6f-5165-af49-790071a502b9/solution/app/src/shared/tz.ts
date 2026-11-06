// Wall-clock conversions in an IANA zone with Intl only, and the date copy the brief prints.

export const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

interface LocalTime {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(zone: string): Intl.DateTimeFormat {
  let found = formatters.get(zone);
  if (!found) {
    found = new Intl.DateTimeFormat("en-US", {
      timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    formatters.set(zone, found);
  }
  return found;
}

export function isTimeZone(zone: string): boolean {
  try {
    formatter(zone);
    return true;
  } catch {
    return false;
  }
}

/** The wall-clock time in `zone` at the instant `ms`. */
export function localAt(ms: number, zone: string): LocalTime {
  const parts = Object.fromEntries(formatter(zone).formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  return {
    year: Number(parts.year), month: Number(parts.month), day: Number(parts.day),
    hour: Number(parts.hour), minute: Number(parts.minute), second: Number(parts.second),
  };
}

const asUtc = (t: LocalTime): number => Date.UTC(t.year, t.month - 1, t.day, t.hour, t.minute, t.second);

/**
 * The instant at which `zone` shows the wall-clock time `local`. A time skipped by a clock change has no
 * instant (null); a time that occurs twice resolves to its first occurrence.
 */
export function instantOf(local: LocalTime, zone: string): number | null {
  const wall = asUtc(local);
  const offsets = new Set([-86_400_000, 86_400_000].map((shift) => asUtc(localAt(wall + shift, zone)) - (wall + shift)));
  const matches = [...offsets].map((offset) => wall - offset).filter((ms) => asUtc(localAt(ms, zone)) === wall);
  return matches.length ? Math.min(...matches) : null;
}

const pad = (n: number, width = 2): string => String(n).padStart(width, "0");

/** "2026-11-02T09:00:00" */
export function localIso(ms: number, zone: string): string {
  const t = localAt(ms, zone);
  return `${pad(t.year, 4)}-${pad(t.month)}-${pad(t.day)}T${pad(t.hour)}:${pad(t.minute)}:${pad(t.second)}`;
}

/** "2026-11-02 09:00" */
export function localMinutes(ms: number, zone: string): string {
  return localIso(ms, zone).slice(0, 16).replace("T", " ");
}

/** "1 November 2026" */
export function longDate(ms: number, zone: string): string {
  const t = localAt(ms, zone);
  return `${t.day} ${MONTHS[t.month - 1]} ${t.year}`;
}

/** Parses "YYYY-MM-DDTHH:MM:SS" (or with a space); null when the text is not a real calendar time. */
export function parseLocal(text: string): LocalTime | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(text);
  if (!m) return null;
  const t: LocalTime = {
    year: Number(m[1]), month: Number(m[2]), day: Number(m[3]),
    hour: Number(m[4]), minute: Number(m[5]), second: Number(m[6] ?? "0"),
  };
  const check = new Date(asUtc(t));
  const real = check.getUTCFullYear() === t.year && check.getUTCMonth() === t.month - 1 && check.getUTCDate() === t.day;
  return real && t.hour < 24 && t.minute < 60 && t.second < 60 ? t : null;
}
