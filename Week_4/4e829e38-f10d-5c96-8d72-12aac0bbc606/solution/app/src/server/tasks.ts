/** Tasks, sections and fields: loading, validation, ordering, nesting and saving. */
import { randomUUID } from "node:crypto";
import { config } from "./config.js";
import { dateOf } from "./clock.js";
import { isIsoDate } from "./dates.js";
import type { Queryable, Tx } from "./db.js";
import { evaluateFormulas, type FormulaField } from "./formula.js";
import { invalid, notFound } from "./http.js";
import { parseRepeat } from "./recurrence.js";

export interface Section { id: string; name: string; position: number }
export interface Field extends FormulaField {
  options: string[];
  position: number;
}
export interface ProjectContext {
  id: string;
  teamId: string;
  name: string;
  sections: Section[];
  fields: Field[];
  memberIds: string[];
}

export interface TaskRow {
  id: string;
  projectId: string;
  name: string;
  description: string;
  sectionId: string;
  position: number;
  parentId: string | null;
  assigneeId: string | null;
  start: string | null;
  due: string | null;
  effort: number | null;
  completed: boolean;
  version: number;
  recurrence: string | null;
  values: Record<string, unknown>;
}

export const BUILT_IN_KEYS = ["assignee", "start", "due", "effort"] as const;
export const BUILT_IN_LABELS: Record<string, string> = { assignee: "Assignee", start: "Start", due: "Due", effort: "Effort" };

interface TaskColumns {
  id: string; project_id: string; name: string; description: string; section_id: string; position: number; parent_id: string | null;
  assignee_id: string | null; start_date: string | null; due_date: string | null; effort: number | null; completed: boolean; version: number;
  recurrence: string | null; values: Record<string, unknown>;
}

const TASK_COLUMNS = `id, project_id, name, description, section_id, position, parent_id, assignee_id, start_date, due_date, effort, completed, version, recurrence, values`;

function toRow(r: TaskColumns): TaskRow {
  return {
    id: r.id, projectId: r.project_id, name: r.name, description: r.description, sectionId: r.section_id,
    position: r.position, parentId: r.parent_id, assigneeId: r.assignee_id, start: r.start_date, due: r.due_date,
    effort: r.effort, completed: r.completed, version: r.version, recurrence: r.recurrence, values: r.values,
  };
}

export async function loadProject(db: Queryable, projectId: string): Promise<ProjectContext> {
  const { rows } = await db.query("SELECT id, team_id, name FROM projects WHERE id = $1", [projectId]);
  if (!rows.length) throw notFound();
  // One query at a time: db may be a transaction client, which must not run queries concurrently.
  const sections = await db.query<Section>("SELECT id, name, position FROM sections WHERE project_id = $1 ORDER BY position", [projectId]);
  const fields = await db.query("SELECT id, name, type, options, formula, position FROM fields WHERE project_id = $1 ORDER BY position", [projectId]);
  const members = await db.query("SELECT person_id FROM memberships WHERE team_id = $1", [rows[0].team_id]);
  return {
    id: rows[0].id, teamId: rows[0].team_id, name: rows[0].name,
    sections: sections.rows,
    fields: fields.rows.map((f) => ({ id: f.id, name: f.name, type: f.type, options: f.options, formula: f.formula, position: f.position })),
    memberIds: members.rows.map((m) => m.person_id as string),
  };
}

export async function getTaskRow(db: Queryable, taskId: string, lock = false): Promise<TaskRow> {
  const { rows } = await db.query<TaskColumns>(`SELECT ${TASK_COLUMNS} FROM tasks WHERE id = $1${lock ? " FOR UPDATE" : ""}`, [taskId]);
  if (!rows.length) throw notFound();
  return toRow(rows[0]);
}

/** Every task of a project in display order: sections, then position, subtasks after their parent. */
export async function listTasks(db: Queryable, ctx: ProjectContext): Promise<TaskRow[]> {
  const { rows } = await db.query<TaskColumns>(`SELECT ${TASK_COLUMNS} FROM tasks WHERE project_id = $1`, [ctx.id]);
  const all = rows.map(toRow);
  const sectionOrder = new Map(ctx.sections.map((s) => [s.id, s.position]));
  const children = new Map<string, TaskRow[]>();
  for (const t of all) if (t.parentId) children.set(t.parentId, [...(children.get(t.parentId) ?? []), t]);
  const tops = all
    .filter((t) => !t.parentId)
    .sort((a, b) => (sectionOrder.get(a.sectionId) ?? 0) - (sectionOrder.get(b.sectionId) ?? 0) || a.position - b.position);
  return tops.flatMap((t) => [t, ...(children.get(t.id) ?? []).sort((a, b) => a.position - b.position)]);
}

function dueStatus(task: TaskRow, today: string): "overdue" | "today" | "later" | "none" {
  if (task.completed || !task.due) return "none";
  return task.due < today ? "overdue" : task.due === today ? "today" : "later";
}

export function taskJson(task: TaskRow, ctx: ProjectContext, now: Date) {
  const computed = evaluateFormulas(task, ctx.fields, config.limits.formulaMaxSteps);
  const values: Record<string, unknown> = {};
  for (const field of ctx.fields) {
    values[field.name] = field.type === "formula" ? computed[field.id] ?? null : task.values[field.id] ?? null;
  }
  return {
    id: task.id, projectId: task.projectId, name: task.name, description: task.description, section: task.sectionId,
    position: task.position, parentId: task.parentId, assigneeId: task.assigneeId, start: task.start, due: task.due,
    effort: task.effort, completed: task.completed, version: task.version, recurrence: task.recurrence,
    dueStatus: dueStatus(task, dateOf(now)), values,
  };
}

/* ------------------------------------------------------------------ validation */

export interface Patch {
  name?: string;
  description?: string;
  sectionId?: string;
  position?: number;
  parentId?: string | null;
  assigneeId?: string | null;
  start?: string | null;
  due?: string | null;
  effort?: number | null;
  completed?: boolean;
  recurrence?: string | null;
  values?: Record<string, unknown>;
}

export interface Change {
  field: string;
  label: string;
  to: unknown;
}

const has = (body: Record<string, unknown>, key: string) => Object.prototype.hasOwnProperty.call(body, key);

export function fieldByName(ctx: ProjectContext, name: string): Field | undefined {
  return ctx.fields.find((f) => f.name === name);
}

function checkValue(field: Field, value: unknown): string | null {
  if (value === null || value === "") return null;
  const bad = (message: string) => {
    throw new Error(message);
  };
  try {
    switch (field.type) {
      case "number":
        if (typeof value !== "number" || !Number.isFinite(value)) bad(`${field.name} must be a number`);
        break;
      case "date":
        if (!isIsoDate(value)) bad(`${field.name} must be a date like 2026-03-02`);
        break;
      case "single_select":
        if (typeof value !== "string" || !field.options.includes(value)) bad(`${field.name} must be one of its options`);
        break;
      case "multi_select":
        if (!Array.isArray(value) || value.some((v) => typeof v !== "string" || !field.options.includes(v))) {
          bad(`${field.name} must be some of its options`);
        }
        break;
      case "text":
        if (typeof value !== "string") bad(`${field.name} must be text`);
        break;
      default:
        bad(`${field.name} is a formula and cannot be set`);
    }
  } catch (error) {
    return (error as Error).message;
  }
  return null;
}

function normalizeValue(value: unknown): unknown {
  if (value === null || value === "" || (Array.isArray(value) && value.length === 0)) return null;
  return value;
}

/** Validates a create or patch body into a normalized `Patch`, or throws the 422 field errors. */
export function parsePatch(body: Record<string, unknown>, ctx: ProjectContext, forCreate: boolean): Patch {
  const errors: Record<string, string> = {};
  const patch: Patch = {};
  if (has(body, "name") || forCreate) {
    if (typeof body.name !== "string" || body.name.trim() === "") errors.name = "Enter a task name";
    else patch.name = body.name.trim();
  }
  if (has(body, "description")) {
    if (typeof body.description !== "string") errors.description = "Description must be text";
    else patch.description = body.description;
  }
  const sectionKey = has(body, "section") ? "section" : null;
  if (sectionKey) {
    if (typeof body.section !== "string" || !ctx.sections.some((s) => s.id === body.section)) errors.section = "Choose a section of this project";
    else patch.sectionId = body.section;
  }
  if (has(body, "position")) {
    if (typeof body.position !== "number" || !Number.isInteger(body.position) || body.position < 1) errors.position = "Position must be a whole number from 1";
    else patch.position = body.position;
  }
  if (has(body, "parentId")) {
    if (body.parentId !== null && typeof body.parentId !== "string") errors.parentId = "Tasks nest one level only";
    else patch.parentId = body.parentId as string | null;
  }
  if (has(body, "assigneeId")) {
    if (body.assigneeId !== null && (typeof body.assigneeId !== "string" || !ctx.memberIds.includes(body.assigneeId))) {
      errors.assigneeId = "Choose a member of this team";
    } else patch.assigneeId = body.assigneeId as string | null;
  }
  for (const key of ["start", "due"] as const) {
    if (!has(body, key)) continue;
    const value = body[key];
    if (value !== null && !isIsoDate(value)) errors[key] = "Enter a date like 2026-03-02";
    else patch[key] = value as string | null;
  }
  if (has(body, "effort")) {
    const value = body.effort;
    if (value !== null && (typeof value !== "number" || !Number.isFinite(value) || value < 0)) errors.effort = "Effort must be 0 or more hours";
    else patch.effort = value as number | null;
  }
  if (has(body, "completed")) {
    if (typeof body.completed !== "boolean") errors.completed = "Completed must be true or false";
    else patch.completed = body.completed;
  }
  if (has(body, "recurrence")) {
    if (body.recurrence !== null && (typeof body.recurrence !== "string" || !parseRepeat(body.recurrence))) {
      errors.recurrence = "Use a repeat rule like Every week on Monday";
    } else patch.recurrence = body.recurrence as string | null;
  }
  if (has(body, "values")) {
    const given = body.values;
    if (typeof given !== "object" || given === null || Array.isArray(given)) errors.values = "Values must be an object";
    else {
      patch.values = {};
      for (const [name, value] of Object.entries(given)) {
        const field = fieldByName(ctx, name);
        const problem = field ? checkValue(field, value) : `Unknown field ${name}`;
        if (problem) errors.values = problem;
        else if (field) patch.values[field.id] = normalizeValue(value);
      }
    }
  }
  if (Object.keys(errors).length) throw invalid(errors);
  return patch;
}

/* ------------------------------------------------------------------ nesting and order */

const NEST_ERROR = "Tasks nest one level only";

async function siblingIds(tx: Queryable, task: { projectId: string }, parentId: string | null, sectionId: string, except: string): Promise<string[]> {
  const { rows } = parentId
    ? await tx.query("SELECT id FROM tasks WHERE parent_id = $1 AND id <> $2 ORDER BY position, seq", [parentId, except])
    : await tx.query(
        "SELECT id FROM tasks WHERE project_id = $1 AND parent_id IS NULL AND section_id = $2 AND id <> $3 ORDER BY position, seq",
        [task.projectId, sectionId, except],
      );
  return rows.map((r) => r.id as string);
}

async function renumber(tx: Queryable, ids: string[]): Promise<void> {
  for (const [index, id] of ids.entries()) await tx.query("UPDATE tasks SET position = $2 WHERE id = $1 AND position <> $2", [id, index + 1]);
}

/** The top-level task directly above `task` in its section, when it may be indented under it. */
async function nearestAbove(tx: Queryable, task: TaskRow): Promise<string | null> {
  const { rows } = await tx.query(
    "SELECT id FROM tasks WHERE project_id = $1 AND parent_id IS NULL AND section_id = $2 AND position < $3 ORDER BY position DESC LIMIT 1",
    [task.projectId, task.sectionId, task.position],
  );
  return rows.length ? rows[0].id : null;
}

async function hasSubtasks(tx: Queryable, taskId: string): Promise<boolean> {
  const { rows } = await tx.query("SELECT 1 FROM tasks WHERE parent_id = $1 LIMIT 1", [taskId]);
  return rows.length > 0;
}

/** Where a task lands: the new parent and section, and the 0-based index among its new siblings. */
interface Placement { parentId: string | null; sectionId: string; index: number | null }

async function placement(tx: Queryable, task: TaskRow, patch: Patch): Promise<Placement | null> {
  const nesting = patch.parentId !== undefined;
  if (nesting && patch.parentId === null) {
    if (!task.parentId) throw invalid({ parentId: NEST_ERROR });
    const { rows } = await tx.query("SELECT section_id, position FROM tasks WHERE id = $1", [task.parentId]);
    return { parentId: null, sectionId: rows[0].section_id, index: rows[0].position };
  }
  if (nesting) {
    if (task.parentId || (await hasSubtasks(tx, task.id)) || (await nearestAbove(tx, task)) !== patch.parentId) {
      throw invalid({ parentId: NEST_ERROR });
    }
    return { parentId: patch.parentId!, sectionId: task.sectionId, index: null };
  }
  if (patch.sectionId !== undefined && task.parentId && patch.sectionId !== task.sectionId) {
    throw invalid({ section: "Choose a section of this project" });
  }
  const movesSection = patch.sectionId !== undefined && patch.sectionId !== task.sectionId;
  if (movesSection || patch.position !== undefined) {
    return { parentId: task.parentId, sectionId: patch.sectionId ?? task.sectionId, index: patch.position === undefined ? null : patch.position - 1 };
  }
  return null;
}

async function place(tx: Queryable, task: TaskRow, target: Placement): Promise<void> {
  const oldSiblings = await siblingIds(tx, task, task.parentId, task.sectionId, task.id);
  const newSiblings = target.parentId === task.parentId && target.sectionId === task.sectionId
    ? oldSiblings
    : await siblingIds(tx, task, target.parentId, target.sectionId, task.id);
  const index = Math.min(target.index ?? newSiblings.length, newSiblings.length);
  const next = [...newSiblings.slice(0, index), task.id, ...newSiblings.slice(index)];
  await tx.query("UPDATE tasks SET parent_id = $2, section_id = $3 WHERE id = $1", [task.id, target.parentId, target.sectionId]);
  if (target.sectionId !== task.sectionId) await tx.query("UPDATE tasks SET section_id = $2 WHERE parent_id = $1", [task.id, target.sectionId]);
  if (oldSiblings !== newSiblings) await renumber(tx, oldSiblings);
  await renumber(tx, next);
}

/* ------------------------------------------------------------------ writing */

export interface Actor { name: string }

export async function addHistory(tx: Queryable, taskId: string, text: string, now: Date): Promise<void> {
  await tx.query("INSERT INTO history (task_id, text, created_at) VALUES ($1, $2, $3)", [taskId, text, now]);
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * Saves a validated patch and returns what really changed. The caller runs the rules the
 * changes set off.
 */
export async function applyUpdate(
  tx: Tx, ctx: ProjectContext, current: TaskRow, patch: Patch, actor: Actor, now: Date,
): Promise<{ task: TaskRow; changes: Change[] }> {
  const changes: Change[] = [];
  const next: TaskRow = { ...current, values: { ...current.values } };
  const set = <K extends keyof TaskRow>(key: K, value: TaskRow[K], field: string, label: string) => {
    if (!same(current[key], value)) {
      next[key] = value;
      changes.push({ field, label, to: value });
    }
  };
  if (patch.name !== undefined) set("name", patch.name, "name", "Name");
  if (patch.description !== undefined) set("description", patch.description, "description", "Description");
  if (patch.assigneeId !== undefined) set("assigneeId", patch.assigneeId, "assignee", "Assignee");
  if (patch.start !== undefined) set("start", patch.start, "start", "Start");
  if (patch.due !== undefined) set("due", patch.due, "due", "Due");
  if (patch.effort !== undefined) set("effort", patch.effort, "effort", "Effort");
  if (patch.completed !== undefined) set("completed", patch.completed, "completed", "Completed");
  if (patch.recurrence !== undefined) set("recurrence", patch.recurrence, "recurrence", "Repeat");
  for (const [fieldId, value] of Object.entries(patch.values ?? {})) {
    if (!same(current.values[fieldId], value)) {
      if (value === null) delete next.values[fieldId];
      else next.values[fieldId] = value;
      changes.push({ field: fieldId, label: ctx.fields.find((f) => f.id === fieldId)!.name, to: value });
    }
  }
  if (next.start && next.due && next.due < next.start && (patch.due !== undefined || patch.start !== undefined)) {
    throw invalid({ due: "Due date can't be before the start date" });
  }

  const target = await placement(tx, current, patch);
  let order: Change | null = null;
  if (target) {
    const moved = target.sectionId !== current.sectionId;
    const reparented = target.parentId !== current.parentId;
    await place(tx, current, target);
    const { rows } = await tx.query("SELECT section_id, parent_id, position FROM tasks WHERE id = $1", [current.id]);
    next.sectionId = rows[0].section_id;
    next.parentId = rows[0].parent_id;
    next.position = rows[0].position;
    if (moved) changes.push({ field: "section", label: "Section", to: next.sectionId });
    else if (reparented) changes.push({ field: "parent", label: "Parent", to: next.parentId });
    else if (next.position !== current.position) order = { field: "position", label: "Position", to: next.position };
  }
  if (order) changes.push(order);

  if (changes.length) {
    next.version = current.version + 1;
    await tx.query(
      `UPDATE tasks SET name=$2, description=$3, assignee_id=$4, start_date=$5, due_date=$6, effort=$7, completed=$8,
         recurrence=$9, values=$10, version=$11 WHERE id = $1`,
      [next.id, next.name, next.description, next.assigneeId, next.start, next.due, next.effort, next.completed,
        next.recurrence, JSON.stringify(next.values), next.version],
    );
    for (const change of changes) await addHistory(tx, next.id, `${actor.name} changed ${change.label}`, now);
  }
  return { task: next, changes };
}

export interface NewTask {
  name: string;
  description?: string;
  sectionId: string;
  parentId?: string | null;
  position?: number;
  assigneeId?: string | null;
  start?: string | null;
  due?: string | null;
  effort?: number | null;
  recurrence?: string | null;
  completed?: boolean;
  values?: Record<string, unknown>;
}

export async function insertTask(tx: Tx, ctx: ProjectContext, input: NewTask, actor: Actor, now: Date, id = randomUUID()): Promise<TaskRow> {
  let sectionId = input.sectionId;
  let parentId = input.parentId ?? null;
  if (parentId) {
    const { rows } = await tx.query("SELECT section_id, parent_id, project_id FROM tasks WHERE id = $1", [parentId]);
    if (!rows.length || rows[0].project_id !== ctx.id || rows[0].parent_id) throw invalid({ parentId: NEST_ERROR });
    sectionId = rows[0].section_id;
  }
  if (input.start && input.due && input.due < input.start) throw invalid({ due: "Due date can't be before the start date" });
  const row: TaskRow = {
    id, projectId: ctx.id, name: input.name, description: input.description ?? "", sectionId, position: 1, parentId,
    assigneeId: input.assigneeId ?? null, start: input.start ?? null, due: input.due ?? null, effort: input.effort ?? null,
    completed: input.completed ?? false, version: 1, recurrence: input.recurrence ?? null, values: input.values ?? {},
  };
  await tx.query(
    `INSERT INTO tasks (id, project_id, name, description, section_id, position, parent_id, assignee_id, start_date, due_date,
       effort, completed, version, recurrence, values, created_at)
     VALUES ($1,$2,$3,$4,$5,0,$6,$7,$8,$9,$10,$11,1,$12,$13,$14)`,
    [id, ctx.id, row.name, row.description, sectionId, parentId, row.assigneeId, row.start, row.due, row.effort,
      row.completed, row.recurrence, JSON.stringify(row.values), now],
  );
  const siblings = await siblingIds(tx, row, parentId, sectionId, id);
  const index = Math.min(input.position === undefined ? siblings.length : input.position - 1, siblings.length);
  await renumber(tx, [...siblings.slice(0, index), id, ...siblings.slice(index)]);
  const { rows } = await tx.query("SELECT position FROM tasks WHERE id = $1", [id]);
  row.position = rows[0].position;
  await addHistory(tx, id, `${actor.name} created this task`, now);
  return row;
}

export async function removeTask(tx: Tx, task: TaskRow): Promise<void> {
  await tx.query("DELETE FROM tasks WHERE id = $1", [task.id]);
  const siblings = await siblingIds(tx, task, task.parentId, task.sectionId, task.id);
  await renumber(tx, siblings);
}
