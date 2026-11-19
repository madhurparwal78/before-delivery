import { Task, FieldRecord, SectionRecord, RuleRecord, GoalRecord, InboxItem, TaskDetail } from '../shared/types';

export interface ProjectData {
  id: string;
  name: string;
  teamId: string;
  progress: number;
  members: { id: string; name: string; email: string }[];
  sections: SectionRecord[];
  fields: FieldRecord[];
}

export interface TasksPage {
  tasks: Task[];
  page: number;
  pageSize: number;
  total: number;
}

export interface WorkloadData {
  from: string;
  days: string[];
  people: {
    id: string;
    name: string;
    cells: { date: string; total: number; capacity: number; over: boolean; text: string; tasks: { id: string; name: string }[] }[];
  }[];
}

export type { Task, FieldRecord, SectionRecord, RuleRecord, GoalRecord, InboxItem, TaskDetail };

export function valueText(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (Array.isArray(v)) return v.join(', ');
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return fmtVal(v);
  return String(v);
}

export function fmtVal(n: number): string {
  const r = Math.round(n);
  if (Math.abs(n - r) < 1e-10) return String(r);
  let s = n.toFixed(10).replace(/0+$/, '');
  if (s.endsWith('.')) s = s.slice(0, -1);
  return s;
}

export function cellAria(field: FieldRecord, v: unknown): string {
  const text = valueText(v);
  return text === '' ? `${field.name}, blank` : `${field.name}, ${text}`;
}
