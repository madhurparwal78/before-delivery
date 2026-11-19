import { newId, query } from './db.js';
import { publish } from './events.js';
import {
  getFields,
  getStoredValues,
  getTaskRow,
  serializeTask,
  type TaskRow,
} from './model.js';

export type TriggerKind =
  | 'task_added'
  | 'field_changed'
  | 'moved_to_section'
  | 'approval_decided'
  | 'due_date_arrives';

export interface TriggerEvent {
  taskId: string;
  kind: TriggerKind;
  /** Field id, or one of the built-in keys `assignee`, `start`, `due`, `effort`. */
  field?: string;
  value?: unknown;
  section?: string;
  key: string;
}

export async function teamOfProject(projectId: string): Promise<string> {
  const rows = await query<{ team_id: string }>(`SELECT team_id FROM projects WHERE id = $1`, [
    projectId,
  ]);
  return rows[0].team_id;
}

export async function nextPosition(sectionId: string, parentId: string | null): Promise<number> {
  const rows =
    parentId === null
      ? await query<{ max: number | null }>(
          `SELECT MAX(position) AS max FROM tasks WHERE section_id = $1 AND parent_id IS NULL`,
          [sectionId],
        )
      : await query<{ max: number | null }>(
          `SELECT MAX(position) AS max FROM tasks WHERE parent_id = $1`,
          [parentId],
        );
  return (rows[0].max ?? 0) + 1;
}

/** Closes gaps so sibling positions stay 1-based and contiguous. */
export async function closeUp(sectionId: string, parentId: string | null): Promise<void> {
  const rows =
    parentId === null
      ? await query<{ id: string }>(
          `SELECT id FROM tasks WHERE section_id = $1 AND parent_id IS NULL
           ORDER BY position, created_at`,
          [sectionId],
        )
      : await query<{ id: string }>(
          `SELECT id FROM tasks WHERE parent_id = $1 ORDER BY position, created_at`,
          [parentId],
        );
  for (let i = 0; i < rows.length; i += 1) {
    await query(`UPDATE tasks SET position = $1 WHERE id = $2`, [i + 1, rows[i].id]);
  }
}

export async function makeRoomAt(
  sectionId: string,
  parentId: string | null,
  position: number,
  exceptId: string | null,
): Promise<void> {
  if (parentId === null) {
    await query(
      `UPDATE tasks SET position = position + 1
       WHERE section_id = $1 AND parent_id IS NULL AND position >= $2 AND id <> COALESCE($3, '')`,
      [sectionId, position, exceptId],
    );
    return;
  }
  await query(
    `UPDATE tasks SET position = position + 1
     WHERE parent_id = $1 AND position >= $2 AND id <> COALESCE($3, '')`,
    [parentId, position, exceptId],
  );
}

export async function addHistory(taskId: string, text: string, at: Date): Promise<void> {
  await query(
    `INSERT INTO task_history (id, task_id, text, created_at) VALUES ($1, $2, $3, $4)`,
    [newId(), taskId, text, at.toISOString()],
  );
}

export async function bumpVersion(taskId: string): Promise<number> {
  const rows = await query<{ version: number }>(
    `UPDATE tasks SET version = version + 1 WHERE id = $1 RETURNING version`,
    [taskId],
  );
  return rows[0].version;
}

export async function setStoredValue(
  taskId: string,
  fieldId: string,
  value: unknown,
): Promise<void> {
  if (value === null) {
    await query(`DELETE FROM task_values WHERE task_id = $1 AND field_id = $2`, [taskId, fieldId]);
    return;
  }
  await query(
    `INSERT INTO task_values (task_id, field_id, value) VALUES ($1, $2, $3)
     ON CONFLICT (task_id, field_id) DO UPDATE SET value = EXCLUDED.value`,
    [taskId, fieldId, JSON.stringify(value)],
  );
}

export async function getStoredValue(taskId: string, fieldId: string): Promise<unknown> {
  const rows = await query<{ value: unknown }>(
    `SELECT value FROM task_values WHERE task_id = $1 AND field_id = $2`,
    [taskId, fieldId],
  );
  return rows.length > 0 ? rows[0].value : null;
}

export async function publishTask(taskId: string, serverDate: string): Promise<void> {
  const task = await getTaskRow(taskId);
  if (!task) return;
  const fields = await getFields(task.project_id);
  const stored = await getStoredValues([task.id], fields);
  const teamId = await teamOfProject(task.project_id);
  await publish({
    type: 'task_upserted',
    teamId,
    projectId: task.project_id,
    task: serializeTask(task, fields, stored.get(task.id) ?? new Map(), serverDate),
  });
}

export async function publishRollups(teamId: string): Promise<void> {
  await publish({ type: 'goals_changed', teamId });
  await publish({ type: 'workload_changed', teamId });
}

export async function createTaskRow(input: {
  projectId: string;
  sectionId: string;
  parentId: string | null;
  name: string;
  description?: string;
  position?: number | null;
  assigneeId?: string | null;
  start?: string | null;
  due?: string | null;
  effort?: number | null;
  completed?: boolean;
  recurrence?: string | null;
  createdAt: Date;
}): Promise<TaskRow> {
  const id = newId();
  let position = input.position ?? null;
  if (position === null) {
    position = await nextPosition(input.sectionId, input.parentId);
  } else {
    await makeRoomAt(input.sectionId, input.parentId, position, null);
  }
  await query(
    `INSERT INTO tasks (id, project_id, section_id, parent_id, name, description, position,
       assignee_id, start_date, due_date, effort, completed, recurrence, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [
      id,
      input.projectId,
      input.sectionId,
      input.parentId,
      input.name,
      input.description ?? '',
      position,
      input.assigneeId ?? null,
      input.start ?? null,
      input.due ?? null,
      input.effort ?? null,
      input.completed ?? false,
      input.recurrence ?? null,
      input.createdAt.toISOString(),
    ],
  );
  const row = await getTaskRow(id);
  return row as TaskRow;
}
