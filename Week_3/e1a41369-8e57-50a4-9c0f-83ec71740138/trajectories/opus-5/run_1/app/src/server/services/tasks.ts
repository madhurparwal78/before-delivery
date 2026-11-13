import type { Client } from '../db.js';
import type { ChecklistItem, Difficulty, Task, TaskLists, TaskType, Weekday } from '../../shared/types.js';
import { bandName } from '../domain/rewards.js';
import { weekdayOf } from '../time.js';

export interface TaskRow {
  id: string;
  user_id: string;
  type: TaskType;
  title: string;
  difficulty: Difficulty | null;
  value: number | null;
  streak: number | null;
  done: boolean | null;
  weekdays: string[] | null;
  price_cents: number | null;
  position: number;
  updated_at: Date;
}

const TASK_COLUMNS =
  'id, user_id, type, title, difficulty, value, streak, done, weekdays, price_cents, position, updated_at';

export async function loadTaskRow(client: Client, taskId: string): Promise<TaskRow | null> {
  const found = await client.query<TaskRow>(`select ${TASK_COLUMNS} from tasks where id = $1`, [taskId]);
  return found.rows[0] ?? null;
}

export async function loadChecklist(client: Client, taskId: string): Promise<ChecklistItem[]> {
  const found = await client.query<{ id: string; text: string; checked: boolean }>(
    'select id, text, checked from checklist_items where task_id = $1 order by position',
    [taskId],
  );
  return found.rows.map((row) => ({ id: row.id, text: row.text, checked: row.checked }));
}

export function taskJson(row: TaskRow, checklist: ChecklistItem[], openDate: string): Task {
  const isDaily = row.type === 'daily';
  const isTodo = row.type === 'todo';
  const isReward = row.type === 'reward';
  const weekdays = isDaily ? ((row.weekdays ?? []) as Weekday[]) : null;
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    difficulty: isReward ? null : row.difficulty,
    value: isReward ? null : row.value,
    band: isReward ? null : bandName(row.value ?? 0),
    streak: isDaily ? row.streak : null,
    done: isDaily || isTodo ? row.done : null,
    dueToday: isDaily ? (weekdays ?? []).includes(weekdayOf(openDate)) : null,
    weekdays,
    checklist: isTodo ? checklist : null,
    price: isReward ? (row.price_cents ?? 0) / 100 : null,
    position: row.position,
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function taskJsonById(client: Client, taskId: string, openDate: string): Promise<Task | null> {
  const row = await loadTaskRow(client, taskId);
  if (!row) return null;
  const checklist = row.type === 'todo' ? await loadChecklist(client, taskId) : [];
  return taskJson(row, checklist, openDate);
}

export async function loadTaskLists(client: Client, userId: string, openDate: string): Promise<TaskLists> {
  const rows = await client.query<TaskRow>(
    `select ${TASK_COLUMNS} from tasks where user_id = $1 order by position, created_at`,
    [userId],
  );
  const checklists = await client.query<{ task_id: string; id: string; text: string; checked: boolean }>(
    `select c.task_id, c.id, c.text, c.checked from checklist_items c
     join tasks t on t.id = c.task_id
     where t.user_id = $1 order by c.task_id, c.position`,
    [userId],
  );
  const byTask = new Map<string, ChecklistItem[]>();
  for (const item of checklists.rows) {
    const list = byTask.get(item.task_id) ?? [];
    list.push({ id: item.id, text: item.text, checked: item.checked });
    byTask.set(item.task_id, list);
  }
  const lists: TaskLists = { habits: [], dailies: [], todos: [], rewards: [] };
  for (const row of rows.rows) {
    const task = taskJson(row, byTask.get(row.id) ?? [], openDate);
    if (row.type === 'habit') lists.habits.push(task);
    else if (row.type === 'daily') lists.dailies.push(task);
    else if (row.type === 'todo') lists.todos.push(task);
    else lists.rewards.push(task);
  }
  return lists;
}

export async function loadListOfType(
  client: Client,
  userId: string,
  type: TaskType,
  openDate: string,
): Promise<Task[]> {
  const lists = await loadTaskLists(client, userId, openDate);
  if (type === 'habit') return lists.habits;
  if (type === 'daily') return lists.dailies;
  if (type === 'todo') return lists.todos;
  return lists.rewards;
}

export async function countOfType(client: Client, userId: string, type: TaskType): Promise<number> {
  const found = await client.query<{ total: string }>(
    'select count(*)::text as total from tasks where user_id = $1 and type = $2',
    [userId, type],
  );
  return Number(found.rows[0]?.total ?? '0');
}

/** Takes the task out of its list and inserts it at `position`, keeping positions contiguous. */
export async function moveTask(client: Client, row: TaskRow, position: number): Promise<void> {
  await client.query('update tasks set position = 0 where id = $1', [row.id]);
  await client.query(
    'update tasks set position = position - 1 where user_id = $1 and type = $2 and position > $3',
    [row.user_id, row.type, row.position],
  );
  await client.query(
    'update tasks set position = position + 1 where user_id = $1 and type = $2 and position >= $3',
    [row.user_id, row.type, position],
  );
  await client.query('update tasks set position = $2 where id = $1', [row.id, position]);
}

export async function closeGapAfterDelete(
  client: Client,
  userId: string,
  type: TaskType,
  position: number,
): Promise<void> {
  await client.query('update tasks set position = position - 1 where user_id = $1 and type = $2 and position > $3', [
    userId,
    type,
    position,
  ]);
}
