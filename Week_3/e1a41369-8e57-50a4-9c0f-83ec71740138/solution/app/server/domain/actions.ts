import { Message, Refusal, invalid } from "../errors.js";
import { one, rows, type Db } from "../db.js";
import type { Touch } from "../publish.js";
import type { ChecklistRow, EventRow, TaskRow, UserRow } from "../records.js";
import { addEntry, balanceCents } from "./ledger.js";
import { gainExperience, loadUser, loseHealth, settleFaint } from "./progress.js";
import { clampValue, damageTenthsFor, experienceFor, goldCentsFor, healthLossTenths } from "./rewards.js";
import { strikeBoss } from "./strikes.js";
import { latestTick, revertTick, withinWindow } from "./undo.js";

export interface Outcome {
  task: TaskRow;
  delta: { experience: number; gold: number; health: number; damage: number };
  strike: EventRow | null;
  levelUp: boolean;
  fainted: boolean;
}

async function reloadTask(db: Db, taskId: string): Promise<TaskRow> {
  return (await one<TaskRow>(db, "SELECT * FROM tasks WHERE id = $1", [taskId]))!;
}

async function touchTask(db: Db, touch: Touch, taskId: string, change: string, values: unknown[] = []): Promise<TaskRow> {
  await db.query(
    `UPDATE tasks SET ${change}, updated_at = GREATEST(now(), updated_at + interval '1 millisecond') WHERE id = $1`,
    [taskId, ...values],
  );
  const task = await reloadTask(db, taskId);
  touch.taskList(task.user_id);
  return task;
}

async function checklistCounts(db: Db, taskId: string): Promise<{ checked: number; total: number }> {
  const items = await rows<ChecklistRow>(db, "SELECT * FROM checklist_items WHERE task_id = $1", [taskId]);
  return { checked: items.filter((item) => item.checked).length, total: items.length };
}

/** Completing a daily or to-do pays experience, gold and boss damage once; the tick is recorded for undo. */
export async function complete(db: Db, touch: Touch, user: UserRow, task: TaskRow, now: Date): Promise<Outcome> {
  if (task.type !== "daily" && task.type !== "todo") throw invalid({ type: Message.type });
  if (task.done) throw Refusal.alreadyDone();
  const { checked, total } = await checklistCounts(db, task.id);
  const experience = experienceFor(task.difficulty!, task.value!, checked, total);
  const goldCents = goldCentsFor(experience);
  await addEntry(db, user.id, "task", goldCents, task.id);
  const tick = (await one<{ id: string }>(
    db,
    `INSERT INTO ticks (user_id, task_id, created_at, experience, gold_cents, value_before, health_before_tenths, levelled)
     VALUES ($1, $2, $3, $4, $5, $6, $7, false) RETURNING id`,
    [user.id, task.id, now, experience, goldCents, task.value, user.health_tenths],
  ))!;
  const levelled = await gainExperience(db, touch, user.id, experience, tick.id);
  const strike = await strikeBoss(db, touch, user, damageTenthsFor(experience), now);
  await db.query("UPDATE ticks SET levelled = $2, strike_event_id = $3, strike_tenths = $4 WHERE id = $1", [
    tick.id,
    levelled,
    strike?.event.id ?? null,
    strike?.event.amount_tenths ?? 0,
  ]);
  const updated = await touchTask(db, touch, task.id, "done = true, value = $2", [clampValue(task.value! + 1)]);
  return outcome(db, user, updated, { experience, goldCents, damageTenths: strike?.event.amount_tenths ?? 0 }, strike?.event ?? null, false);
}

/** Unticking inside the undo window reverts the tick; later it only clears the done state. */
export async function uncomplete(db: Db, touch: Touch, user: UserRow, task: TaskRow, now: Date): Promise<Outcome> {
  if (!task.done) throw Refusal.notDone();
  const tick = await latestTick(db, task.id);
  let reverted: Awaited<ReturnType<typeof revertTick>> | null = null;
  if (tick) {
    if (withinWindow(tick, now)) reverted = await revertTick(db, touch, tick);
    else await db.query("UPDATE ticks SET undone = true WHERE id = $1", [tick.id]);
  }
  const updated = await touchTask(db, touch, task.id, "done = false");
  const delta = reverted
    ? { experience: reverted.experience, goldCents: reverted.goldCents, damageTenths: reverted.damageTenths }
    : { experience: 0, goldCents: 0, damageTenths: 0 };
  return outcome(db, user, updated, { experience: -delta.experience, goldCents: -delta.goldCents, damageTenths: -delta.damageTenths }, null, false);
}

/** Scoring a habit up pays like a completion; scoring down costs health. Either moves the value by one. */
export async function score(db: Db, touch: Touch, user: UserRow, task: TaskRow, direction: "up" | "down", now: Date): Promise<Outcome> {
  if (direction === "down") {
    const loss = healthLossTenths(task.difficulty!, task.value!);
    await loseHealth(db, touch, user.id, loss);
    const fainted = await settleFaint(db, touch, user.id);
    const updated = await touchTask(db, touch, task.id, "value = $2", [clampValue(task.value! - 1)]);
    return outcome(db, user, updated, { experience: 0, goldCents: 0, damageTenths: 0, healthTenths: -loss }, null, fainted);
  }
  const experience = experienceFor(task.difficulty!, task.value!);
  const goldCents = goldCentsFor(experience);
  await addEntry(db, user.id, "task", goldCents, task.id);
  await gainExperience(db, touch, user.id, experience);
  const strike = await strikeBoss(db, touch, user, damageTenthsFor(experience), now);
  const updated = await touchTask(db, touch, task.id, "value = $2", [clampValue(task.value! + 1)]);
  return outcome(db, user, updated, { experience, goldCents, damageTenths: strike?.event.amount_tenths ?? 0 }, strike?.event ?? null, false);
}

/** Buying a reward spends its price from the ledger balance; a price equal to the balance is allowed. */
export async function buy(db: Db, touch: Touch, user: UserRow, reward: TaskRow): Promise<Outcome> {
  if (reward.type !== "reward") throw invalid({ type: Message.type });
  const price = reward.price_cents!;
  if (price > (await balanceCents(db, user.id))) throw invalid({ gold: Message.gold });
  await addEntry(db, user.id, "reward", -price, reward.id);
  touch.player(user.id);
  return outcome(db, user, reward, { experience: 0, goldCents: -price, damageTenths: 0 }, null, false);
}

async function outcome(
  db: Db,
  user: UserRow,
  task: TaskRow,
  change: { experience: number; goldCents: number; damageTenths: number; healthTenths?: number },
  strike: EventRow | null,
  fainted: boolean,
): Promise<Outcome> {
  const after = await loadUser(db, user.id);
  return {
    task,
    delta: {
      experience: change.experience,
      gold: change.goldCents / 100,
      health: (change.healthTenths ?? after.health_tenths - user.health_tenths) / 10,
      damage: change.damageTenths / 10,
    },
    strike,
    levelUp: after.level > user.level,
    fainted,
  };
}
