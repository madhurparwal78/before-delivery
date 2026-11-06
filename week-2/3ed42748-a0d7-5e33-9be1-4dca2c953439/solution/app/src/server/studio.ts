// Studio time: the accepted zone set, the board date and studio wall-time resolution,
// including times the clocks skip or repeat.
import { one, type Db } from "./db";

const ALWAYS_ACCEPTED = [
  "UTC",
  "America/Vancouver",
  "America/St_Johns",
  "Europe/London",
  "Asia/Kolkata",
  "Asia/Kathmandu",
  "Australia/Adelaide",
  "Australia/Eucla",
  "Australia/Lord_Howe",
  "Pacific/Chatham",
];

export const ACCEPTED_ZONES: readonly string[] = [
  ...new Set([...Intl.supportedValuesOf("timeZone"), ...ALWAYS_ACCEPTED]),
].sort();
const accepted = new Set(ACCEPTED_ZONES);

export const isAcceptedZone = (value: unknown): value is string => typeof value === "string" && accepted.has(value);

export async function studioZone(db: Db): Promise<string> {
  const row = await one<{ time_zone: string }>(db, "SELECT time_zone FROM app_settings WHERE id = 1");
  return row!.time_zone;
}

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function wallClock(at: number, zone: string): WallClock & { second: number } {
  let f = formatters.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(zone, f);
  }
  const parts = Object.fromEntries(f.formatToParts(new Date(at)).map((p) => [p.type, p.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

/** Offset of the zone from UTC at an instant, in milliseconds (local = utc + offset). */
function offsetAt(at: number, zone: string): number {
  const w = wallClock(at, zone);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return asUtc - Math.floor(at / 1000) * 1000;
}

const pad = (n: number, width = 2): string => String(n).padStart(width, "0");

/** The board date: the local date, or the previous one before 04:00 local wall-clock time. */
export function boardDate(at: number, zone: string): string {
  const w = wallClock(at, zone);
  const day = new Date(Date.UTC(w.year, w.month - 1, w.day));
  if (w.hour < 4) day.setUTCDate(day.getUTCDate() - 1);
  return `${day.getUTCFullYear()}-${pad(day.getUTCMonth() + 1)}-${pad(day.getUTCDate())}`;
}

type WallResolution = { ok: true; at: number } | { ok: false; reason: "invalid" | "nonexistent_time" };

/** Resolves a studio wall time "YYYY-MM-DDTHH:MM"; repeated times take the earlier instant. */
export function resolveWallTime(text: string, zone: string): WallResolution {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(text);
  if (!m) return { ok: false, reason: "invalid" };
  const want: WallClock = { year: +m[1]!, month: +m[2]!, day: +m[3]!, hour: +m[4]!, minute: +m[5]! };
  const naive = Date.UTC(want.year, want.month - 1, want.day, want.hour, want.minute);
  const check = new Date(naive);
  if (
    want.hour > 23 ||
    want.minute > 59 ||
    check.getUTCFullYear() !== want.year ||
    check.getUTCMonth() !== want.month - 1 ||
    check.getUTCDate() !== want.day
  )
    return { ok: false, reason: "invalid" };
  const DAY = 86_400_000;
  const offsets = new Set([offsetAt(naive - DAY, zone), offsetAt(naive, zone), offsetAt(naive + DAY, zone)]);
  const matches = [...offsets]
    .map((offset) => naive - offset)
    .filter((at) => {
      const w = wallClock(at, zone);
      return (
        w.year === want.year && w.month === want.month && w.day === want.day && w.hour === want.hour && w.minute === want.minute
      );
    });
  if (!matches.length) return { ok: false, reason: "nonexistent_time" };
  return { ok: true, at: Math.min(...matches) };
}
