import { Response } from 'express';
import { query, withTx } from './db';
import type { PoolClient } from 'pg';
import { now, txNow, txToday } from './clock';
import { publish } from './live';
import { FieldValue, Task, TaskValues } from '../shared/types';
import { EvalValue, evalNode, parse, Steps, toEval, valueToCell, FieldRefValue, EvalEnv, validateFormula, FormulaError } from '../shared/formula';
import { ymdValid } from '../shared/dates';
import { env } from './env';

export interface TaskRow {
  id: string;
  project_id: string;
  name: string;
  description: string;
  section_id: string;
  position: number;
  parent_id: string | null;
  assignee_id: string | null;
  start_date: string | null;
  due_date: string | null;
  effort: number | null;
  completed: boolean;
  version: number;
  recurrence: string | null;
  completed_at: Date | null;
  created_at: Date;
}

export interface FieldRow {
  id: string;
  project_id: string;
  name: string;
  type: 'text' | 'number' | 'date' | 'single_select' | 'multi_select' | 'formula';
  options: string[] | null;
  formula: string | null;
  position: number;
}

export function dueStatus(t: { completed: boolean; due_date: string | null }, today: string): 'overdue' | 'today' | 'later' | 'none' {
  if (t.completed) return 'none';
  if (!t.due_date) return 'none';
  if (t.due_date < today) return 'overdue';
  if (t.due_date === today) return 'today';
  return 'later';
}

export async function projectFields(projectId: string): Promise<FieldRow[]> {
  const r = await query<FieldRow>(`SELECT * FROM fields WHERE project_id = $1 ORDER BY position, created_at`, [projectId]);
  return r.rows.map(normalizeField);
}

export function normalizeField(f: FieldRow): FieldRow {
  return { ...f, options: Array.isArray(f.options) ? (f.options as unknown as string[]) : f.options ? (f.options as unknown as string[]) : null };
}

export async function taskValuesMap(taskId: string): Promise<Record<string, FieldValue>> {
  const r = await query<{ name: string; value: FieldValue }>(
    `SELECT f.name, v.value FROM field_values v JOIN fields f ON f.id = v.field_id WHERE v.task_id = $1`, [taskId]);
  const out: Record<string, FieldValue> = {};
  for (const row of r.rows) out[row.name] = row.value === undefined ? null : row.value;
  return out;
}

export interface EvalTaskContext {
  start: string | null;
  due: string | null;
  effort: number | null;
  assigneeId: string | null;
  values: Record<string, FieldValue>;
  fields: FieldRow[];
}

/**
 * Computes every formula field of one task on the server, sharing one step budget
 * per formula evaluation across referenced formula fields.
 */
export function computeFormulas(ctx: EvalTaskContext): TaskValues {
  const out: Record<string, FieldValue> = { ...ctx.values };
  const getters = new Map<string, FieldValue>();
  for (const f of ctx.fields) {
    if (f.type === 'formula') continue;
    getters.set(f.name, ctx.values[f.name] ?? null);
  }
  getters.set('Start', ctx.start);
  getters.set('Due', ctx.due);
  getters.set('Effort', ctx.effort);
  getters.set('Assignee', ctx.assigneeId);
  const cache = new Map<string, FieldValue>();
  const evaluating = new Set<string>();

  const get = (name: string): FieldRefValue | undefined => {
    if (getters.has(name)) return { value: getters.get(name) as FieldValue, type: 'value' };
    const f = ctx.fields.find(x => x.name === name && x.type === 'formula');
    if (!f) return undefined;
    if (cache.has(name)) return { value: cache.get(name) as FieldValue, type: 'formula' };
    if (evaluating.has(name)) return { value: '#REF', type: 'formula' };
    evaluating.add(name);
    const v = evalFormulaField(f, ctx, cache, evaluating);
    evaluating.delete(name);
    cache.set(name, v);
    return { value: v, type: 'formula' };
  };

  function evalFormulaField(f: FieldRow, c: EvalTaskContext, cache: Map<string, FieldValue>, evaluating: Set<string>): FieldValue {
    if (!f.formula) return null;
    const steps = new Steps(env().limits.formulaMaxSteps);
    const inner: EvalEnv = {
      steps,
      evalFormulaRef: () => ({ kind: 'blank' }),
      get: (name: string) => {
        if (getters.has(name)) return { value: getters.get(name) as FieldValue, type: 'value' };
        const ff = c.fields.find(x => x.name === name && x.type === 'formula');
        if (!ff) return undefined;
        if (cache.has(name)) return { value: cache.get(name) as FieldValue, type: 'formula' };
        if (evaluating.has(name)) return { value: '#REF', type: 'formula' };
        evaluating.add(name);
        const v = evalFormulaField(ff, c, cache, evaluating);
        evaluating.delete(name);
        cache.set(name, v);
        return { value: v, type: 'formula' };
      },
    };
    try {
      const node = parse(f.formula);
      const v = evalNode(node, inner);
      return valueToCell(v);
    } catch (e) {
      if (e instanceof FormulaError) return e.message;
      return '#VALUE';
    }
  }

  for (const f of ctx.fields) {
    if (f.type !== 'formula') continue;
    out[f.name] = get(f.name)!.value;
  }
  return out;
}

export async function taskById(client: PoolClient | null, id: string): Promise<TaskRow | null> {
  const q = `SELECT * FROM tasks WHERE id = $1`;
  const r = client ? await client.query<TaskRow>(q, [id]) : await query<TaskRow>(q, [id]);
  return r.rows[0] ?? null;
}

export async function toTaskJSON(row: TaskRow, today?: string): Promise<Task> {
  const t = today ?? (await nowYMD());
  const fields = await projectFields(row.project_id);
  const raw = await taskValuesMap(row.id);
  const computed = computeFormulas({
    start: row.start_date, due: row.due_date, effort: row.effort,
    assigneeId: row.assignee_id, values: raw, fields,
  });
  const out: Record<string, FieldValue> = {};
  for (const f of fields) out[f.name] = f.type === 'formula' ? (computed[f.name] ?? null) : (raw[f.name] ?? null);
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    description: row.description,
    section: row.section_id,
    position: row.position,
    parentId: row.parent_id,
    assigneeId: row.assignee_id,
    start: row.start_date,
    due: row.due_date,
    effort: row.effort,
    completed: row.completed,
    version: row.version,
    recurrence: row.recurrence,
    dueStatus: dueStatus(row, t),
    values: out,
  };
}

async function nowYMD(): Promise<string> {
  const d = await now();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

export function invalidFormulaMessage(src: string, projectId: string): Promise<string | null> {
  return (async () => {
    const fields = await projectFields(projectId);
    return validateFormula(src, env().limits.formulaMaxChars, null, name => {
      const f = fields.find(x => x.name === name);
      if (!f) return undefined;
      return { id: f.id, name: f.name, type: f.type, formula: f.formula };
    });
  })();
}

export async function validRecurrencePattern(r: string): Promise<boolean> {
  return /^Every week on \w+$/.test(r) || /^Every month on day \d+$/.test(r) || /^Every \d+ days after completion$/.test(r);
}

export function isValidDate(s: unknown): s is string {
  return typeof s === 'string' && ymdValid(s);
}

export function publishTaskChange(taskRow: TaskRow, extra?: { kind?: string }): void {
  void publishAsync(taskRow, extra);
}

async function publishAsync(taskRow: TaskRow, extra?: { kind?: string }): Promise<void> {
  const t = await toTaskJSON(taskRow);
  const r = await query<{ team_id: string }>(`SELECT team_id FROM projects WHERE id = $1`, [taskRow.project_id]);
  const teamId = r.rows[0]?.team_id;
  if (!teamId) return;
  publish({
    teamIds: [teamId], kind: extra?.kind ?? 'task', at: new Date().toISOString(),
    data: { task: t, kind: extra?.kind ?? 'task' },
  });
}

export { withTx };
