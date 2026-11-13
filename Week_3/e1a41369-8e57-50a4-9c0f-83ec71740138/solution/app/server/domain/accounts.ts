import type { Db } from "../db.js";
import { one } from "../db.js";
import { Message, invalid } from "../errors.js";
import { canonicalZone, closeInstant, dateContaining } from "./dayclock.js";
import { addEntry } from "./ledger.js";

const USERNAME = /^[a-z0-9_]{3,20}$/;
const PASSWORD_MIN = 8;

interface NewUser {
  username: string;
  passwordHash: string;
  timeZone: string;
  dayStartHour: number;
  resting: boolean;
  level: number;
  experience: number;
  healthTenths: number;
  goldCents: number;
  openDate?: string;
}

export const isUsername = (value: unknown): value is string => typeof value === "string" && USERNAME.test(value);
export const isPassword = (value: unknown): value is string => typeof value === "string" && value.length >= PASSWORD_MIN;

export function validateCredentials(username: unknown, password: unknown): { username: string; password: string } {
  const errors: Record<string, string> = {};
  if (!isUsername(username)) errors.username = Message.username;
  if (!isPassword(password)) errors.password = Message.password;
  if (!isUsername(username) || !isPassword(password)) throw invalid(errors);
  return { username, password };
}

export function validateZone(zone: unknown): string | undefined {
  return typeof zone === "string" ? (canonicalZone(zone) ?? undefined) : undefined;
}

export function validateDayStartHour(hour: unknown): number | undefined {
  return typeof hour === "number" && Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : undefined;
}

/** Create a player whose open date is the local date whose day contains `now` (or the given date). */
export async function insertUser(db: Db, user: NewUser, now: Date): Promise<{ id: string; today: string; nextCloseAt: Date }> {
  const today = user.openDate ?? dateContaining(now.getTime(), user.timeZone, user.dayStartHour);
  const nextCloseAt = closeInstant(user.timeZone, today, user.dayStartHour);
  const created = await one<{ id: string }>(
    db,
    `INSERT INTO users (username, password_hash, time_zone, day_start_hour, resting, level, experience, health_tenths, open_date, next_close_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
    [user.username, user.passwordHash, user.timeZone, user.dayStartHour, user.resting, user.level, user.experience, user.healthTenths, today, nextCloseAt],
  );
  if (user.goldCents > 0) await addEntry(db, created!.id, "task", user.goldCents);
  return { id: created!.id, today, nextCloseAt };
}
