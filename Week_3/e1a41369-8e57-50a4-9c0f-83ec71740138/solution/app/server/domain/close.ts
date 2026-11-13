import { one, rows, transaction, type Db } from "../db.js";
import { Touch, scheduleFlush } from "../publish.js";
import type { QuestRow, TaskRow, UserRow } from "../records.js";
import { addDays, closeInstant, weekdayOf } from "./dayclock.js";
import { loadUser, loseHealth, settleFaint } from "./progress.js";
import { fixtureOf } from "./quests.js";
import { clampValue, healthLossTenths } from "./rewards.js";
import { appendEvent, activeQuestOf } from "./strikes.js";

interface CloseReport {
  username: string;
  date: string;
  missed: number;
  healthLost: number;
  strikeBack: number;
}

/** Recompute when a player's open date closes: the day start of the next date in their zone. */
export async function scheduleClose(db: Db, userId: string): Promise<void> {
  const user = await loadUser(db, userId);
  const at = closeInstant(user.time_zone, user.open_date, user.day_start_hour);
  await db.query("UPDATE users SET next_close_at = $2 WHERE id = $1", [userId, at]);
}

/** Close the player's open date: the five published steps in order. The closed-days row makes it happen once. */
async function closeOpenDate(db: Db, touch: Touch, userId: string): Promise<CloseReport> {
  const user = await loadUser(db, userId);
  const date = user.open_date;
  await db.query("INSERT INTO closed_days (user_id, local_date) VALUES ($1, $2)", [userId, date]);
  const weekday = weekdayOf(date);
  const dailies = await rows<TaskRow>(db, "SELECT * FROM tasks WHERE user_id = $1 AND type = 'daily' ORDER BY position", [userId]);
  const due = dailies.filter((daily) => daily.weekdays!.includes(weekday));
  const missed = due.filter((daily) => !daily.done);

  let ownLossTenths = 0;
  if (!user.resting) {
    for (const daily of missed) {
      ownLossTenths += healthLossTenths(daily.difficulty!, daily.value!);
      await db.query("UPDATE tasks SET value = $2, streak = 0, updated_at = now() WHERE id = $1", [daily.id, clampValue(daily.value! - 2)]);
    }
  }
  for (const daily of due.filter((item) => item.done)) {
    await db.query("UPDATE tasks SET streak = streak + 1, updated_at = now() WHERE id = $1", [daily.id]);
  }
  if (ownLossTenths > 0) await loseHealth(db, touch, userId, ownLossTenths);

  const strikeBackTenths = await strikeBack(db, touch, user, missed.length);

  const lost = new Set<string>(strikeBackTenths > 0 ? await membersToHurt(db, user) : []);
  if (ownLossTenths > 0) lost.add(userId);
  const inUsernameOrder = await rows<{ id: string }>(db, "SELECT id FROM users WHERE id = ANY($1) ORDER BY username", [[...lost]]);
  for (const member of inUsernameOrder) await settleFaint(db, touch, member.id);

  await db.query("UPDATE tasks SET done = false, updated_at = now() WHERE user_id = $1 AND type = 'daily' AND done", [userId]);
  await db.query("UPDATE users SET open_date = $2 WHERE id = $1", [userId, addDays(date, 1)]);
  await scheduleClose(db, userId);
  touch.player(userId);
  touch.taskList(userId);
  return { username: user.username, date, missed: missed.length, healthLost: ownLossTenths / 10, strikeBack: strikeBackTenths / 10 };
}

async function membersToHurt(db: Db, misser: UserRow): Promise<string[]> {
  const members = await rows<{ id: string }>(db, "SELECT id FROM users WHERE party_id = $1 AND NOT resting", [misser.party_id]);
  return members.map((member) => member.id);
}

/** The boss strikes back once, attributed to the misser, at every party member who is not resting. */
async function strikeBack(db: Db, touch: Touch, misser: UserRow, missed: number): Promise<number> {
  if (misser.resting || missed === 0) return 0;
  const quest: QuestRow | undefined = await activeQuestOf(db, misser.party_id);
  if (!quest) return 0;
  const amount = fixtureOf(quest).powerTenths * missed;
  await appendEvent(db, touch, quest, {
    kind: "strikeback",
    userId: misser.id,
    amountTenths: amount,
    missed,
    bossHealthAfterTenths: quest.boss_health_tenths,
  });
  for (const memberId of await membersToHurt(db, misser)) await loseHealth(db, touch, memberId, amount);
  return amount;
}

/** Run every close due at or before `at`, in order of close instant and then username. */
export async function runDueCloses(at: Date, only?: string): Promise<CloseReport[]> {
  const reports: CloseReport[] = [];
  for (;;) {
    const touch = new Touch();
    const report = await transaction(async (db) => {
      const next = await one<{ id: string }>(
        db,
        `SELECT u.id FROM users u
         WHERE u.next_close_at <= $1 AND ($2::uuid IS NULL OR u.id = $2)
           AND NOT EXISTS (SELECT 1 FROM closed_days c WHERE c.user_id = u.id AND c.local_date = u.open_date)
         ORDER BY u.next_close_at, u.username LIMIT 1`,
        [at, only ?? null],
      );
      return next ? closeOpenDate(db, touch, next.id) : null;
    });
    if (!report) return reports;
    reports.push(report);
    scheduleFlush(touch);
  }
}
