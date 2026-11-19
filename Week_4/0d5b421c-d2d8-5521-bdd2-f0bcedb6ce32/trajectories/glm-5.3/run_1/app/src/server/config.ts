import { SLOT_TIMES } from "../shared/seed.js";

/** Server-only configuration read from the environment. Never sent to the browser. */
export interface Config {
  databaseUrl: string;
  valkeyUrl: string;
  valkeyKeyPrefix: string;
  killbillUrl: string;
  killbillUsername: string;
  killbillPassword: string;
  killbillApiKey: string;
  killbillApiSecret: string;
  smtpHost: string;
  smtpPort: number;
  mailFrom: string;
  holdSeconds: number;
  offerSeconds: number;
  clockControl: boolean;
  publicPort: number;
  publicUrl: string;
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (v === undefined || v === "") {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return v;
}

function intEnv(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export function loadConfig(): Config {
  return {
    databaseUrl: requireEnv("DATABASE_URL"),
    valkeyUrl: requireEnv("VALKEY_URL"),
    valkeyKeyPrefix: process.env.VALKEY_KEY_PREFIX ?? "",
    killbillUrl: requireEnv("KILLBILL_URL"),
    killbillUsername: requireEnv("KILLBILL_USERNAME"),
    killbillPassword: requireEnv("KILLBILL_PASSWORD"),
    killbillApiKey: requireEnv("KILLBILL_API_KEY"),
    killbillApiSecret: requireEnv("KILLBILL_API_SECRET"),
    smtpHost: requireEnv("SMTP_HOST"),
    smtpPort: intEnv("SMTP_PORT", 1025),
    mailFrom: requireEnv("MAIL_FROM"),
    holdSeconds: intEnv("HOLD_SECONDS", 300),
    offerSeconds: intEnv("OFFER_SECONDS", 900),
    clockControl: process.env.APP_CLOCK_CONTROL === "1",
    publicPort: intEnv("APP_PUBLIC_PORT", 4173),
    publicUrl: requireEnv("APP_PUBLIC_URL"),
  };
}

export const MAX_BODY_BYTES = 16_384;

/** Lisbon wall-clock helpers. The restaurant runs on Europe/Lisbon time. */
export const LISBON_TZ = "Europe/Lisbon";

/** Format an instant as a Lisbon date string YYYY-MM-DD. */
export function lisbonDateString(instant: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: LISBON_TZ, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(instant);
}

/** Format an instant as a Lisbon HH:MM string. */
export function lisbonTimeString(instant: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: LISBON_TZ, hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(instant);
}

/** The Lisbon offset in minutes for a given instant. */
function lisbonOffsetMinutes(instant: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: LISBON_TZ, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const parts = dtf.formatToParts(instant);
  const get = (t: string): number => Number(parts.find((p) => p.type === t)?.value ?? "0");
  const asUtc = Date.UTC(
    get("year"), get("month") - 1, get("day"),
    get("hour") % 24, get("minute"), get("second"),
  );
  return Math.round((asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60000);
}

/** Build a Date from a Lisbon date string and HH:MM slot time. */
export function lisbonSlotInstant(date: string, time: string): Date {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  let off = lisbonSlotOffset(new Date(guess));
  let instant = new Date(guess - off * 60000);
  off = lisbonSlotOffset(instant);
  instant = new Date(guess - off * 60000);
  return instant;
}

function lisbonSlotOffset(instant: Date): number {
  return lisbonOffsetMinutes(instant);
}

/** Format an instant as `<Ddd> <D> <Mon>` in Lisbon, e.g. `Fri 14 Nov`. */
export function lisbonDayStamp(instant: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: LISBON_TZ, weekday: "short", day: "numeric", month: "short",
  }).formatToParts(instant);
  const wd = parts.find((p) => p.type === "weekday")?.value ?? "";
  const d = parts.find((p) => p.type === "day")?.value ?? "";
  const mo = parts.find((p) => p.type === "month")?.value ?? "";
  return `${wd} ${d} ${mo}`;
}

/** Slot label of an instant: the quarter-hour slot it falls in, as HH:MM. */
export function slotKey(instant: Date): string {
  const t = lisbonTimeString(instant);
  const [h, m] = t.split(":").map(Number);
  const slot = Math.floor(m / 15) * 15;
  return `${String(h).padStart(2, "0")}:${String(slot).padStart(2, "0")}`;
}

/** The current Lisbon slot kept between 18:00 and 22:00, or null outside service. */
export function currentSlot(now: Date): string | null {
  const t = lisbonTimeString(now);
  if (t < "18:00" || t > "22:00") return null;
  return slotKey(now);
}

/** Today's date in Lisbon. */
export function todayInLisbon(now: Date): string {
  return lisbonDateString(now);
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + days));
  return next.toISOString().slice(0, 10);
}

export function isSlotTime(t: string): boolean {
  return SLOT_TIMES.includes(t);
}

/** Format seconds as M:SS (minutes and zero-padded seconds). */
export function formatCountdown(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

/** Format integer cents as euros with two decimals and a dot. */
export function formatEuro(cents: number): string {
  return (cents / 100).toFixed(2);
}
