import { MAX_HEALTH } from "../../shared/api.js";
import { one, type Db } from "../db.js";
import type { Touch } from "../publish.js";
import type { UserRow } from "../records.js";
import { addEntry, balanceCents } from "./ledger.js";

export const FULL_HEALTH_TENTHS = MAX_HEALTH * 10;
const FAINT_SHARE_DIVISOR = 10;

export function experienceToLevel(level: number): number {
  return 25 * level;
}

/** All the experience a player has earned: the full levels below theirs plus the experience in this one. */
export function totalExperience(level: number, experience: number): number {
  let total = experience;
  for (let below = 1; below < level; below += 1) total += experienceToLevel(below);
  return total;
}

export function levelFromTotal(total: number): { level: number; experience: number } {
  let level = 1;
  let rest = total;
  while (rest >= experienceToLevel(level)) {
    rest -= experienceToLevel(level);
    level += 1;
  }
  return { level, experience: rest };
}

export async function loadUser(db: Db, userId: string): Promise<UserRow> {
  return (await one<UserRow>(db, "SELECT * FROM users WHERE id = $1", [userId]))!;
}

/** Add experience, level up with carry-over, refill health on every level gained and record a notice for each. */
export async function gainExperience(db: Db, touch: Touch, userId: string, experience: number, tickId: string | null = null): Promise<boolean> {
  const user = await loadUser(db, userId);
  const next = levelFromTotal(totalExperience(user.level, user.experience) + experience);
  const levelled = next.level > user.level;
  const health = levelled ? FULL_HEALTH_TENTHS : user.health_tenths;
  await db.query("UPDATE users SET level = $2, experience = $3, health_tenths = $4 WHERE id = $1", [userId, next.level, next.experience, health]);
  for (let reached = user.level + 1; reached <= next.level; reached += 1) await addNotice(db, touch, userId, "level_up", reached, 0, tickId);
  touch.player(userId);
  return levelled;
}

export async function loseHealth(db: Db, touch: Touch, userId: string, tenths: number): Promise<void> {
  await db.query("UPDATE users SET health_tenths = health_tenths - $2 WHERE id = $1", [userId, tenths]);
  touch.player(userId);
}

/** Health at zero or less costs a level, the experience in the level and a tenth of the gold; health resets. */
export async function settleFaint(db: Db, touch: Touch, userId: string): Promise<boolean> {
  const user = await loadUser(db, userId);
  if (user.health_tenths > 0) return false;
  const level = Math.max(1, user.level - 1);
  const goldLost = Math.floor(Math.max(0, await balanceCents(db, userId)) / FAINT_SHARE_DIVISOR);
  if (goldLost > 0) await addEntry(db, userId, "faint", -goldLost);
  await db.query("UPDATE users SET level = $2, experience = 0, health_tenths = $3 WHERE id = $1", [userId, level, FULL_HEALTH_TENTHS]);
  await addNotice(db, touch, userId, "faint", level, goldLost, null);
  touch.player(userId);
  return true;
}

async function addNotice(db: Db, touch: Touch, userId: string, kind: "level_up" | "faint", level: number, goldLostCents: number, tickId: string | null): Promise<void> {
  const notice = await one<{ id: string }>(
    db,
    "INSERT INTO notices (user_id, kind, level, gold_lost_cents, tick_id) VALUES ($1, $2, $3, $4, $5) RETURNING id",
    [userId, kind, level, goldLostCents, tickId],
  );
  touch.notice(userId, notice!.id);
}
