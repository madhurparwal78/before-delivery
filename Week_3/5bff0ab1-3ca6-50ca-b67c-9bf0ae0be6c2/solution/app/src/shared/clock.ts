/**
 * The only module that reads a clock or converts to India Standard Time. Instants are epoch milliseconds,
 * IST calendar dates are `YYYY-MM-DD` strings, and no result depends on the zone of the process or the browser.
 */
const IST_OFFSET_MS = 19_800_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const ISO_INSTANT = /^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d(\.\d+)?)?(Z|[+-]\d\d:\d\d)$/;
const ISO_DATE = /^(\d{4})-(\d\d)-(\d\d)$/;

export { HOUR_MS };

/** Real time, for connection stamps, sweeps and timeouts that decide no product time. */
export const realNow = (): number => Date.now();

/** The app clock is a base pair plus a freeze flag, so every copy of the server reads the same time from it. */
type AppClock = { baseRealMs: number; baseAppMs: number; frozen: boolean };
export const appNow = (clock: AppClock, real: number = realNow()): number =>
  clock.frozen ? clock.baseAppMs : clock.baseAppMs + (real - clock.baseRealMs);

type IstParts = {
  date: string;
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number;
};

const two = (n: number): string => String(n).padStart(2, "0");

export function istParts(ms: number): IstParts {
  const d = new Date(ms + IST_OFFSET_MS);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  return {
    date: `${String(year).padStart(4, "0")}-${two(month)}-${two(day)}`,
    year,
    month,
    day,
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    second: d.getUTCSeconds(),
    weekday: d.getUTCDay(),
  };
}

export const istDate = (ms: number): string => istParts(ms).date;

/** Whole days since the epoch for an IST date, or null when it is not a real calendar date. */
function dateNumber(date: string): number | null {
  const m = ISO_DATE.exec(date);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = Date.UTC(y, mo - 1, d);
  const back = new Date(t);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
  return t / DAY_MS;
}

export const isDate = (text: unknown): text is string => typeof text === "string" && dateNumber(text) !== null;

export function addDays(date: string, days: number): string {
  const n = dateNumber(date);
  if (n === null) throw new Error(`not a calendar date: ${date}`);
  const d = new Date((n + days) * DAY_MS);
  return `${String(d.getUTCFullYear()).padStart(4, "0")}-${two(d.getUTCMonth() + 1)}-${two(d.getUTCDate())}`;
}

const daysBetween = (from: string, to: string): number => (dateNumber(to) as number) - (dateNumber(from) as number);

export const weekdayOf = (date: string): number => new Date((dateNumber(date) as number) * DAY_MS).getUTCDay();

/** The instant of a wall-clock time (`HH:mm`) on an IST date. */
export function istInstant(date: string, hhmm: string): number {
  const n = dateNumber(date);
  const [h, m] = hhmm.split(":").map(Number);
  if (n === null || h === undefined || m === undefined) throw new Error(`not an IST time: ${date} ${hhmm}`);
  return n * DAY_MS + h * HOUR_MS + m * 60_000 - IST_OFFSET_MS;
}

export function parseInstant(text: unknown): number | null {
  if (typeof text !== "string" || !ISO_INSTANT.test(text)) return null;
  const ms = Date.parse(text);
  return Number.isNaN(ms) ? null : ms;
}

export function isoIst(ms: number): string {
  const p = istParts(ms);
  const fraction = ((ms % 1000) + 1000) % 1000;
  return `${p.date}T${two(p.hour)}:${two(p.minute)}:${two(p.second)}${fraction ? `.${String(fraction).padStart(3, "0")}` : ""}+05:30`;
}

const clock12 = (hour: number, minute: number): string =>
  `${hour % 12 === 0 ? 12 : hour % 12}:${two(minute)} ${hour < 12 ? "am" : "pm"}`;

/** `6:00 pm` */
export const timeOf = (ms: number): string => {
  const p = istParts(ms);
  return clock12(p.hour, p.minute);
};
/** `11:30` or `1:00`: the cluster's 12-hour digits without the suffix. */
export const clusterTime = (ms: number): string => timeOf(ms).split(" ")[0] as string;
/** `11:30 am IST` */
export const timeLabel = (ms: number): string => `${timeOf(ms)} IST`;
/** `HH:mm` on 24 hours: the booking URL's slot value. */
export const slotKey = (ms: number): string => {
  const p = istParts(ms);
  return `${two(p.hour)}:${two(p.minute)}`;
};

const parts = (date: string) => {
  const m = ISO_DATE.exec(date) as RegExpExecArray;
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
};
/** `30 Oct` */
const dayMonth = (date: string): string => {
  const p = parts(date);
  return `${p.day} ${MONTHS[p.month - 1]}`;
};
/** `Fri 6 Nov` */
export const shortDate = (date: string): string => `${WEEKDAYS[weekdayOf(date)]?.slice(0, 3)} ${dayMonth(date)}`;
/** `30 Oct 2026` */
export const fullDate = (date: string): string => `${dayMonth(date)} ${parts(date).year}`;
export const weekdayName = (date: string): string => WEEKDAYS[weekdayOf(date)] as string;
/** `Today, Wed 28 Oct`, `Tomorrow, Thu 29 Oct` or `Fri 30 Oct` */
export function dayLabel(date: string, todayDate: string): string {
  const offset = daysBetween(todayDate, date);
  if (offset === 0) return `Today, ${shortDate(date)}`;
  if (offset === 1) return `Tomorrow, ${shortDate(date)}`;
  return shortDate(date);
}
/** `30 Oct, 6:00 pm IST` */
export const expiryLabel = (ms: number): string => `${dayMonth(istDate(ms))}, ${timeLabel(ms)}`;
/** The hour of a Garage statement, `6 pm`. */
export const hourOnly = (ms: number): string => {
  const p = istParts(ms);
  return `${p.hour % 12 === 0 ? 12 : p.hour % 12} ${p.hour < 12 ? "am" : "pm"}`;
};
/** The label of a stock reading: dated when it is from an earlier IST date than now. */
export const asOfLabel = (asOfMs: number, nowMs: number): string =>
  istDate(asOfMs) === istDate(nowMs) ? timeLabel(asOfMs) : `${dayMonth(istDate(asOfMs))}, ${timeLabel(asOfMs)}`;

export const wholeHourOf = (ms: number): number => Math.floor((ms + IST_OFFSET_MS) / HOUR_MS);
