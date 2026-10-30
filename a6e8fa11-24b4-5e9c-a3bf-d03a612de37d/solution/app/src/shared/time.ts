// Station time: wall-clock times in the station's IANA zone, whatever the server's or browser's own zone.
import { serialOfDate } from "./values.js";

export interface LocalDateTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const partFormats = new Map<string, Intl.DateTimeFormat>();
const nameFormats = new Map<string, Intl.DateTimeFormat>();

function partsFormat(zone: string): Intl.DateTimeFormat {
  let f = partFormats.get(zone);
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
    partFormats.set(zone, f);
  }
  return f;
}

/** The wall-clock reading in `zone` at the instant `ms`. */
function zonedParts(ms: number, zone: string): LocalDateTime {
  const out: Record<string, number> = {};
  for (const part of partsFormat(zone).formatToParts(new Date(ms))) {
    if (part.type !== "literal") out[part.type] = Number(part.value);
  }
  return { year: out.year, month: out.month, day: out.day, hour: out.hour, minute: out.minute, second: out.second };
}

function wallMs(t: LocalDateTime): number {
  return Date.UTC(t.year, t.month - 1, t.day, t.hour, t.minute, t.second);
}

function offsetAt(ms: number, zone: string): number {
  return wallMs(zonedParts(ms, zone)) - Math.floor(ms / 1000) * 1000;
}

type Resolved = { kind: "instant"; ms: number } | { kind: "skipped" };

/** The UTC instant of a station wall-clock time: a repeated time means the earlier instant. */
export function resolveLocal(local: LocalDateTime, zone: string): Resolved {
  const wall = wallMs(local);
  const offsets = new Set([offsetAt(wall - 86_400_000, zone), offsetAt(wall, zone), offsetAt(wall + 86_400_000, zone)]);
  const matches = [...offsets]
    .map((offset) => wall - offset)
    .filter((ms) => wallMs(zonedParts(ms, zone)) === wall)
    .sort((a, b) => a - b);
  return matches.length ? { kind: "instant", ms: matches[0] } : { kind: "skipped" };
}

/** Like resolveLocal, but a skipped time moves forward past the gap (used when a station's zone changes). */
export function resolveLocalForward(local: LocalDateTime, zone: string): number {
  for (let minutes = 0; minutes <= 180; minutes += 1) {
    const shifted = zonedParts(wallMs(local) + minutes * 60_000, "UTC");
    const r = resolveLocal(shifted, zone);
    if (r.kind === "instant") return r.ms;
  }
  return wallMs(local) - offsetAt(wallMs(local), zone);
}

const LOCAL_INPUT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

/** Parses the API's local form `YYYY-MM-DDTHH:MM` or `YYYY-MM-DDTHH:MM:SS`. */
export function parseLocalDateTime(text: string): LocalDateTime | null {
  const m = LOCAL_INPUT.exec(text);
  if (!m) return null;
  const t: LocalDateTime = {
    year: Number(m[1]),
    month: Number(m[2]),
    day: Number(m[3]),
    hour: Number(m[4]),
    minute: Number(m[5]),
    second: m[6] === undefined ? 0 : Number(m[6]),
  };
  if (t.hour > 23 || t.minute > 59 || t.second > 59 || t.month < 1 || t.month > 12 || t.day < 1) return null;
  const probe = new Date(Date.UTC(t.year, t.month - 1, t.day));
  return probe.getUTCDate() === t.day && probe.getUTCMonth() === t.month - 1 ? t : null;
}

const two = (n: number): string => String(n).padStart(2, "0");

export function localDateTimeText(t: LocalDateTime): string {
  return `${String(t.year).padStart(4, "0")}-${two(t.month)}-${two(t.day)}T${two(t.hour)}:${two(t.minute)}:${two(t.second)}`;
}

function zoneAbbreviation(ms: number, zone: string): string {
  let f = nameFormats.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "short" });
    nameFormats.set(zone, f);
  }
  return f.formatToParts(new Date(ms)).find((p) => p.type === "timeZoneName")?.value ?? zone;
}

/** `<local time>`: "2026-10-30 17:00 CDT". */
export function stationTimeLabel(ms: number, zone: string): string {
  const t = zonedParts(ms, zone);
  return `${t.year}-${two(t.month)}-${two(t.day)} ${two(t.hour)}:${two(t.minute)} ${zoneAbbreviation(ms, zone)}`;
}

/** TODAY(): the station's current date as a day count. */
export function stationToday(ms: number, zone: string): number {
  const t = zonedParts(ms, zone);
  return serialOfDate(t.year, t.month, t.day);
}

/** NOW(): the station's wall clock as a day count with a fraction. */
export function stationNow(ms: number, zone: string): number {
  const t = zonedParts(ms, zone);
  return serialOfDate(t.year, t.month, t.day) + (t.hour * 3600 + t.minute * 60 + t.second) / 86_400;
}

/** The IANA zone list the station time-zone picker offers and the server accepts. */
export function timeZoneList(): string[] {
  return Intl.supportedValuesOf("timeZone");
}
