import type { Difficulty, TaskType, Weekday } from "../../shared/api.js";
import { one, type Db } from "../db.js";
import type { TaskRow } from "../records.js";

async function nextPosition(db: Db, userId: string, type: TaskType): Promise<number> {
  const row = await one<{ last: number }>(db, "SELECT COALESCE(MAX(position), 0) AS last FROM tasks WHERE user_id = $1 AND type = $2", [userId, type]);
  return row!.last + 1;
}

export interface NewTask {
  type: TaskType;
  title: string;
  difficulty: Difficulty | null;
  weekdays: Weekday[] | null;
  priceCents: number | null;
  /** Set by seed data and the grading setup; a new task starts at 0, streak 0 and not done. */
  value?: number;
  streak?: number;
  done?: boolean;
}

/** Create a task at the end of its list. The one place a task row is inserted. */
export async function insertTask(db: Db, userId: string, task: NewTask): Promise<TaskRow> {
  const hasValue = task.type !== "reward";
  const completable = task.type === "daily" || task.type === "todo";
  return (await one<TaskRow>(
    db,
    `INSERT INTO tasks (user_id, type, title, difficulty, value, streak, done, weekdays, price_cents, position, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now()) RETURNING *`,
    [
      userId,
      task.type,
      task.title,
      task.difficulty,
      hasValue ? (task.value ?? 0) : null,
      task.type === "daily" ? (task.streak ?? 0) : null,
      completable ? (task.done ?? false) : null,
      task.weekdays,
      task.priceCents,
      await nextPosition(db, userId, task.type),
    ],
  ))!;
}

export async function listLength(db: Db, userId: string, type: TaskType): Promise<number> {
  const row = await one<{ count: number }>(db, "SELECT COUNT(*) AS count FROM tasks WHERE user_id = $1 AND type = $2", [userId, type]);
  return row!.count;
}

/** Take the task out and insert it at `position`, shifting the others; positions stay contiguous. */
export async function moveTask(db: Db, task: TaskRow, position: number): Promise<void> {
  if (position > task.position) {
    await db.query("UPDATE tasks SET position = position - 1 WHERE user_id = $1 AND type = $2 AND position > $3 AND position <= $4", [task.user_id, task.type, task.position, position]);
  } else {
    await db.query("UPDATE tasks SET position = position + 1 WHERE user_id = $1 AND type = $2 AND position >= $4 AND position < $3", [task.user_id, task.type, task.position, position]);
  }
  await db.query("UPDATE tasks SET position = $2, updated_at = GREATEST(now(), updated_at + interval '1 millisecond') WHERE id = $1", [task.id, position]);
}

export async function closeGap(db: Db, task: TaskRow): Promise<void> {
  await db.query("UPDATE tasks SET position = position - 1 WHERE user_id = $1 AND type = $2 AND position > $3", [task.user_id, task.type, task.position]);
}
