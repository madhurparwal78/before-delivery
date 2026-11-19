import { Task, FieldRecord } from './types';

export const DUE_STATUS_TEXT: Record<Task['dueStatus'], string> = {
  overdue: 'Overdue', today: 'Due today', later: 'Later', none: 'No due date',
};
export const DUE_STATUS_ORDER: Task['dueStatus'][] = ['overdue', 'today', 'later', 'none'];

export const APPROVAL_TEXT: Record<string, string> = {
  none: 'None', awaiting: 'Awaiting approval', approved: 'Approved',
  changes_requested: 'Changes requested', rejected: 'Rejected',
};

export function selectValueText(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (Array.isArray(v)) return v.length ? v[0] : null;
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return String(v);
  return String(v);
}

export function sameValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => x === b[i]);
  }
  return a === b;
}

export function fieldByName(fields: FieldRecord[], name: string): FieldRecord | undefined {
  return fields.find(f => f.name === name);
}
