// Business time and screen formats, shared by the server (mail, refusal copy) and the screens.
// Every instant is shown in the workspace's business time zone, whatever the browser's own zone is.

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

interface ZoneParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let found = formatters.get(timeZone);
  if (!found) {
    found = new Intl.DateTimeFormat("en-US", {
      timeZone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric",
      hour: "numeric", minute: "numeric", second: "numeric",
    });
    formatters.set(timeZone, found);
  }
  return found;
}

function zoneParts(timeZone: string, instantMs: number): ZoneParts {
  const out: Record<string, number> = {};
  for (const part of formatter(timeZone).formatToParts(new Date(instantMs))) {
    if (part.type !== "literal") out[part.type] = parseInt(part.value, 10);
  }
  return { year: out.year, month: out.month, day: out.day, hour: out.hour % 24, minute: out.minute, second: out.second };
}

function offsetMs(timeZone: string, instantMs: number): number {
  const p = zoneParts(timeZone, instantMs);
  const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return wall - (instantMs - (((instantMs % 1000) + 1000) % 1000));
}

/** The UTC instant of a wall-clock time in a zone (00:00 business time on a date, for example). */
export function zonedInstant(timeZone: string, ymd: string, hour = 0, minute = 0): number {
  const [y, m, d] = ymd.split("-").map((x) => parseInt(x, 10));
  const wall = Date.UTC(y, m - 1, d, hour, minute);
  const first = wall - offsetMs(timeZone, wall);
  const second = wall - offsetMs(timeZone, first);
  return second;
}

const pad = (n: number, width = 2): string => String(n).padStart(width, "0");

export function businessDate(timeZone: string, instantMs: number): string {
  const p = zoneParts(timeZone, instantMs);
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}`;
}

export function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map((x) => parseInt(x, 10));
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${pad(t.getUTCFullYear(), 4)}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

export function shiftMonth(ym: string, months: number): string {
  const [y, m] = ym.split("-").map((x) => parseInt(x, 10));
  const index = y * 12 + (m - 1) + months;
  return `${pad(Math.floor(index / 12), 4)}-${pad((index % 12) + 1)}`;
}

/** An instant cut to whole seconds, as every recorded event instant is. */
export function stamp(instantMs: number): Date {
  return new Date(Math.floor(instantMs / 1000) * 1000);
}

/** Whole seconds from now until an instant, never below zero. */
export function secondsUntil(instant: Date, nowMs: number): number {
  return Math.max(0, Math.floor(instant.getTime() / 1000) - Math.floor(nowMs / 1000));
}

/** `2027-04-06T08:00:00Z`: whole seconds, UTC, never milliseconds. */
export function isoInstant(instantMs: number): string {
  return new Date(Math.floor(instantMs / 1000) * 1000).toISOString().replace(".000Z", "Z");
}

/** `Tue 6 Apr 2027, 11:00 Vilnius time` */
export function formatDateTime(instant: string | number, timeZone: string, city: string): string {
  const ms = typeof instant === "number" ? instant : Date.parse(instant);
  const p = zoneParts(timeZone, ms);
  const weekday = WEEKDAYS[new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay()];
  return `${weekday} ${p.day} ${MONTHS_SHORT[p.month - 1]} ${p.year}, ${pad(p.hour)}:${pad(p.minute)} ${city}`;
}

/** `6 Apr 2027` from a business date. */
export function formatDate(ymd: string): string {
  const [y, m, d] = ymd.split("-").map((x) => parseInt(x, 10));
  return `${d} ${MONTHS_SHORT[m - 1]} ${y}`;
}

/** `September 2026` from a business month. */
export function formatMonth(ym: string): string {
  const [y, m] = ym.split("-").map((x) => parseInt(x, 10));
  return `${MONTHS_LONG[m - 1]} ${y}`;
}

/** `EUR 1,000.01`: integer cents, never floating point. */
export function formatMoney(currency: string, value: bigint): string {
  const sign = value < 0n ? "-" : "";
  const abs = value < 0n ? -value : value;
  const whole = (abs / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${currency} ${sign}${whole}.${(abs % 100n).toString().padStart(2, "0")}`;
}

/** `1000.01`: the regulator's file form of integer cents. */
export function plainMoney(value: bigint): string {
  return `${value / 100n}.${(value % 100n).toString().padStart(2, "0")}`;
}

/** `ETH 1.000000000000000001`, `BTC 0.5`: the exact amount without trailing zeros. */
export function formatCrypto(asset: string, amount: string): string {
  const trimmed = amount.includes(".") ? amount.replace(/0+$/, "").replace(/\.$/, "") : amount;
  return `${asset} ${trimmed}`;
}

/** `H:MM:SS` from whole seconds. */
export function formatCountdown(seconds: number): string {
  const s = Math.max(0, seconds);
  return `${Math.floor(s / 3600)}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

/** `lnl1ha…0001`: the first 6 and last 4 characters. */
export function maskAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/** `1 message`, `3 messages`. */
export function plural(n: number | bigint, one: string, many: string): string {
  return `${n} ${BigInt(n) === 1n ? one : many}`;
}
