import { NAME_MAX, NICKNAME_MAX, NICKNAME_MIN } from "./limits";
import type { ClassroomState, ExportFormat, LatestProject } from "./types";

const NICKNAME_CHARACTERS = /^[\p{L}\p{N} '-]+$/u;
const LOCAL_TIME_FORM = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/;

/** Surrounding spaces trimmed, inner runs of spaces collapsed to one. */
export function normalizeNickname(raw: string): string {
  return raw.trim().replace(/ {2,}/g, " ");
}

/** The stored form of a nickname that uniqueness is compared on. */
export function nicknameKey(nickname: string): string {
  return nickname.toLowerCase();
}

export function isValidNickname(nickname: string): boolean {
  return nickname.length >= NICKNAME_MIN && nickname.length <= NICKNAME_MAX && NICKNAME_CHARACTERS.test(nickname);
}

/** A code is accepted in any case, ignoring spaces and hyphens. */
export function normalizeJoinCode(raw: string): string {
  return raw.replace(/[\s-]+/g, "").toUpperCase();
}

/** A classroom is frozen once it is handed in or archived: no more saves, no more joining. */
export function isFrozen(state: ClassroomState): boolean {
  return state === "handed_in" || state === "archived";
}

/** A Student's work is handed in when the classroom is, or when the project the roster tile shows is. */
export function isHandedIn(state: ClassroomState, latest: Pick<LatestProject, "state"> | null): boolean {
  return isFrozen(state) || latest?.state === "handed_in";
}

export function isValidName(name: string): boolean {
  const trimmed = name.trim();
  return trimmed.length >= 1 && trimmed.length <= NAME_MAX;
}

/** The export file name: the project name lowercased, runs of other characters become one hyphen, trimmed of hyphens. */
export function exportFileName(projectName: string, format: ExportFormat): string {
  const stem = projectName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, NAME_MAX).replace(/-+$/g, "");
  return `${stem || "design"}.${format}`;
}

export function isExportFileName(name: string, format: ExportFormat): boolean {
  const suffix = `.${format}`;
  if (!name.endsWith(suffix)) return false;
  const stem = name.slice(0, -suffix.length);
  return stem.length >= 1 && stem.length <= NAME_MAX && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(stem);
}

export interface LocalTimeParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

/** Parses `YYYY-MM-DD HH:mm` (or with a `T`); null when the text is not of that form or is not a real calendar time. */
export function parseLocalTime(wire: string): LocalTimeParts | null {
  const match = LOCAL_TIME_FORM.exec(wire.trim());
  if (!match) return null;
  const [year, month, day, hour, minute] = match.slice(1).map(Number) as [number, number, number, number, number];
  const probe = new Date(Date.UTC(year, month - 1, day, hour, minute));
  const real = probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day
    && hour < 24 && minute < 60;
  return real ? { year, month, day, hour, minute } : null;
}

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

/** `YYYY-MM-DDTHH:mm`, the wire form of a classroom's local time. */
export function formatLocalWire(p: LocalTimeParts): string {
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

/** `YYYY-MM-DD HH:mm`, the form people read and type. */
export function wireToDisplay(wire: string): string {
  return wire.replace("T", " ");
}

/** Whole-minute countdown parts from seconds, never from a device clock. */
export function countdownParts(seconds: number): { d: number; h: number; m: number } {
  const minutes = Math.floor(Math.max(0, seconds) / 60);
  return { d: Math.floor(minutes / 1440), h: Math.floor((minutes % 1440) / 60), m: minutes % 60 };
}

/** The absolute `YYYY-MM-DD HH:mm` of an instant in a zone; with no zone, in the browser's own zone setting. */
export function formatInZone(instant: string | Date, timeZone?: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(typeof instant === "string" ? new Date(instant) : instant);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}

/** Every IANA zone in Area/Location form, sorted alphabetically: the one list the zone picker offers and the server accepts. */
export function timeZoneNames(): string[] {
  return Intl.supportedValuesOf("timeZone").filter((name) => name.includes("/")).sort();
}

const ZONE_NAME_FORM = /^[A-Z][A-Za-z0-9_+-]*(?:\/[A-Z][A-Za-z0-9_+-]*)+$/;

/** An IANA zone in Area/Location form (including current names such as Asia/Kolkata that the runtime lists under old aliases). */
export function isTimeZone(name: string): boolean {
  if (!ZONE_NAME_FORM.test(name)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: name });
    return true;
  } catch {
    return false;
  }
}
