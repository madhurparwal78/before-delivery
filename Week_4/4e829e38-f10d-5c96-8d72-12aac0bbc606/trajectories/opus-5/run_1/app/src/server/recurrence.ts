import { claim, query } from './db.js';
import { addDays, diffDays, parseDate, toDateString, WEEKDAY_NAMES } from './clock.js';
import { dateOnly, getTaskRow, type TaskRow } from './model.js';
import { createTaskRow, nextPosition, publishTask, teamOfProject } from './taskops.js';
import { publish } from './events.js';

export type Recurrence =
  | { kind: 'weekly'; weekday: number }
  | { kind: 'monthly'; day: number }
  | { kind: 'after_completion'; days: number };

/** The one place the repeat rules are read. */
export function parseRecurrence(text: string | null): Recurrence | null {
  if (!text) return null;
  const weekly = /^Every week on (\w+)$/.exec(text);
  if (weekly) {
    const index = WEEKDAY_NAMES.findIndex((n) => n === weekly[1]);
    return index === -1 ? null : { kind: 'weekly', weekday: index };
  }
  const monthly = /^Every month on day (\d+)$/.exec(text);
  if (monthly) return { kind: 'monthly', day: Number(monthly[1]) };
  const after = /^Every (\d+) days after completion$/.exec(text);
  if (after) return { kind: 'after_completion', days: Number(after[1]) };
  return null;
}

export function nextDue(
  recurrence: Recurrence,
  previousDue: string | null,
  completionDate: string | null,
): string | null {
  if (recurrence.kind === 'after_completion') {
    return completionDate ? addDays(completionDate, recurrence.days) : null;
  }
  if (!previousDue) return null;
  if (recurrence.kind === 'weekly') {
    const current = parseDate(previousDue).getUTCDay();
    let ahead = (recurrence.weekday - current + 7) % 7;
    if (ahead === 0) ahead = 7;
    return addDays(previousDue, ahead);
  }
  const base = parseDate(previousDue);
  const year = base.getUTCFullYear();
  const month = base.getUTCMonth();
  const targetYear = month === 11 ? year + 1 : year;
  const targetMonth = (month + 1) % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const day = Math.min(recurrence.day, lastDay);
  return toDateString(new Date(Date.UTC(targetYear, targetMonth, day)));
}

/**
 * Creates the successor of a recurring task, exactly once per task across
 * instances. Returns the successor's due date when one was made.
 */
export async function createSuccessor(
  task: TaskRow,
  now: Date,
  reason: 'completed' | 'clock',
): Promise<{ id: string; due: string } | null> {
  const recurrence = parseRecurrence(task.recurrence);
  if (!recurrence) return null;
  if (reason === 'clock' && recurrence.kind === 'after_completion') return null;
  const completionDate = task.completed_on ? dateOnly(task.completed_on) : toDateString(now);
  const due = nextDue(recurrence, dateOnly(task.due_date), completionDate);
  if (!due) return null;
  if (!(await claim(`successor:${task.id}`))) return null;

  const previousDue = dateOnly(task.due_date);
  const shift = previousDue ? diffDays(previousDue, due) : 0;
  const start = task.start_date ? addDays(dateOnly(task.start_date) as string, shift) : null;
  const created = await createTaskRow({
    projectId: task.project_id,
    sectionId: task.section_id,
    parentId: null,
    name: task.name,
    description: task.description,
    position: await nextPosition(task.section_id, null),
    assigneeId: task.assignee_id,
    start,
    due,
    effort: task.effort === null ? null : Number(task.effort),
    recurrence: task.recurrence,
    createdAt: now,
  });
  await query(`UPDATE tasks SET successor_id = $1 WHERE id = $2`, [created.id, task.id]);
  const values = await query<{ field_id: string; value: unknown }>(
    `SELECT field_id, value FROM task_values WHERE task_id = $1`,
    [task.id],
  );
  for (const row of values) {
    await query(`INSERT INTO task_values (task_id, field_id, value) VALUES ($1,$2,$3)`, [
      created.id,
      row.field_id,
      JSON.stringify(row.value),
    ]);
  }
  const teamId = await teamOfProject(task.project_id);
  await publishTask(created.id, toDateString(now));
  await publish({
    type: 'successor_created',
    teamId,
    projectId: task.project_id,
    taskId: created.id,
    announcement: `${task.name} repeats on ${due}`,
  });
  return { id: created.id, due };
}

export async function tasksDueForSuccessor(now: Date): Promise<TaskRow[]> {
  const today = toDateString(now);
  const rows = await query<{ id: string }>(
    `SELECT id FROM tasks
     WHERE completed = false AND recurrence IS NOT NULL AND successor_id IS NULL
       AND due_date IS NOT NULL AND due_date < $1
     ORDER BY created_at`,
    [today],
  );
  const out: TaskRow[] = [];
  for (const row of rows) {
    const task = await getTaskRow(row.id);
    if (task) out.push(task);
  }
  return out;
}
