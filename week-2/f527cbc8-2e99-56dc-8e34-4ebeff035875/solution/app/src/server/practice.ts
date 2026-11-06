// The practice and its time zone, read once after seeding; every instant the API prints carries the practice-zone
// offset in force at it (brief: API, General rules; Business rules, Practice time).
import type { Queryable } from "./db.js";
import { businessDate, cancellationCutoff, formatInstant, formatWallClock, wallClockInstant } from "./practiceTime.js";

interface Practice {
  name: string;
  time_zone: string;
}

let practice: Practice = { name: "", time_zone: "UTC" };

export async function loadPractice(db: Queryable): Promise<void> {
  const { rows } = await db.query<Practice>(`SELECT name, time_zone FROM practice WHERE id = 1`);
  practice = rows[0] ?? practice;
}

export const practiceInfo = (): Practice => practice;
export const zone = (): string => practice.time_zone;
export const today = (at: number): string => businessDate(at, practice.time_zone);
export const stamp = (instant: number | Date): string =>
  formatInstant(typeof instant === "number" ? instant : instant.getTime(), practice.time_zone);
export const stampOrNull = (instant: Date | null): string | null => (instant ? stamp(instant) : null);
/** `YYYY-MM-DD HH:MM (<time zone>)`, the cutoff and link-expiry copy format. */
export const wallClock = (instant: number | Date): string =>
  formatWallClock(typeof instant === "number" ? instant : instant.getTime(), practice.time_zone);
/** `HH:MM:SS` of an instant in the practice zone. */
export const clockSeconds = (instant: number | Date): string => stamp(instant).slice(11, 19);
export const businessDateOf = (instant: number | Date): string =>
  businessDate(typeof instant === "number" ? instant : instant.getTime(), practice.time_zone);

/** Start instant of a barn day; stored days always resolve because their start was validated on save. */
export function startsAt(date: string, time: string): number {
  const instant = wallClockInstant(date, time, practice.time_zone);
  if (instant === null) throw new Error(`Stored barn day start ${date} ${time} does not exist`);
  return instant;
}

export const cutoffAt = (date: string, time: string): number => cancellationCutoff(startsAt(date, time));
