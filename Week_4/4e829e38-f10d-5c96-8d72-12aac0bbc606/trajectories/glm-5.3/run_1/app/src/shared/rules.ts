import { addDays } from './dates';

/**
 * Rule engine domain: triggers, conditions, actions, chain depth, run limit,
 * and the text formats of the Rule runs panel. All published strings live here.
 */

export const BUILTIN_KEYS = ['assignee', 'start', 'due', 'effort'] as const;
export type BuiltinKey = typeof BUILTIN_KEYS[number];

export function builtinLabel(key: string): string {
  switch (key) {
    case 'assignee': return 'Assignee';
    case 'start': return 'Start';
    case 'due': return 'Due';
    case 'effort': return 'Effort';
    default: return key;
  }
}

export interface FieldLike { id: string; name: string; type: string; }
export interface SectionLike { id: string; name: string; }
export interface PersonLike { id: string; name: string; }

export function triggerText(t: { type: string; field?: string; value?: string; section?: string }, fields: FieldLike[], sections: SectionLike[]): string {
  switch (t.type) {
    case 'task_added': return 'Task added';
    case 'field_changed': {
      const fname = fieldName(t.field!, fields);
      const base = `Field changed ${fname}`;
      return t.value !== undefined && t.value !== null ? `${base} to ${t.value}` : base;
    }
    case 'moved_to_section': {
      const s = sections.find(x => x.id === t.section);
      return `Moved to section ${s ? s.name : ''}`;
    }
    case 'due_date_arrives': return 'Due date arrives';
    case 'approval_decided': return 'Approval decided';
    default: return '';
  }
}

export function fieldName(fieldId: string, fields: FieldLike[]): string {
  const f = fields.find(x => x.id === fieldId);
  return f ? f.name : builtinLabel(fieldId);
}

export interface RunEntry {
  depth: number;
  summary: string;
  detail: string;
  ran: boolean;
}

export function runDetail(kind: 'met' | 'none' | 'notmet' | 'stopped' | 'limit', trig: string, d: number, maxDepth: number, limit: number): string {
  switch (kind) {
    case 'met': return `Trigger: ${trig}. Conditions: met`;
    case 'none': return `Trigger: ${trig}. Conditions: none`;
    case 'notmet': return `Trigger: ${trig}. Conditions: not met`;
    case 'stopped': return `Trigger: ${trig}. Not run: depth ${d} is deeper than ${maxDepth}`;
    case 'limit': return `Trigger: ${trig}. Not run: ${limit} runs this minute`;
  }
  return '';
}

export interface ActionParts { targetName: string; }

export function summaryRan(ruleName: string, action: { type: string; target?: string; value?: string }, resolved: { targetName: string; valueName?: string; subName?: string }): string {
  switch (action.type) {
    case 'move_to_section': return `${ruleName} ran: moved to ${resolved.targetName}`;
    case 'assign_to': return `${ruleName} ran: assigned to ${resolved.targetName}`;
    case 'set_field': return `${ruleName} ran: set ${resolved.targetName} to ${resolved.valueName ?? action.value}`;
    case 'add_subtask': return `${ruleName} ran: added subtask ${resolved.subName ?? action.value}`;
    case 'send_to_inbox': return `${ruleName} ran: sent to inbox`;
  }
  return '';
}

export function conditionMet(
  cond: { field: string; op: string; value?: string } | null,
  ctx: { fieldLabel: string; current: string | null },
): boolean {
  if (!cond) return true;
  const cur = ctx.current;
  switch (cond.op) {
    case 'is_blank': return cur === null || cur === '' || (Array.isArray(cur) && (cur as unknown[]).length === 0);
    case 'is': return cond.value !== undefined && cur === cond.value;
    case 'is_not': return !(cond.value !== undefined && cur === cond.value);
    case 'is_greater_than': {
      const c = Number(cur), v = Number(cond.value);
      return cur !== null && Number.isFinite(c) && Number.isFinite(v) && c > v;
    }
    default: return true;
  }
}

export function stopEntryText(depth: number, maxDepth: number, ruleName: string): string {
  return `Stopped: chain depth limit ${maxDepth} reached at ${ruleName}`;
}

export function skipLimitText(limit: number): string {
  return `Skipped: rule run limit ${limit} per minute reached`;
}

export function skippedConditionsText(ruleName: string): string {
  return `${ruleName} skipped: conditions not met`;
}

/**
 * Successor scheduling for recurring tasks, and due-by-clock rules.
 */
export function successorDue(recurrence: string, prevDue: string, completedOn: string | null, clockDate: string): string | null {
  const weekly = /^Every week on (\w+)$/.exec(recurrence);
  if (weekly) {
    return nextWeekly(prevDue, weekly[1]);
  }
  const monthly = /^Every month on day (\d+)$/.exec(recurrence);
  if (monthly) return nextMonthly(prevDue, Number(monthly[1]));
  const after = /^Every (\d+) days after completion$/.exec(recurrence);
  if (after && completedOn) return addDays(completedOn, Number(after[1]));
  if (after) return null;
  return null;
}

function nextWeekly(prevDue: string, weekday: string): string | null {
  const names = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const target = names.indexOf(weekday.toLowerCase());
  if (target === -1) return null;
  const d = new Date(Date.UTC(Number(prevDue.slice(0, 4)), Number(prevDue.slice(5, 7)) - 1, Number(prevDue.slice(8, 10))));
  for (let i = 1; i <= 7; i++) {
    const nd = new Date(d.getTime() + i * 86400000);
    if (nd.getUTCDay() === target) return `${nd.getUTCFullYear()}-${String(nd.getUTCMonth() + 1).padStart(2, '0')}-${String(nd.getUTCDate()).padStart(2, '0')}`;
  }
  return null;
}

function nextMonthly(prevDue: string, n: number): string | null {
  const d = new Date(Date.UTC(Number(prevDue.slice(0, 4)), Number(prevDue.slice(5, 7)) - 1, 1));
  let y = d.getUTCFullYear(), m = d.getUTCMonth() + 2;
  if (m > 12) { m = 1; y++; }
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const day = Math.min(n, lastDay);
  return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
