import { query } from './db.js';
import { evaluateSource, storedToVal, valToJson, type FieldInfo } from './formula.js';

export interface TaskRow {
  id: string;
  project_id: string;
  section_id: string;
  parent_id: string | null;
  name: string;
  description: string;
  position: number;
  assignee_id: string | null;
  start_date: string | null;
  due_date: string | null;
  effort: string | number | null;
  completed: boolean;
  completed_on: string | null;
  version: number;
  recurrence: string | null;
}

export interface SectionRow {
  id: string;
  project_id: string;
  name: string;
  position: number;
}

export interface FieldRow extends FieldInfo {
  project_id: string;
  options: string[];
  position: number;
}

export type DueStatus = 'overdue' | 'today' | 'later' | 'none';

export const DUE_STATUS_LABEL: Record<DueStatus, string> = {
  overdue: 'Overdue',
  today: 'Due today',
  later: 'Later',
  none: 'No due date',
};

export function dueStatus(task: TaskRow, serverDate: string): DueStatus {
  if (task.completed || !task.due_date) return 'none';
  const due = String(task.due_date).slice(0, 10);
  if (due < serverDate) return 'overdue';
  if (due === serverDate) return 'today';
  return 'later';
}

export function dateOnly(value: string | null): string | null {
  return value ? String(value).slice(0, 10) : null;
}

export function numberOrNull(value: string | number | null): number | null {
  return value === null || value === undefined ? null : Number(value);
}

export async function getSections(projectId: string): Promise<SectionRow[]> {
  return query<SectionRow>(
    `SELECT id, project_id, name, position FROM sections WHERE project_id = $1 ORDER BY position, name`,
    [projectId],
  );
}

export async function getFields(projectId: string): Promise<FieldRow[]> {
  return query<FieldRow>(
    `SELECT id, project_id, name, type, options, formula, position
     FROM fields WHERE project_id = $1 ORDER BY position, name`,
    [projectId],
  );
}

/** Stored custom values keyed by task id, then field name. */
export async function getStoredValues(
  taskIds: string[],
  fields: FieldRow[],
): Promise<Map<string, Map<string, unknown>>> {
  const out = new Map<string, Map<string, unknown>>();
  for (const id of taskIds) out.set(id, new Map());
  if (taskIds.length === 0 || fields.length === 0) return out;
  const byId = new Map(fields.map((f) => [f.id, f]));
  const rows = await query<{ task_id: string; field_id: string; value: unknown }>(
    `SELECT task_id, field_id, value FROM task_values WHERE task_id = ANY($1)`,
    [taskIds],
  );
  for (const row of rows) {
    const field = byId.get(row.field_id);
    const bucket = out.get(row.task_id);
    if (field && bucket) bucket.set(field.name, row.value);
  }
  return out;
}

export function computeValues(
  task: TaskRow,
  fields: FieldRow[],
  stored: Map<string, unknown>,
): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  const ctx = {
    start: dateOnly(task.start_date),
    due: dateOnly(task.due_date),
    effort: numberOrNull(task.effort),
    values: stored,
    fields,
  };
  for (const field of fields) {
    if (field.type === 'formula') {
      values[field.name] = field.formula ? evaluateSource(field.formula, ctx) : null;
    } else {
      const raw = stored.has(field.name) ? stored.get(field.name) : null;
      values[field.name] =
        field.type === 'multi_select'
          ? Array.isArray(raw)
            ? raw
            : []
          : valToJson(storedToVal(raw, field.type));
    }
  }
  return values;
}

export interface TaskJson {
  id: string;
  projectId: string;
  name: string;
  description: string;
  section: string;
  position: number;
  parentId: string | null;
  assigneeId: string | null;
  start: string | null;
  due: string | null;
  effort: number | null;
  completed: boolean;
  version: number;
  recurrence: string | null;
  dueStatus: DueStatus;
  values: Record<string, unknown>;
}

export function serializeTask(
  task: TaskRow,
  fields: FieldRow[],
  stored: Map<string, unknown>,
  serverDate: string,
): TaskJson {
  return {
    id: task.id,
    projectId: task.project_id,
    name: task.name,
    description: task.description,
    section: task.section_id,
    position: task.position,
    parentId: task.parent_id,
    assigneeId: task.assignee_id,
    start: dateOnly(task.start_date),
    due: dateOnly(task.due_date),
    effort: numberOrNull(task.effort),
    completed: task.completed,
    version: task.version,
    recurrence: task.recurrence,
    dueStatus: dueStatus(task, serverDate),
    values: computeValues(task, fields, stored),
  };
}

/** Section order, then position, with subtasks directly after their parent. */
export function orderTasks(rows: TaskRow[], sections: SectionRow[]): TaskRow[] {
  const sectionOrder = new Map(sections.map((s, i) => [s.id, i]));
  const tops = rows
    .filter((t) => t.parent_id === null)
    .sort((a, b) => {
      const sa = sectionOrder.get(a.section_id) ?? 0;
      const sb = sectionOrder.get(b.section_id) ?? 0;
      return sa - sb || a.position - b.position;
    });
  const children = new Map<string, TaskRow[]>();
  for (const row of rows) {
    if (row.parent_id === null) continue;
    const list = children.get(row.parent_id) ?? [];
    list.push(row);
    children.set(row.parent_id, list);
  }
  for (const list of children.values()) list.sort((a, b) => a.position - b.position);
  const out: TaskRow[] = [];
  for (const top of tops) {
    out.push(top);
    for (const child of children.get(top.id) ?? []) out.push(child);
  }
  return out;
}

export async function getTaskRow(id: string): Promise<TaskRow | null> {
  const rows = await query<TaskRow>(`SELECT * FROM tasks WHERE id = $1`, [id]);
  return rows.length > 0 ? rows[0] : null;
}
