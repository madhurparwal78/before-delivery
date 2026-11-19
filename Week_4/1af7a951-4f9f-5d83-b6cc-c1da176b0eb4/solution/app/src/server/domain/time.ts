import { IANA_REGION_ZONES } from "./zones.js";

// Night keys, capture windows and wake alarms, decided from the server clock only.

export const NIGHTS = 28;
export const TECHNIQUE_NIGHT = 8;
const CAPTURE_WINDOW_CLOSES = "14:00";
const WAKE_ALARM_HOURS = 5;
const EARLIEST_BEDTIME = "20:00";

interface LocalMoment {
  date: string;
  time: string;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let found = formatters.get(timeZone);
  if (!found) {
    found = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    formatters.set(timeZone, found);
  }
  return found;
}

function knownToRuntime(zone: string): boolean {
  try {
    formatter(zone);
    return true;
  } catch {
    return false;
  }
}

/** Etc/GMT-14 through Etc/GMT+12 (the sign is inverted: Etc/GMT+10 is ten hours behind UTC). */
const ETC_GMT_ZONES = Array.from({ length: 27 }, (_, i) => i - 14)
  .filter((offset) => offset !== 0)
  .map((offset) => `Etc/GMT${offset < 0 ? "-" : "+"}${Math.abs(offset)}`);

/** Every accepted home time zone in plain character order: region zones the runtime knows, UTC and Etc/GMT offsets. */
export const ACCEPTED_TIME_ZONES: readonly string[] = [
  ...new Set([
    ...Object.entries(IANA_REGION_ZONES).flatMap(([region, places]) => places.split(" ").map((place) => `${region}/${place}`)),
    ...Intl.supportedValuesOf("timeZone").filter((zone) => zone.includes("/") && !zone.startsWith("Etc/")),
    "UTC",
    ...ETC_GMT_ZONES,
  ]),
]
  .filter(knownToRuntime)
  .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

const accepted = new Set(ACCEPTED_TIME_ZONES);

export function isTimeZone(value: unknown): value is string {
  return typeof value === "string" && accepted.has(value);
}

export function localMoment(instant: Date, timeZone: string): LocalMoment {
  const parts = Object.fromEntries(formatter(timeZone).formatToParts(instant).map((part) => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function addDays(date: string, days: number): string {
  const day = new Date(`${date}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + days);
  return day.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export function isBedtime(value: unknown): value is string {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value) && value >= EARLIEST_BEDTIME;
}

export function wakeAlarm(bedtime: string): string {
  const [hours = 0, minutes = 0] = bedtime.split(":").map(Number);
  return `${String((hours + WAKE_ALARM_HOURS) % 24).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/** The derived key: the local date at or after bedtime, otherwise the previous date. */
export function derivedNightKey(instant: Date, timeZone: string, bedtime: string): string {
  const local = localMoment(instant, timeZone);
  return local.time >= bedtime ? local.date : addDays(local.date, -1);
}

interface NightSettings {
  homeTz: string;
  bedtime: string;
  /** The night key of the dreamer's latest stored entry, if any. */
  latestEntryKey: string | null;
}

/** The published night key: the later of the derived key and the latest stored entry's key, so it never moves back. */
export function nightKeyAt(instant: Date, settings: NightSettings): string {
  const derived = derivedNightKey(instant, settings.homeTz, settings.bedtime);
  return settings.latestEntryKey !== null && settings.latestEntryKey > derived ? settings.latestEntryKey : derived;
}

/** True when the derived key for the settings is earlier than the published key: the night is held. */
export function isNightHeld(instant: Date, settings: NightSettings): boolean {
  return derivedNightKey(instant, settings.homeTz, settings.bedtime) < nightKeyAt(instant, settings);
}

export function nightNumber(nightKey: string, firstNight: string): number {
  return daysBetween(firstNight, nightKey) + 1;
}

/** The capture window of a night runs from bedtime on its date until 14:00 local on the next date. */
export function isLateRecall(nightKey: string, instant: Date, timeZone: string): boolean {
  const local = localMoment(instant, timeZone);
  return `${local.date} ${local.time}` >= `${addDays(nightKey, 1)} ${CAPTURE_WINDOW_CLOSES}`;
}

export function captureWindow(nightKey: string, instant: Date, timeZone: string): "open" | "closed" {
  return isLateRecall(nightKey, instant, timeZone) ? "closed" : "open";
}
