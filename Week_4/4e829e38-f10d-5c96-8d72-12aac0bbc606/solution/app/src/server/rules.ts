/**
 * The rule engine: triggers, conditions, actions, the chain depth, the run limit and the
 * run entries. Every rule decision is made in this file.
 */
import { randomUUID } from "node:crypto";
import { config } from "./config.js";
import { minuteStart, plus } from "./clock.js";
import { isIsoDate } from "./dates.js";
import { claim, type Tx } from "./db.js";
import { ApiError, invalid } from "./http.js";
import { addInboxItem } from "./inbox.js";
import {
  applyUpdate, BUILT_IN_KEYS, BUILT_IN_LABELS, getTaskRow, insertTask, type Change, type Field, type Patch, type ProjectContext, type TaskRow,
} from "./tasks.js";

interface Trigger { type: string; field?: string; value?: unknown; section?: string }
interface Condition { field: string; op: string; value?: unknown }
interface Action { type: string; target?: string; value?: unknown }
export interface Rule { id: string; name: string; position: number; trigger: Trigger; condition: Condition | null; action: Action }

interface TriggerEvent {
  id: string;
  type: string;
  taskId: string;
  field?: string;
  value?: unknown;
  sectionId?: string;
}

const OPS = ["is", "is_not", "is_blank", "is_greater_than"];

function fieldRef(project: ProjectContext, value: unknown): string | null {
  if (typeof value !== "string") return null;
  return (BUILT_IN_KEYS as readonly string[]).includes(value) || project.fields.some((f) => f.id === value) ? value : null;
}

function parseTrigger(project: ProjectContext, value: unknown): Trigger | null {
  const t = value as Record<string, unknown> | null;
  if (!t || typeof t !== "object") return null;
  switch (t.type) {
    case "task_added": case "due_date_arrives": case "approval_decided":
      return { type: t.type };
    case "field_changed": {
      const field = fieldRef(project, t.field);
      if (!field) return null;
      return named(t.value) ? { type: t.type, field, value: t.value } : { type: t.type, field };
    }
    case "moved_to_section":
      return typeof t.section === "string" && project.sections.some((s) => s.id === t.section) ? { type: t.type, section: t.section } : null;
    default:
      return null;
  }
}

function parseAction(project: ProjectContext, value: unknown): Action | null {
  const a = value as Record<string, unknown> | null;
  if (!a || typeof a !== "object") return null;
  switch (a.type) {
    case "set_field": {
      const target = fieldRef(project, a.target);
      return target && a.value !== undefined ? { type: a.type, target, value: a.value } : null;
    }
    case "move_to_section":
      return typeof a.target === "string" && project.sections.some((s) => s.id === a.target) ? { type: a.type, target: a.target } : null;
    case "assign_to":
      return typeof a.target === "string" && project.memberIds.includes(a.target) ? { type: a.type, target: a.target } : null;
    case "add_subtask":
      return typeof a.value === "string" && a.value.trim() ? { type: a.type, value: a.value.trim() } : null;
    case "send_to_inbox":
      return typeof a.value === "string" && a.value.trim() ? { type: a.type, value: a.value.trim() } : { type: a.type };
    default:
      return null;
  }
}

function parseCondition(project: ProjectContext, value: unknown): Condition | null | undefined {
  if (value === undefined || value === null) return null;
  const c = value as Record<string, unknown>;
  const field = fieldRef(project, c.field);
  if (!field || typeof c.op !== "string" || !OPS.includes(c.op)) return undefined;
  return c.op === "is_blank" ? { field, op: c.op } : { field, op: c.op, value: c.value };
}


/** Validates a rule body; the 422 messages are the rule dialog's. */
export function parseRule(body: Record<string, unknown>, project: ProjectContext): { name: string; trigger: Trigger; condition: Condition | null; action: Action } {
  const errors: Record<string, string> = {};
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) errors.name = "Enter a rule name";
  const trigger = parseTrigger(project, body.trigger);
  if (!trigger) errors.trigger = "Choose when the rule runs";
  const action = parseAction(project, body.action);
  if (!action) errors.action = "Choose what happens";
  const condition = parseCondition(project, body.condition);
  if (condition === undefined) errors.condition = "Choose a condition field and value";
  if (!trigger || !action || condition === undefined || !name) throw invalid(errors);
  return { name, trigger, condition, action };
}

/** Everything one user-visible change has set off, gathered for publishing at the end. */
export interface Chain {
  ctx: ProjectContext;
  now: Date;
  rules: Rule[];
  people: Map<string, string>;
  trace: string[];
  touched: Set<string>;
  withRuns: Set<string>;
}

async function loadRules(tx: Tx, projectId: string): Promise<Rule[]> {
  const { rows } = await tx.query("SELECT id, name, position, trigger, condition, action FROM rules WHERE project_id = $1 ORDER BY position, seq", [projectId]);
  return rows;
}

export async function newChain(tx: Tx, ctx: ProjectContext, now: Date): Promise<Chain> {
  const people = await tx.query("SELECT p.id, p.name FROM people p JOIN memberships m ON m.person_id = p.id WHERE m.team_id = $1", [ctx.teamId]);
  return {
    ctx, now, rules: await loadRules(tx, ctx.id), people: new Map(people.rows.map((p): [string, string] => [p.id, p.name])),
    trace: [], touched: new Set(), withRuns: new Set(),
  };
}

const fieldLabel = (chain: Chain, key: string): string => BUILT_IN_LABELS[key] ?? chain.ctx.fields.find((f) => f.id === key)?.name ?? key;
const sectionName = (chain: Chain, id: unknown): string => chain.ctx.sections.find((s) => s.id === id)?.name ?? String(id);

function valueText(chain: Chain, key: string, value: unknown): string {
  if (key === "assignee") return chain.people.get(String(value)) ?? String(value);
  return Array.isArray(value) ? value.join(", ") : String(value);
}

function triggerText(chain: Chain, trigger: Trigger): string {
  switch (trigger.type) {
    case "task_added":
      return "Task added";
    case "field_changed": {
      const base = `Field changed ${fieldLabel(chain, trigger.field ?? "")}`;
      return named(trigger.value) ? `${base} to ${valueText(chain, trigger.field ?? "", trigger.value)}` : base;
    }
    case "moved_to_section":
      return `Moved to section ${sectionName(chain, trigger.section)}`;
    case "due_date_arrives":
      return "Due date arrives";
    default:
      return "Approval decided";
  }
}

function matches(rule: Rule, event: TriggerEvent): boolean {
  const { trigger } = rule;
  if (trigger.type !== event.type) return false;
  if (trigger.type === "field_changed") {
    if (trigger.field !== event.field) return false;
    if (!named(trigger.value)) return true;
    return Array.isArray(event.value) ? event.value.includes(trigger.value) : event.value === trigger.value;
  }
  if (trigger.type === "moved_to_section") return trigger.section === event.sectionId;
  return true;
}

function currentValue(task: TaskRow, key: string): unknown {
  switch (key) {
    case "assignee": return task.assigneeId;
    case "start": return task.start;
    case "due": return task.due;
    case "effort": return task.effort;
    default: return task.values[key] ?? null;
  }
}

/** A rule names a value when it is not undefined, null or empty. */
const named = (v: unknown): boolean => v !== undefined && v !== null && v !== "";

const blank = (v: unknown) => v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);

function conditionHolds(condition: Condition | null, task: TaskRow): boolean {
  if (!condition) return true;
  const actual = currentValue(task, condition.field);
  const wanted = condition.value;
  switch (condition.op) {
    case "is": return Array.isArray(actual) ? actual.includes(wanted) : String(actual ?? "") === String(wanted ?? "");
    case "is_not": return Array.isArray(actual) ? !actual.includes(wanted) : String(actual ?? "") !== String(wanted ?? "");
    case "is_blank": return blank(actual);
    case "is_greater_than": {
      if (blank(actual) || blank(wanted)) return false;
      const bothNumbers = !Number.isNaN(Number(actual)) && !Number.isNaN(Number(wanted));
      return bothNumbers ? Number(actual) > Number(wanted) : String(actual) > String(wanted);
    }
    default: return false;
  }
}

function summaryOf(chain: Chain, rule: Rule): string {
  const { action } = rule;
  switch (action.type) {
    case "move_to_section": return `${rule.name} ran: moved to ${sectionName(chain, action.target)}`;
    case "assign_to": return `${rule.name} ran: assigned to ${chain.people.get(String(action.target)) ?? action.target}`;
    case "set_field": return `${rule.name} ran: set ${fieldLabel(chain, action.target ?? "")} to ${valueText(chain, action.target ?? "", action.value)}`;
    case "add_subtask": return `${rule.name} ran: added subtask ${action.value}`;
    default: return `${rule.name} ran: sent to inbox`;
  }
}

async function record(tx: Tx, chain: Chain, task: TaskRow, depth: number, summary: string, detail: string, counted: boolean): Promise<void> {
  await tx.query(
    "INSERT INTO rule_runs (project_id, task_id, depth, summary, detail, counted, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)",
    [chain.ctx.id, task.id, depth, summary, detail, counted, chain.now],
  );
  chain.withRuns.add(task.id);
}

async function runsThisMinute(tx: Tx, chain: Chain): Promise<number> {
  const minute = minuteStart(chain.now);
  const { rows } = await tx.query(
    "SELECT count(*)::int AS n FROM rule_runs WHERE project_id = $1 AND counted AND created_at >= $2 AND created_at < $3",
    [chain.ctx.id, minute, plus(minute, 60_000)],
  );
  return rows[0].n;
}

function fieldPatch(field: Field | undefined, key: string, raw: unknown): Patch | null {
  if (key === "assignee") return { assigneeId: blank(raw) ? null : String(raw) };
  if (key === "start" || key === "due") return blank(raw) ? { [key]: null } : isIsoDate(raw) ? { [key]: raw } : null;
  if (key === "effort") return blank(raw) ? { effort: null } : Number.isFinite(Number(raw)) ? { effort: Number(raw) } : null;
  if (!field || field.type === "formula") return null;
  if (blank(raw)) return { values: { [field.id]: null } };
  if (field.type === "number") return Number.isFinite(Number(raw)) ? { values: { [field.id]: Number(raw) } } : null;
  if (field.type === "multi_select") return { values: { [field.id]: Array.isArray(raw) ? raw : [raw] } };
  return { values: { [field.id]: raw } };
}

async function applyAction(tx: Tx, chain: Chain, rule: Rule, task: TaskRow, depth: number): Promise<void> {
  const { action } = rule;
  const actor = { name: rule.name };
  const change = async (patch: Patch) => {
    const fresh = await getTaskRow(tx, task.id, true);
    try {
      const result = await applyUpdate(tx, chain.ctx, fresh, patch, actor, chain.now);
      chain.touched.add(task.id);
      await fireChanges(tx, chain, result.task, result.changes, depth);
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
    }
  };
  switch (action.type) {
    case "set_field": {
      const key = action.target ?? "";
      const patch = fieldPatch(chain.ctx.fields.find((f) => f.id === key), key, action.value);
      if (patch) await change(patch);
      break;
    }
    case "move_to_section":
      await change({ sectionId: action.target });
      break;
    case "assign_to":
      await change({ assigneeId: action.target ?? null });
      break;
    case "add_subtask": {
      const fresh = await getTaskRow(tx, task.id);
      const parentId = fresh.parentId ?? fresh.id;
      const parent = fresh.parentId ? await getTaskRow(tx, parentId) : fresh;
      const child = await insertTask(tx, chain.ctx, { name: String(action.value), sectionId: parent.sectionId, parentId }, actor, chain.now);
      chain.touched.add(child.id);
      await fireAdded(tx, chain, child, depth);
      break;
    }
    default: {
      const fresh = await getTaskRow(tx, task.id);
      const recipients = fresh.assigneeId
        ? [fresh.assigneeId]
        : (await tx.query("SELECT person_id FROM memberships WHERE team_id = $1 AND role = 'coordinator'", [chain.ctx.teamId])).rows.map((r) => r.person_id as string);
      const text = blank(action.value) ? `${rule.name}: ${fresh.name}` : String(action.value);
      for (const personId of recipients) await addInboxItem(tx, { personId, text, taskId: fresh.id, kind: "note" }, chain.now);
    }
  }
}

/** Runs every rule the event matches, in position order, each followed by what it set off. */
async function runRules(tx: Tx, chain: Chain, event: TriggerEvent, depth: number): Promise<void> {
  const limits = config.limits;
  for (const rule of chain.rules.filter((r) => matches(r, event))) {
    if (!(await claim(tx, `rule:${rule.id}:${event.id}`))) continue;
    const task = await getTaskRow(tx, event.taskId);
    const at = depth + 1;
    const trigger = triggerText(chain, rule.trigger);
    if (at > limits.ruleMaxDepth) {
      await record(tx, chain, task, at, `Stopped: chain depth limit ${limits.ruleMaxDepth} reached at ${rule.name}`,
        `Trigger: ${trigger}. Not run: depth ${at} is deeper than ${limits.ruleMaxDepth}`, false);
    } else if (!conditionHolds(rule.condition, task)) {
      await record(tx, chain, task, at, `${rule.name} skipped: conditions not met`, `Trigger: ${trigger}. Conditions: not met`, false);
    } else if ((await runsThisMinute(tx, chain)) >= limits.ruleRunsPerMinute) {
      await record(tx, chain, task, at, `Skipped: rule run limit ${limits.ruleRunsPerMinute} per minute reached`,
        `Trigger: ${trigger}. Not run: ${limits.ruleRunsPerMinute} runs this minute`, false);
    } else {
      await record(tx, chain, task, at, summaryOf(chain, rule), `Trigger: ${trigger}. Conditions: ${rule.condition ? "met" : "none"}`, true);
      if (!chain.trace.includes(task.id)) chain.trace.push(task.id);
      await applyAction(tx, chain, rule, task, at);
    }
  }
}

export async function fireAdded(tx: Tx, chain: Chain, task: TaskRow, depth: number): Promise<void> {
  await runRules(tx, chain, { id: randomUUID(), type: "task_added", taskId: task.id }, depth);
}

export async function fireChanges(tx: Tx, chain: Chain, task: TaskRow, changes: Change[], depth: number): Promise<void> {
  for (const change of changes) {
    const isSection = change.field === "section";
    const isField = ["assignee", "start", "due", "effort"].includes(change.field) || chain.ctx.fields.some((f) => f.id === change.field);
    if (!isSection && !isField) continue;
    await runRules(tx, chain, {
      id: randomUUID(), type: isSection ? "moved_to_section" : "field_changed", taskId: task.id,
      ...(isSection ? { sectionId: change.to as string } : { field: change.field, value: change.to }),
    }, depth);
  }
}

export async function fireApproval(tx: Tx, chain: Chain, task: TaskRow): Promise<void> {
  await runRules(tx, chain, { id: randomUUID(), type: "approval_decided", taskId: task.id }, 0);
}

export async function fireDue(tx: Tx, chain: Chain, task: TaskRow): Promise<void> {
  await runRules(tx, chain, { id: `due:${task.id}:${task.due}`, type: "due_date_arrives", taskId: task.id }, 0);
}
