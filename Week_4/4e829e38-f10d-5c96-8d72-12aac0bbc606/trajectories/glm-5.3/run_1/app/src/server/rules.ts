import { PoolClient } from 'pg';
import { query, withTx } from './db';
import { publish } from './live';
import { now, txNow, txMinuteKey } from './clock';
import { env } from './env';
import { toTaskJSON, projectFields, computeFormulas, TaskRow, FieldRow } from './taskjson';
import { triggerText, conditionMet, runDetail, summaryRan, stopEntryText, skipLimitText, skippedConditionsText, fieldName, builtinLabel } from '../shared/rules';
import { FieldValue, TaskValues } from '../shared/types';

export interface TriggerEvent {
  projectId: string;
  type: 'task_added' | 'field_changed' | 'moved_to_section' | 'due_date_arrives' | 'approval_decided';
  taskId: string;
  field?: string;
  value?: string;
  section?: string;
  eventId: string;
}

export interface RunOutcome {
  entries: { depth: number; summary: string; detail: string; ran: boolean }[];
  changedTasks: string[];
}

function randomId(): string {
  return require('crypto').randomUUID();
}

export interface RuleRow {
  id: string;
  name: string;
  trigger: RuleTriggerJson;
  condition: RuleCondJson | null;
  action: RuleActionJson;
  position: number;
  created_at: string;
}

export interface RuleTriggerJson { type: string; field?: string; value?: string; section?: string; }
export interface RuleCondJson { field: string; op: string; value?: string; }
export interface RuleActionJson { type: string; target?: string; value?: string; }

/**
 * The rule chain. A claim row per rule and event makes each rule run exactly
 * once per trigger, whichever instance claims it first.
 */
export async function runRulesForTrigger(client: PoolClient, ev: TriggerEvent): Promise<RunOutcome> {
  const outcome: RunOutcome = { entries: [], changedTasks: [] };
  const rulesR = await client.query<RuleRow>(
    `SELECT id, name, trigger, condition, action, position, created_at FROM rules WHERE project_id = $1 ORDER BY position, created_at`, [ev.projectId]);
  const rules: RuleRow[] = rulesR.rows;
  if (rules.length === 0) return outcome;

  const limits = env().limits;
  const minute = await txMinuteKey(client);
  const queue: { rule: RuleRow; depth: number; taskId: string }[] = [];
  const claimed = new Set<string>();

  const matchTrigger = (rule: RuleRow): boolean => {
    const t = rule.trigger;
    if (t.type !== ev.type) return false;
    if (t.type === 'field_changed' && ev.type === 'field_changed') {
      if (t.field !== ev.field) return false;
      if (t.value !== undefined && t.value !== null && t.value !== ev.value) return false;
    }
    if (t.type === 'moved_to_section' && ev.type === 'moved_to_section') {
      if (t.section !== ev.section) return false;
    }
    return true;
  };

  for (const rule of rules) {
    if (matchTrigger(rule)) queue.push({ rule, depth: 1, taskId: ev.taskId });
  }

  let runCount = await countRunsThisMinute(client, ev.projectId, minute);
  const fields = (await projectFields(ev.projectId)) as FieldRow[];
  const sections = await client.query<{ id: string; name: string }>(
    `SELECT id, name FROM sections WHERE project_id = $1 ORDER BY position`, [ev.projectId]);

  const stoppedDepths = new Set<string>();
  let limitReached = false;

  const processQueue = async (): Promise<void> => {
    const item = queue.shift();
    if (!item) return;
    const { rule, depth, taskId } = item;
    const trig = triggerText(rule.trigger, fields, sections.rows);
    const claimKey = `rule:${ev.eventId}:${rule.id}`;
    const claim = await client.query<{ key: string }>(
      `INSERT INTO claims (key) VALUES ($1) ON CONFLICT (key) DO NOTHING RETURNING key`, [claimKey]);
    if (claim.rows.length === 0) { await processQueue(); return; }
    claimed.add(claimKey);

    if (depth > limits.ruleMaxDepth) {
      outcome.entries.push({
        depth,
        summary: stopEntryText(depth, limits.ruleMaxDepth, rule.name),
        detail: runDetail('stopped', trig, depth, limits.ruleMaxDepth, limits.ruleRunsPerMinute),
        ran: false,
      });
      await processQueue();
      return;
    }

    if (runCount >= limits.ruleRunsPerMinute) {
      if (!limitReached) {
        outcome.entries.push({
          depth,
          summary: skipLimitText(limits.ruleRunsPerMinute),
          detail: runDetail('limit', trig, depth, limits.ruleMaxDepth, limits.ruleRunsPerMinute),
          ran: false,
        });
        limitReached = true;
      }
      await processQueue();
      return;
    }

    const condResult = await checkCondition(client, rule.condition, taskId, fields);
    if (!condResult.met) {
      outcome.entries.push({
        depth,
        summary: skippedConditionsText(rule.name),
        detail: runDetail('notmet', trig, depth, limits.ruleMaxDepth, limits.ruleRunsPerMinute),
        ran: false,
      });
      await processQueue();
      return;
    }

    const summary = await applyAction(client, rule, taskId, ev);
    outcome.entries.push({
      depth,
      summary,
      detail: runDetail(rule.condition ? 'met' : 'none', trig, depth, limits.ruleMaxDepth, limits.ruleRunsPerMinute),
      ran: true,
    });
    outcome.changedTasks.push(taskId);
    runCount++;

    for (const child of rules) {
      if (matchTriggerAfter(child, rule, summary, ev, taskId)) {
        queue.push({ rule: child, depth: depth + 1, taskId });
      }
    }
    await processQueue();
  };

  await processQueue();
  if (outcome.changedTasks.length > 0) {
    const teamR = await client.query<{ team_id: string }>(
      `SELECT team_id FROM projects WHERE id = $1`, [ev.projectId]);
    if (teamR.rows[0]) {
      publish({
        teamIds: [teamR.rows[0].team_id], kind: 'trace', at: new Date().toISOString(),
        data: { tasks: outcome.changedTasks, projectId: ev.projectId, origin: ev.taskId },
      });
    }
  }
  return outcome;
}

function matchTriggerAfter(child: RuleRow, rule: RuleRow, _summary: string, ev: TriggerEvent, _taskId: string): boolean {
  const a = rule.action;
  const t = child.trigger;
  if (a.type === 'add_subtask' && t.type === 'task_added') return true;
  if (a.type === 'set_field' && t.type === 'field_changed' && t.field === a.target && (t.value === undefined || t.value === null || t.value === a.value)) return true;
  if (a.type === 'move_to_section' && t.type === 'moved_to_section' && t.section === a.target) return true;
  if (a.type === 'assign_to' && t.type === 'field_changed' && t.field === 'assignee') return true;
  void _summary; void _taskId;
  return false;
}

async function countRunsThisMinute(client: PoolClient, projectId: string, minute: string): Promise<number> {
  const r = await client.query<{ c: string }>(
    `SELECT count(*)::text AS c FROM rule_runs WHERE project_id = $1 AND summary LIKE '% ran: %' AND to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI') = $2`,
    [projectId, minute]);
  return Number(r.rows[0]?.c ?? 0);
}

async function checkCondition(client: PoolClient, cond: RuleCondJson | null, taskId: string, fields: FieldRow[]): Promise<{ met: boolean }> {
  if (!cond) return { met: true };
  const row = await client.query<TaskRow>(`SELECT * FROM tasks WHERE id = $1`, [taskId]);
  if (!row.rows[0]) return { met: false };
  const task = row.rows[0];
  const values = await loadValues(client, taskId);
  let current: string | null = null;
  if (BUILTIN.includes(cond.field)) {
    current = builtinCurrent(cond.field, task);
  } else {
    const f = fields.find(x => x.id === cond.field);
    if (f) current = valueText(values[f.name] ?? null);
  }
  return { met: conditionMet(cond, { fieldLabel: '', current }) };
}

const BUILTIN = ['assignee', 'start', 'due', 'effort'];

function builtinCurrent(key: string, task: TaskRow): string | null {
  switch (key) {
    case 'assignee': return task.assignee_id;
    case 'start': return task.start_date;
    case 'due': return task.due_date;
    case 'effort': return task.effort === null ? null : String(task.effort);
    default: return null;
  }
}

function valueText(v: FieldValue): string | null {
  if (v === null || v === undefined) return null;
  if (Array.isArray(v)) return v.join(', ');
  return String(v);
}

async function loadValues(client: PoolClient, taskId: string): Promise<Record<string, FieldValue>> {
  const r = await client.query<{ name: string; value: FieldValue }>(
    `SELECT f.name, v.value FROM field_values v JOIN fields f ON f.id = v.field_id WHERE v.task_id = $1`, [taskId]);
  const out: Record<string, FieldValue> = {};
  for (const row of r.rows) out[row.name] = row.value ?? null;
  return out;
}

async function applyAction(client: PoolClient, rule: RuleRow, taskId: string, ev: TriggerEvent): Promise<string> {
  const action = rule.action;
  const fields = (await projectFields(ev.projectId)) as FieldRow[];
  const sections = await client.query<{ id: string; name: string }>(`SELECT id, name FROM sections WHERE project_id = $1 ORDER BY position`, [ev.projectId]);
  const taskRow = (await client.query<TaskRow>(`SELECT * FROM tasks WHERE id = $1`, [taskId])).rows[0];
  switch (action.type) {
    case 'move_to_section': {
      const target = action.target ?? '';
      const count = await client.query<{ c: string }>(
        `SELECT count(*)::text AS c FROM tasks WHERE section_id = $1 AND parent_id IS NULL`, [target]);
      await client.query(`UPDATE tasks SET section_id = $1, position = $2, version = version + 1 WHERE id = $3`, [target, Number(count.rows[0]?.c ?? 0) + 1, taskId]);
      const sname = sections.rows.find(s => s.id === target)?.name ?? '';
      await addHistory(client, taskId, `${rule.name} moved to ${sname}`);
      return summaryRan(rule.name, action, { targetName: sname });
    }
    case 'assign_to': {
      const target = action.target ?? '';
      await client.query(`UPDATE tasks SET assignee_id = $1, version = version + 1 WHERE id = $2`, [target, taskId]);
      const person = await client.query<{ name: string }>(`SELECT name FROM people WHERE id = $1`, [target]);
      await addHistory(client, taskId, `${rule.name} assigned to ${person.rows[0]?.name ?? ''}`);
      return summaryRan(rule.name, action, { targetName: person.rows[0]?.name ?? '' });
    }
    case 'set_field': {
      const target = action.target ?? '';
      const value = action.value ?? '';
      if (BUILTIN.includes(target)) {
        await setBuiltin(client, taskId, target, value, rule.name);
        return summaryRan(rule.name, action, { targetName: builtinLabel(target), valueName: value });
      }
      const f = fields.find(x => x.id === target);
      if (f) {
        await client.query(
          `INSERT INTO field_values (task_id, field_id, value) VALUES ($1,$2,$3)
           ON CONFLICT (task_id, field_id) DO UPDATE SET value = $3`,
          [taskId, f.id, JSON.stringify(coerceForField(f, value))]);
        await client.query(`UPDATE tasks SET version = version + 1 WHERE id = $1`, [taskId]);
        await addHistory(client, taskId, `${rule.name} set ${f.name} to ${value}`);
        return summaryRan(rule.name, action, { targetName: f.name, valueName: value });
      }
      return summaryRan(rule.name, action, { targetName: target, valueName: value });
    }
    case 'add_subtask': {
      const name = action.value ?? 'Subtask';
      const pos = await client.query<{ c: string }>(
        `SELECT count(*)::text AS c FROM tasks WHERE parent_id = $1`, [taskId]);
      const sub = await client.query<TaskRow>(
        `INSERT INTO tasks (project_id, name, section_id, position, parent_id, version)
         VALUES ($1,$2,$3,$4,$5,1) RETURNING *`,
        [taskRow.project_id, name, taskRow.section_id, Number(pos.rows[0]?.c ?? 0) + 1, taskId]);
      await addHistory(client, taskId, `${rule.name} added subtask ${name}`);
      const evSub: TriggerEvent = {
        projectId: taskRow.project_id, type: 'task_added', taskId: sub.rows[0].id,
        eventId: `${ev.eventId}:sub:${randomId()}`,
      };
      await persistRuns(client, taskId, await runRulesForTrigger(client, evSub));
      return summaryRan(rule.name, action, { targetName: '', subName: name });
    }
    case 'send_to_inbox': {
      const target = taskRow.assignee_id;
      let personId: string | null = target;
      if (!personId) {
        const coord = await client.query<{ person_id: string }>(
          `SELECT tm.person_id FROM team_members tm JOIN projects p ON p.team_id = tm.team_id WHERE p.id = $1 AND tm.role = 'coordinator' ORDER BY tm.person_id LIMIT 1`,
          [taskRow.project_id]);
        personId = coord.rows[0]?.person_id ?? null;
      }
      const text = action.value && action.value.length > 0 ? action.value : `${rule.name}: ${taskRow.name}`;
      if (personId) {
        await client.query(`INSERT INTO inbox_items (person_id, text, task_id, kind) VALUES ($1,$2,$3,'rule')`, [personId, text, taskId]);
      }
      return summaryRan(rule.name, action, { targetName: '' });
    }
    default:
      return '';
  }
}

function coerceForField(f: FieldRow, value: string): FieldValue {
  switch (f.type) {
    case 'number': return value === '' ? null : Number(value);
    case 'multi_select': return value === '' ? [] : value.split(',').map(s => s.trim());
    case 'date': return value === '' ? null : value;
    default: return value;
  }
}

async function setBuiltin(client: PoolClient, taskId: string, key: string, value: string, ruleName: string): Promise<void> {
  switch (key) {
    case 'assignee':
      await client.query(`UPDATE tasks SET assignee_id = $1, version = version + 1 WHERE id = $2`, [value, taskId]);
      await addHistory(client, taskId, `${ruleName} changed Assignee`);
      break;
    case 'start':
      await client.query(`UPDATE tasks SET start_date = $1, version = version + 1 WHERE id = $2`, [value, taskId]);
      await addHistory(client, taskId, `${ruleName} changed Start`);
      break;
    case 'due':
      await client.query(`UPDATE tasks SET due_date = $1, version = version + 1 WHERE id = $2`, [value, taskId]);
      await addHistory(client, taskId, `${ruleName} changed Due`);
      break;
    case 'effort':
      await client.query(`UPDATE tasks SET effort = $1, version = version + 1 WHERE id = $2`, [value === '' ? null : Number(value), taskId]);
      await addHistory(client, taskId, `${ruleName} changed Effort`);
      break;
  }
}

export async function addHistory(client: PoolClient, taskId: string, text: string): Promise<void> {
  await client.query(`INSERT INTO task_history (task_id, text) VALUES ($1,$2)`, [taskId, text]);
}

export async function persistRuns(client: PoolClient, originTaskId: string, outcome: RunOutcome): Promise<void> {
  const seqRow = await client.query<{ n: string }>(`SELECT COALESCE(max(run_no),0)::text AS n FROM rule_runs`);
  let runNo = Number(seqRow.rows[0]?.n ?? 0);
  for (const entry of outcome.entries) {
    runNo++;
    await client.query(
      `INSERT INTO rule_runs (task_id, project_id, depth, summary, detail, run_no, origin_task_id)
       VALUES ($1,(SELECT project_id FROM tasks WHERE id = $1),$2,$3,$4,$5,$6)`,
      [originTaskId, entry.depth, entry.summary, entry.detail, runNo, originTaskId]);
  }
}

export async function runAndRecord(client: PoolClient, ev: TriggerEvent, originTaskId: string): Promise<RunOutcome> {
  const outcome = await runRulesForTrigger(client, ev);
  await persistRuns(client, originTaskId, outcome);
  return outcome;
}
