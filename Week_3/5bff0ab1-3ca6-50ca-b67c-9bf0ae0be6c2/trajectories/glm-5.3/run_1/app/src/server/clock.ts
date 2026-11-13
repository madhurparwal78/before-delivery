// The app clock and IST conversion, read and worked out in exactly one place.
// The clock starts at 2026-10-28 09:00 IST on a fresh database, runs in real time,
// and only the test surface moves it. IST is a fixed +05:30 offset.
export const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

const IST_START_MS = Date.UTC(2026, 9, 28, 3, 30, 0, 0); // 2026-10-28 09:00 IST

type ClockListener = () => void;

// A wall-clock instant on the app clock, in epoch milliseconds.
let currentClockMs = IST_START_MS;
let frozen = false;
// Bias accumulates the shift applied through the test surface.
let clockBiasMs = 0;

const listeners = new Set<ClockListener>();

export function onAppClock(listener: ClockListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit(): void {
  for (const l of listeners) {
    try {
      l();
    } catch {
      // a listener failure never breaks the clock
    }
  }
}

export function appNowMs(): number {
  if (frozen) return currentClockMs;
  currentClockMs = Date.now() + clockBiasMs;
  return currentClockMs;
}

export function appNow(): Date {
  return new Date(appNowMs());
}

// The test surface moves the clock. Moving backward is allowed; ended things do not come back.
export function setAppClock(atMs: number, freeze: boolean): number {
  clockBiasMs = atMs - Date.now();
  currentClockMs = atMs;
  frozen = freeze;
  if (!freeze) currentClockMs = Date.now() + clockBiasMs;
  emit();
  return currentClockMs;
}

export function unfreezeAppClock(): void {
  frozen = false;
  currentClockMs = Date.now() + clockBiasMs;
}

// The frozen instant, shared through Postgres so every copy agrees on a freeze.
export async function readSharedFreeze(query: (sql: string, args: unknown[]) => Promise<{ rows: { value: string }[] }>): Promise<void> {
  const r = await query(`SELECT value FROM app_state WHERE key = 'clock_frozen_ms'`, []);
  if (r.rows.length === 0 || r.rows[0].value === "") return;
  const frozenMs = Number(r.rows[0].value);
  if (!Number.isFinite(frozenMs)) return;
  currentClockMs = frozenMs;
  frozen = true;
  emit();
}

export function frozenMs(): number | null {
  return frozen ? currentClockMs : null;
}

export function seedClockMs(): number {
  return IST_START_MS;
}

// Every copy shares the app clock through Postgres: each copy syncs from the stored
// bias so a change made through one copy moves the others.
export async function readSharedBias(query: (sql: string, args: unknown[]) => Promise<{ rows: { value: string }[] }>): Promise<void> {
  const r = await query(`SELECT value FROM app_state WHERE key = 'clock_bias_ms'`, []);
  if (r.rows.length === 0) return;
  const bias = Number(r.rows[0].value);
  if (!Number.isFinite(bias) || bias === clockBiasMs) return;
  clockBiasMs = bias;
  if (!frozen) currentClockMs = Date.now() + clockBiasMs;
  emit();
}

export function currentBiasMs(): number {
  return clockBiasMs;
}

// ---------- IST conversion ----------

export interface IstParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
  ms: number;
  weekday: number; // 0 Sunday
}

export function toIst(ms: number): IstParts {
  const shifted = ms + IST_OFFSET_MS;
  return {
    year: new Date(shifted).getUTCFullYear(),
    month: new Date(shifted).getUTCMonth() + 1,
    day: new Date(shifted).getUTCDate(),
    hour: new Date(shifted).getUTCHours(),
    minute: new Date(shifted).getUTCMinutes(),
    second: new Date(shifted).getUTCSeconds(),
    ms: new Date(shifted).getUTCMilliseconds(),
    weekday: new Date(shifted).getUTCDay(),
  };
}

export function istPartsToDate(p: IstParts): Date {
  return new Date(
    Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second, p.ms) - IST_OFFSET_MS
  );
}

// The IST calendar date of an instant, as YYYY-MM-DD.
export function istDateOf(ms: number): string {
  const p = toIst(ms);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

// Midnight 00:00:00 IST of a given IST calendar date, as epoch ms.
export function istStartOfDay(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  return Date.UTC(y, m - 1, d) - IST_OFFSET_MS;
}

export function istEndOfDay(dateStr: string): number {
  return istStartOfDay(dateStr) + 24 * 60 * 60 * 1000;
}

// Add n calendar days to an IST date string.
export function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return toDateString(new Date(Date.UTC(y, m - 1, d + n)));
}

export function toDateString(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

export function isValidDateString(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

// The IST date n calendar days after another IST date.
// Days from date a to date b: positive when b is after a.
export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}

// ---------- formatting, server-made, always in IST ----------

const WEEKDAYS_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const WEEKDAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

// `{h:mm am/pm} IST` -> e.g. 6:00 pm IST
export function formatIstTime(ms: number): string {
  const p = toIst(ms);
  return `${hour12(p.hour)}:${pad2(p.minute)} ${amPm(p.hour)} IST`;
}

// `{h am/pm}` -> e.g. 6 pm
export function formatIstHour(ms: number): string {
  const p = toIst(ms);
  return `${hour12(p.hour)} ${amPm(p.hour)}`;
}

// `{d Mon}` -> e.g. 30 Oct
export function formatDayMonth(ms: number): string {
  const p = toIst(ms);
  return `${p.day} ${MONTHS_SHORT[p.month - 1]}`;
}

// `{Ddd d Mon}` -> e.g. Fri 6 Nov
export function formatDddDMon(ms: number): string {
  const p = toIst(ms);
  return `${WEEKDAYS_SHORT[p.weekday]} ${p.day} ${MONTHS_SHORT[p.month - 1]}`;
}

// `{Weekday}` full IST day name
export function formatWeekday(ms: number): string {
  return WEEKDAYS_FULL[toIst(ms).weekday];
}

// `{d Mon YYYY}` -> e.g. 30 Oct 2026
export function formatDMonY(ms: number): string {
  const p = toIst(ms);
  return `${p.day} ${MONTHS_SHORT[p.month - 1]} ${p.year}`;
}

// `30 Oct, 6:00 pm IST`
export function formatExpiresLabel(ms: number): string {
  return `${formatDayMonth(ms)}, ${formatIstTime(ms)}`;
}

// 12-hour slot label -> e.g. `11:30 am IST`
export function formatSlotLabel(ms: number): string {
  const p = toIst(ms);
  return `${hour12(p.hour)}:${pad2(p.minute)} ${amPm(p.hour)} IST`;
}

// RIDE display uses 12-hour IST digits without the suffix -> e.g. `11:30`
export function formatRideDisplay(ms: number): string {
  const p = toIst(ms);
  return `${hour12(p.hour)}:${pad2(p.minute)}`;
}

// 24-hour IST HH:mm with leading zero -> e.g. `11:30`, used in URLs and ledger keys.
export function formatSlotHHmm(ms: number): string {
  const p = toIst(ms);
  return `${pad2(p.hour)}:${pad2(p.minute)}`;
}

// Server-given day label -> e.g. `Today, Wed 28 Oct`
export function dayLabel(dateStr: string, todayStr: string): string {
  const diff = daysBetween(todayStr, dateStr);
  const ms = istStartOfDay(dateStr);
  if (diff === 0) return `Today, ${WEEKDAYS_SHORT[toIst(ms).weekday]} ${toIst(ms).day} ${MONTHS_SHORT[toIst(ms).month - 1]}`;
  if (diff === 1) return `Tomorrow, ${WEEKDAYS_SHORT[toIst(ms).weekday]} ${toIst(ms).day} ${MONTHS_SHORT[toIst(ms).month - 1]}`;
  return formatDddDMon(ms);
}

function hour12(h: number): number {
  if (h === 0) return 12;
  return h > 12 ? h - 12 : h;
}

function amPm(h: number): "am" | "pm" {
  return h < 12 ? "am" : "pm";
}

// `{h:mm am/pm}` without the IST suffix, as placeholders use -> e.g. `6:00 pm`
export function formatClockTime(ms: number): string {
  const p = toIst(ms);
  return `${hour12(p.hour)}:${pad2(p.minute)} ${amPm(p.hour)}`;
}

// stockAsOfLabel: `{h:mm am/pm} IST` when the reading is from today's IST date,
// `{d Mon}, {h:mm am/pm} IST` when from an earlier IST date.
export function formatStockLabel(ms: number, nowMs: number): string {
  const today = istDateOf(nowMs);
  const thatDay = istDateOf(ms);
  if (daysBetween(thatDay, today) <= 0) {
    // same date (or future, which never happens) -> time only
    return formatIstTime(ms);
  }
  return `${formatDayMonth(ms)}, ${formatIstTime(ms)}`;
}

// ISO 8601 with the +05:30 offset.
export function toIsoIst(ms: number): string {
  const shifted = new Date(ms + IST_OFFSET_MS);
  return (
    `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}` +
    `T${pad2(shifted.getUTCHours())}:${pad2(shifted.getUTCMinutes())}:${pad2(shifted.getUTCSeconds())}+05:30`
  );
}

// Accepts an ISO 8601 time and returns epoch ms, honouring any offset it names.
// Fields are validated against a calendar round-trip.
export function parseIsoTime(s: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(?:Z|([+-])(\d{2}):?(\d{2}))?$/.exec(s);
  if (!m) return null;
  const [, y, mo, d, h, mi, se, sign, oh, om] = m;
  if (Number(h) > 23 || Number(mi) > 59 || Number(se ?? 0) > 59) return null;
  // Validate the calendar date on its own fields.
  const dateCheck = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  if (dateCheck.getUTCFullYear() !== Number(y) || dateCheck.getUTCMonth() !== Number(mo) - 1 || dateCheck.getUTCDate() !== Number(d)) {
    return null;
  }
  let utcMs = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(se ?? 0));
  if (sign === "+" || sign === "-") {
    const offsetMs = (Number(oh) * 60 + Number(om)) * 60000;
    utcMs += sign === "+" ? -offsetMs : offsetMs;
  }
  return utcMs;
}

