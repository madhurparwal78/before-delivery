import { config } from "../config.js";
import { one, type Db } from "../db.js";
import type { Touch } from "../publish.js";
import type { QuestRow } from "../records.js";
import { addEntry } from "./ledger.js";
import { levelFromTotal, loadUser, totalExperience } from "./progress.js";

interface TickRow {
  id: string;
  user_id: string;
  task_id: string;
  created_at: Date;
  undone: boolean;
  experience: number;
  gold_cents: number;
  value_before: number;
  health_before_tenths: number;
  levelled: boolean;
  strike_event_id: string | null;
  strike_tenths: number;
}

export async function latestTick(db: Db, taskId: string): Promise<TickRow | undefined> {
  return one<TickRow>(db, "SELECT * FROM ticks WHERE task_id = $1 AND NOT undone ORDER BY created_at DESC, id LIMIT 1", [taskId]);
}

/** An untick received strictly less than the undo window after its tick is an undo. */
export function withinWindow(tick: TickRow, now: Date): boolean {
  return now.getTime() - tick.created_at.getTime() < config.undoWindowSeconds * 1000;
}

interface Reverted {
  experience: number;
  goldCents: number;
  damageTenths: number;
}

/** Revert exactly what the tick gave: experience (and the health a level-up refilled), gold, value and boss damage. */
export async function revertTick(db: Db, touch: Touch, tick: TickRow): Promise<Reverted> {
  await db.query("UPDATE ticks SET undone = true WHERE id = $1", [tick.id]);
  await addEntry(db, tick.user_id, "undo", -tick.gold_cents, tick.task_id);
  const user = await loadUser(db, tick.user_id);
  const restored = levelFromTotal(Math.max(0, totalExperience(user.level, user.experience) - tick.experience));
  const health = tick.levelled ? tick.health_before_tenths : user.health_tenths;
  await db.query("UPDATE users SET level = $2, experience = $3, health_tenths = $4 WHERE id = $1", [
    tick.user_id,
    restored.level,
    restored.experience,
    health,
  ]);
  await db.query("DELETE FROM notices WHERE tick_id = $1 AND NOT acknowledged", [tick.id]);
  await db.query("UPDATE tasks SET value = $2 WHERE id = $1", [tick.task_id, tick.value_before]);
  touch.player(tick.user_id);
  const damageTenths = await revertStrike(db, touch, tick);
  return { experience: tick.experience, goldCents: tick.gold_cents, damageTenths };
}

/** The strike leaves the quest only while the quest is still active; a defeating strike or a finished quest keeps it. */
async function revertStrike(db: Db, touch: Touch, tick: TickRow): Promise<number> {
  if (!tick.strike_event_id) return 0;
  const quest = (await one<QuestRow & { seq: number }>(
    db,
    "SELECT q.*, e.seq FROM quest_events e JOIN quests q ON q.id = e.quest_id WHERE e.id = $1",
    [tick.strike_event_id],
  ))!;
  if (quest.state !== "active") return 0;
  await db.query("DELETE FROM quest_events WHERE id = $1", [tick.strike_event_id]);
  await db.query("UPDATE quest_events SET boss_health_after_tenths = boss_health_after_tenths + $3 WHERE quest_id = $1 AND seq > $2", [
    quest.id,
    quest.seq,
    tick.strike_tenths,
  ]);
  await db.query("UPDATE quests SET boss_health_tenths = boss_health_tenths + $2 WHERE id = $1", [quest.id, tick.strike_tenths]);
  touch.quest(quest.id);
  return tick.strike_tenths;
}
