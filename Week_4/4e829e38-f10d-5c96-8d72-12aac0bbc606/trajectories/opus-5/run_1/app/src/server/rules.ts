import { claim, newId, query } from './db.js';
import { config } from './config.js';
import { publish } from './events.js';
import {
  dateOnly,
  getFields,
  getSections,
  getTaskRow,
  numberOrNull,
  type FieldRow,
  type SectionRow,
  type TaskRow,
} from './model.js';
import {
  addHistory,
  bumpVersion,
  createTaskRow,
  getStoredValue,
  publishTask,
  setStoredValue,
  teamOfProject,
  type TriggerEvent,
} from './taskops.js';

export interface RuleTrigger {
  type: 'task_added' | 'field_changed' | 'moved_to_section' | 'due_date_arrives' | 'approval_decided';
  field?: string;
  value?: string | null;
  section?: string;
}

export interface RuleCondition {
  field: string;
  op: 'is' | 'is_not' | 'is_blank' | 'is_greater_than';
  value?: string | null;
}

export interface RuleAction {
  type: 'set_field' | 'move_to_section' | 'assign_to' | 'add_subtask' | 'send_to_inbox';
  target?: string;
  value?: string | null;
}

export interface RuleRow {
  id: string;
  project_id: string;
  name: string;
  position: number;
  trigger: RuleTrigger;
  condition: RuleCondition | null;
  action: RuleAction;
  created_at: string;
}

interface ChainState {
  ended: boolean;
  changed: string[];
  entries: number;
}

interface Context {
  projectId: string;
  teamId: string;
  now: Date;
  serverDate: string;
  fields: FieldRow[];
  sections: SectionRow[];
  people: Map<string, string>;
}

export function triggerText(rule: RuleRow, ctx: Context): string {
  const t = rule.trigger;
  switch (t.type) {
    case 'task_added':
      return 'Task added';
    case 'field_changed': {
      const label = fieldName(ctx, t.field ?? '');
      return t.value === undefined || t.value === null || t.value === ''
        ? `Field changed ${label}`
        : `Field changed ${label} to ${t.value}`;
    }
    case 'moved_to_section':
      return `Moved to section ${sectionName(ctx, t.section ?? '')}`;
    case 'due_date_arrives':
      return 'Due date arrives';
    case 'approval_decided':
      return 'Approval decided';
  }
}

const BUILT_IN: Record<string, string> = {
  assignee: 'Assignee',
  start: 'Start',
  due: 'Due',
  effort: 'Effort',
};

function fieldName(ctx: Context, key: string): string {
  if (key in BUILT_IN) return BUILT_IN[key];
  const field = ctx.fields.find((f) => f.id === key);
  return field ? field.name : key;
}

function sectionName(ctx: Context, id: string): string {
  const section = ctx.sections.find((s) => s.id === id);
  return section ? section.name : id;
}

async function loadContext(projectId: string, now: Date): Promise<Context> {
  const teamId = await teamOfProject(projectId);
  const people = new Map<string, string>();
  const rows = await query<{ id: string; name: string }>(
    `SELECT p.id, p.name FROM people p JOIN memberships m ON m.person_id = p.id WHERE m.team_id = $1`,
    [teamId],
  );
  for (const row of rows) people.set(row.id, row.name);
  return {
    projectId,
    teamId,
    now,
    serverDate: now.toISOString().slice(0, 10),
    fields: await getFields(projectId),
    sections: await getSections(projectId),
    people,
  };
}

async function matchingRules(ctx: Context, event: TriggerEvent): Promise<RuleRow[]> {
  const rules = await query<RuleRow>(
    `SELECT * FROM rules WHERE project_id = $1 ORDER BY position, created_at`,
    [ctx.projectId],
  );
  return rules.filter((rule) => {
    const t = rule.trigger;
    if (t.type !== event.kind) return false;
    if (t.type === 'field_changed') {
      if (t.field !== event.field) return false;
      if (t.value === undefined || t.value === null || t.value === '') return true;
      return String(event.value ?? '') === String(t.value);
    }
    if (t.type === 'moved_to_section') return t.section === event.section;
    return true;
  });
}

async function currentValue(ctx: Context, task: TaskRow, key: string): Promise<unknown> {
  switch (key) {
    case 'assignee':
      return task.assignee_id;
    case 'start':
      return dateOnly(task.start_date);
    case 'due':
      return dateOnly(task.due_date);
    case 'effort':
      return numberOrNull(task.effort);
    default:
      return getStoredValue(task.id, key);
  }
}

function isBlank(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    value === '' ||
    (Array.isArray(value) && value.length === 0)
  );
}

async function conditionsMet(
  ctx: Context,
  rule: RuleRow,
  task: TaskRow,
): Promise<boolean> {
  const condition = rule.condition;
  if (!condition || !condition.op) return true;
  const actual = await currentValue(ctx, task, condition.field);
  const expected = condition.value ?? null;
  switch (condition.op) {
    case 'is':
      return String(actual ?? '') === String(expected ?? '');
    case 'is_not':
      return String(actual ?? '') !== String(expected ?? '');
    case 'is_blank':
      return isBlank(actual);
    case 'is_greater_than': {
      const a = Number(actual);
      const b = Number(expected);
      if (Number.isFinite(a) && Number.isFinite(b)) return a > b;
      return String(actual ?? '') > String(expected ?? '');
    }
  }
}

async function writeEntry(
  ctx: Context,
  taskId: string,
  ruleId: string | null,
  depth: number,
  summary: string,
  detail: string,
  counted: boolean,
): Promise<void> {
  const id = newId();
  await query(
    `INSERT INTO rule_runs (id, task_id, project_id, rule_id, depth, summary, detail, counted, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [id, taskId, ctx.projectId, ruleId, depth, summary, detail, counted, ctx.now.toISOString()],
  );
  await publish({
    type: 'rule_run',
    teamId: ctx.teamId,
    projectId: ctx.projectId,
    taskId,
    run: { id, depth, summary, detail, createdAt: ctx.now.toISOString() },
  });
}

async function countedRunsThisMinute(ctx: Context): Promise<number> {
  const minute = new Date(ctx.now);
  minute.setUTCSeconds(0, 0);
  const end = new Date(minute.getTime() + 60000);
  const rows = await query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM rule_runs
     WHERE project_id = $1 AND counted = true AND created_at >= $2 AND created_at < $3`,
    [ctx.projectId, minute.toISOString(), end.toISOString()],
  );
  return Number(rows[0].count);
}

async function applyAction(
  ctx: Context,
  rule: RuleRow,
  task: TaskRow,
): Promise<{ summary: string; events: TriggerEvent[] }> {
  const action = rule.action;
  const events: TriggerEvent[] = [];
  const stamp = `${rule.id}:${ctx.now.getTime()}:${task.id}`;

  switch (action.type) {
    case 'move_to_section': {
      const sectionId = action.target ?? '';
      const label = sectionName(ctx, sectionId);
      if (task.section_id !== sectionId) {
        const rows = await query<{ max: number | null }>(
          `SELECT MAX(position) AS max FROM tasks WHERE section_id = $1 AND parent_id IS NULL`,
          [sectionId],
        );
        await query(`UPDATE tasks SET section_id = $1, position = $2 WHERE id = $3`, [
          sectionId,
          (rows[0].max ?? 0) + 1,
          task.id,
        ]);
        await query(`UPDATE tasks SET section_id = $1 WHERE parent_id = $2`, [sectionId, task.id]);
        await bumpVersion(task.id);
        await addHistory(task.id, `${rule.name} changed Section`, ctx.now);
        events.push({
          taskId: task.id,
          kind: 'moved_to_section',
          section: sectionId,
          key: `${stamp}:section:${sectionId}`,
        });
      }
      return { summary: `${rule.name} ran: moved to ${label}`, events };
    }
    case 'assign_to': {
      const personId = action.target ?? null;
      const label = personId ? (ctx.people.get(personId) ?? personId) : 'nobody';
      if (task.assignee_id !== personId) {
        await query(`UPDATE tasks SET assignee_id = $1 WHERE id = $2`, [personId, task.id]);
        await bumpVersion(task.id);
        await addHistory(task.id, `${rule.name} changed Assignee`, ctx.now);
        events.push({
          taskId: task.id,
          kind: 'field_changed',
          field: 'assignee',
          value: personId,
          key: `${stamp}:assignee:${personId}`,
        });
      }
      return { summary: `${rule.name} ran: assigned to ${label}`, events };
    }
    case 'set_field': {
      const key = action.target ?? '';
      const label = fieldName(ctx, key);
      const raw = action.value ?? null;
      const before = await currentValue(ctx, task, key);
      let after: unknown = raw;
      if (key === 'effort') {
        after = raw === null || raw === '' ? null : Number(raw);
        await query(`UPDATE tasks SET effort = $1 WHERE id = $2`, [after, task.id]);
      } else if (key === 'start' || key === 'due') {
        after = raw === '' ? null : raw;
        await query(
          key === 'start'
            ? `UPDATE tasks SET start_date = $1 WHERE id = $2`
            : `UPDATE tasks SET due_date = $1 WHERE id = $2`,
          [after, task.id],
        );
      } else if (key === 'assignee') {
        await query(`UPDATE tasks SET assignee_id = $1 WHERE id = $2`, [after, task.id]);
      } else {
        const field = ctx.fields.find((f) => f.id === key);
        if (field && field.type === 'multi_select') {
          after = raw === null || raw === '' ? [] : String(raw).split(',').map((p) => p.trim());
        } else if (field && field.type === 'number') {
          after = raw === null || raw === '' ? null : Number(raw);
        }
        await setStoredValue(task.id, key, after);
      }
      if (String(before ?? '') !== String(after ?? '')) {
        await bumpVersion(task.id);
        await addHistory(task.id, `${rule.name} changed ${label}`, ctx.now);
        events.push({
          taskId: task.id,
          kind: 'field_changed',
          field: key,
          value: after,
          key: `${stamp}:${key}:${String(after)}`,
        });
      }
      return { summary: `${rule.name} ran: set ${label} to ${raw ?? ''}`, events };
    }
    case 'add_subtask': {
      const name = action.value ?? 'Subtask';
      const parentId = task.parent_id ?? task.id;
      const created = await createTaskRow({
        projectId: ctx.projectId,
        sectionId: task.section_id,
        parentId,
        name,
        createdAt: ctx.now,
      });
      await addHistory(task.id, `${rule.name} changed Subtasks`, ctx.now);
      events.push({
        taskId: created.id,
        kind: 'task_added',
        key: `${stamp}:subtask:${created.id}`,
      });
      return { summary: `${rule.name} ran: added subtask ${name}`, events };
    }
    case 'send_to_inbox': {
      const text = action.value && action.value !== '' ? action.value : `${rule.name}: ${task.name}`;
      const recipients: string[] = [];
      if (task.assignee_id) recipients.push(task.assignee_id);
      else {
        const rows = await query<{ person_id: string }>(
          `SELECT person_id FROM memberships WHERE team_id = $1 AND role = 'coordinator'`,
          [ctx.teamId],
        );
        for (const row of rows) recipients.push(row.person_id);
      }
      for (const personId of recipients) {
        const id = newId();
        await query(
          `INSERT INTO inbox_items (id, person_id, team_id, text, task_id, kind, created_at)
           VALUES ($1,$2,$3,$4,$5,'rule',$6)`,
          [id, personId, ctx.teamId, text, task.id, ctx.now.toISOString()],
        );
        await publishInbox(personId, ctx.teamId, id, text, task.id, 'rule', ctx.now);
      }
      return { summary: `${rule.name} ran: sent to inbox`, events };
    }
  }
}

export async function publishInbox(
  personId: string,
  teamId: string,
  id: string,
  text: string,
  taskId: string | null,
  kind: string,
  at: Date,
): Promise<void> {
  const rows = await query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM inbox_items WHERE person_id = $1 AND read = false AND archived = false`,
    [personId],
  );
  await publish({
    type: 'inbox_item',
    teamId,
    personId,
    unread: Number(rows[0].count),
    item: { id, text, taskId, kind, read: false, createdAt: at.toISOString() },
  });
}

async function process(
  ctx: Context,
  event: TriggerEvent,
  depth: number,
  state: ChainState,
): Promise<void> {
  if (state.ended) return;
  const rules = await matchingRules(ctx, event);
  for (const rule of rules) {
    if (state.ended) return;
    if (!(await claim(`rule:${rule.id}:${event.key}`))) continue;
    const task = await getTaskRow(event.taskId);
    if (!task) continue;
    const trigger = triggerText(rule, ctx);

    if (depth > config.ruleMaxDepth) {
      await writeEntry(
        ctx,
        task.id,
        rule.id,
        depth,
        `Stopped: chain depth limit ${config.ruleMaxDepth} reached at ${rule.name}`,
        `Trigger: ${trigger}. Not run: depth ${depth} is deeper than ${config.ruleMaxDepth}`,
        false,
      );
      state.ended = true;
      return;
    }

    const hasCondition = Boolean(rule.condition && rule.condition.op);
    if (hasCondition && !(await conditionsMet(ctx, rule, task))) {
      await writeEntry(
        ctx,
        task.id,
        rule.id,
        depth,
        `${rule.name} skipped: conditions not met`,
        `Trigger: ${trigger}. Conditions: not met`,
        false,
      );
      continue;
    }

    if ((await countedRunsThisMinute(ctx)) >= config.ruleRunsPerMinute) {
      await writeEntry(
        ctx,
        task.id,
        rule.id,
        depth,
        `Skipped: rule run limit ${config.ruleRunsPerMinute} per minute reached`,
        `Trigger: ${trigger}. Not run: ${config.ruleRunsPerMinute} runs this minute`,
        false,
      );
      state.ended = true;
      return;
    }

    const result = await applyAction(ctx, rule, task);
    await writeEntry(
      ctx,
      task.id,
      rule.id,
      depth,
      result.summary,
      `Trigger: ${trigger}. Conditions: ${hasCondition ? 'met' : 'none'}`,
      true,
    );
    if (!state.changed.includes(task.id)) state.changed.push(task.id);
    await publishTask(task.id, ctx.serverDate);
    for (const next of result.events) {
      if (!state.changed.includes(next.taskId)) state.changed.push(next.taskId);
      await publishTask(next.taskId, ctx.serverDate);
      await process(ctx, next, depth + 1, state);
    }
  }
}

/**
 * The one place the rule chain, its depth and its run limit are decided.
 * The user's own change is depth 0, so the rules it sets off run at depth 1.
 */
export async function runChain(
  projectId: string,
  events: TriggerEvent[],
  now: Date,
): Promise<string[]> {
  const ctx = await loadContext(projectId, now);
  const state: ChainState = { ended: false, changed: [], entries: 0 };
  for (const event of events) {
    await process(ctx, event, 1, state);
  }
  if (state.changed.length > 0) {
    await publish({
      type: 'rule_trace',
      teamId: ctx.teamId,
      projectId,
      taskIds: state.changed,
    });
  }
  return state.changed;
}
