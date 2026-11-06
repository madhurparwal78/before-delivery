// Business clock: everything is reckoned in Asia/Kolkata from one clock.

const IST_OFFSET_MIN = 330; // +05:30

let epochBaseMs: number | null = null; // real ms when the server started
let baseClockMs: number | null = null; // business ms at server start
let rate = 1;

export function initClock(start?: string, r?: number): void {
  rate = Math.max(1, Math.min(3600, Math.max(1, Math.floor(r ?? 1))));
  if (start) {
    const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})$/.exec(start.trim());
    if (m) {
      const asUTC = Date.UTC(
        Number(m[1]), Number(m[2]) - 1, Number(m[3]),
        Number(m[4]), Number(m[5]), Number(m[6]),
      );
      baseClockMs = asUTC - IST_OFFSET_MIN * 60_000;
      epochBaseMs = Date.now();
      return;
    }
  }
  baseClockMs = null;
  epochBaseMs = null;
}

export function clockRate(): number { return rate; }

/** Current business time in real-epoch milliseconds (as if it were UTC). */
export function nowMs(): number {
  const real = Date.now();
  if (baseClockMs !== null && epochBaseMs !== null) {
    return baseClockMs + (real - epochBaseMs) * rate;
  }
  return real;
}

export interface IstTime { y: number; mo: number; d: number; h: number; mi: number; s: number; ms: number }

export function toIst(ms: number): IstTime {
  const t = new Date(ms + IST_OFFSET_MIN * 60_000);
  return {
    y: t.getUTCFullYear(), mo: t.getUTCMonth() + 1, d: t.getUTCDate(),
    h: t.getUTCHours(), mi: t.getUTCMinutes(), s: t.getUTCSeconds(), ms: t.getUTCMilliseconds(),
  };
}

export function fromIst(y: number, mo: number, d: number, h: number, mi: number, s: number): number {
  return Date.UTC(y, mo - 1, d, h, mi, s) - IST_OFFSET_MIN * 60_000;
}

const p2 = (n: number) => String(n).padStart(2, '0');

/** ISO 8601 with seconds and the +05:30 offset. */
export function istStamp(ms: number): string {
  const t = toIst(ms);
  return `${t.y}-${p2(t.mo)}-${p2(t.d)}T${p2(t.h)}:${p2(t.mi)}:${p2(t.s)}+05:30`;
}

/** IST calendar date as YYYY-MM-DD. */
export function istDate(ms: number): string {
  const t = toIst(ms);
  return `${t.y}-${p2(t.mo)}-${p2(t.d)}`;
}

/** IST clock time as HH:MM. */
export function istHHMM(ms: number): string {
  const t = toIst(ms);
  return `${p2(t.h)}:${p2(t.mi)}`;
}

export function istHHMMSS(ms: number): string {
  const t = toIst(ms);
  return `${p2(t.h)}:${p2(t.mi)}:${p2(t.s)}`;
}

/** Parse an IST timestamp of the exact form YYYY-MM-DDTHH:MM:SS+05:30. */
export function parseStamp(s: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\+05:30$/.exec(s);
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return fromIst(y, mo, d, Number(m[4]), Number(m[5]), Number(m[6]));
}

/** IST date of the form YYYY-MM-DD to epoch ms at 00:00 IST; null if invalid. */
export function parseIstDate(s: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo)) return null;
  return fromIst(y, mo, d, 0, 0, 0);
}

export function daysInMonth(y: number, mo: number): number {
  return new Date(Date.UTC(y, mo, 0)).getUTCDate();
}

/** IST weekday+date, e.g. `Wed 2 Dec 2026`. */
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function istDateWords(ms: number): string {
  const t = toIst(ms);
  const wd = new Date(Date.UTC(t.y, t.mo - 1, t.d)).getUTCDay();
  return `${WD[wd]} ${t.d} ${MON[t.mo - 1]} ${t.y}`;
}

/** Uppercase label date, e.g. `02 DEC 2026`. */
export function istLabelDate(ms: number): string {
  const t = toIst(ms);
  return `${p2(t.d)} ${MON[t.mo - 1].toUpperCase()} ${t.y}`;
}

export function addDays(ms: number, days: number): number {
  return ms + days * 86_400_000;
}

export function startOfIstDay(ms: number): number {
  const t = toIst(ms);
  return fromIst(t.y, t.mo, t.d, 0, 0, 0);
}
