// Time zone helpers built on the Intl API (full-ICU Node).
// All conversions are explicit; no reliance on the host local time.

export const TZ = (process.env.BUSINESS_TIME_ZONE) || 'Europe/Berlin';

/** Milliseconds per day. */
export const DAY_MS = 86_400_000;

/** Date-parts (UTC-safe after conversion by partsOf). */
export interface Parts {
  y: number; mo: number; d: number; h: number; mi: number; s: number; ms: number;
  weekday: number; // 0 = Monday
}

const cache = new Map<string, Intl.DateTimeFormat>();

function fmt(tz: string): Intl.DateTimeFormat {
  let f = cache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      weekday: 'short',
    });
    cache.set(tz, f);
  }
  return f;
}

const WEEKDAYS: Record<string, number> = {
  Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6,
};

/** Convert an epoch-ms instant into zone calendar parts. */
export function partsOf(epochMs: number, tz = TZ): Parts {
  const f = fmt(tz);
  const out: Record<string, string> = {};
  for (const p of f.formatToParts(new Date(epochMs))) out[p.type] = p.value;
  const h = Number(out.hour) % 24; // 24 -> 0
  return {
    y: Number(out.year), mo: Number(out.month), d: Number(out.day),
    h, mi: Number(out.minute), s: Number(out.second), ms: 0,
    weekday: WEEKDAYS[out.weekday] ?? 0,
  };
}

/** Civil date-time in a zone, as epoch ms (UTC instant of that wall time). */
export function civilToEpoch(y: number, mo: number, d: number,
  h = 0, mi = 0, s = 0, tz = TZ): number {
  // Iterative: start from an approximate instant, correct by offset.
  let guess = Date.UTC(y, mo - 1, d, h, mi, s);
  for (let i = 0; i < 3; i++) {
    const p = partsOf(guess, tz);
    const asUTC = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s);
    const diff = Date.UTC(y, mo - 1, d, h, mi, s) - asUTC;
    if (diff === 0) break;
    guess += diff;
  }
  return guess;
}

/** Offset (ms) of a zone at an instant. */
export function offsetOf(epochMs: number, tz = TZ): number {
  const p = partsOf(epochMs, tz);
  const asUTC = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s);
  return asUTC - epochMs - p.ms;
}

/** Add days to a civil date in a zone, keeping wall time. */
export function addDays(epochMs: number, days: number, tz = TZ): number {
  const p = partsOf(epochMs, tz);
  return civilToEpoch(p.y, p.mo, p.d + days, p.h, p.mi, p.s, tz);
}

/** Midnight (00:00) of the day containing epochMs, in a zone. */
export function startOfDay(epochMs: number, tz = TZ): number {
  const p = partsOf(epochMs, tz);
  return civilToEpoch(p.y, p.mo, p.d, 0, 0, 0, tz);
}

/** Start of the ISO week (Monday 00:00) containing epochMs. */
export function startOfWeek(epochMs: number, tz = TZ): number {
  const p = partsOf(epochMs, tz);
  return addDays(civilToEpoch(p.y, p.mo, p.d, 0, 0, 0, tz), -p.weekday, tz);
}

/** Civil date string YYYY-MM-DD in a zone. */
export function dateStr(epochMs: number, tz = TZ): string {
  const p = partsOf(epochMs, tz);
  return `${p.y}-${String(p.mo).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}

/** Format epoch ms as YYYY-MM-DD HH:mm in a zone. */
export function fmtStamp(epochMs: number, tz = TZ): string {
  const p = partsOf(epochMs, tz);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${p.y}-${pad(p.mo)}-${pad(p.d)} ${pad(p.h)}:${pad(p.mi)}`;
}

/** Whole days between two civil dates in a zone (b - a). */
export function diffDays(aEpoch: number, bEpoch: number, tz = TZ): number {
  const a = startOfDay(aEpoch, tz);
  const b = startOfDay(bEpoch, tz);
  return Math.round((b - a) / DAY_MS);
}
