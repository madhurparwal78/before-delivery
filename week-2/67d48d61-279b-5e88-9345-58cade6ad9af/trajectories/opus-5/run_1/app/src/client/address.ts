import {
  CYCLE_KEYS,
  DEPARTMENTS,
  taskNumber,
  type CycleKey,
  type DepartmentKey,
} from '../shared/domain.js';

export type ScreenPath = '/tasks' | '/triage' | '/requests';
export type GroupBy = 'status' | 'cycle' | 'department' | 'owner';
export type GridView = 'list' | 'board';

export interface Address {
  path: string;
  view: GridView;
  dept: DepartmentKey | null;
  blocked: boolean;
  group: GroupBy;
  cycle: CycleKey | null;
  row: string | null;
  task: string | null;
}

export const SCREEN_PATHS: ScreenPath[] = ['/tasks', '/triage', '/requests'];

const GROUPS: GroupBy[] = ['status', 'cycle', 'department', 'owner'];

export function readAddress(): Address {
  const url = new URL(window.location.href);
  const query = url.searchParams;
  const view = query.get('view') === 'board' ? 'board' : 'list';
  const deptValue = query.get('dept');
  const dept = DEPARTMENTS.some((entry) => entry.key === deptValue)
    ? (deptValue as DepartmentKey)
    : null;
  const groupValue = query.get('group');
  const group = GROUPS.includes(groupValue as GroupBy) ? (groupValue as GroupBy) : 'status';
  const cycleValue = query.get('cycle');
  const cycle = CYCLE_KEYS.includes(cycleValue as CycleKey) ? (cycleValue as CycleKey) : null;
  const rowValue = query.get('row');
  const taskValue = query.get('task');
  return {
    path: url.pathname,
    view,
    dept,
    blocked: query.get('blocked') === '1',
    group,
    cycle,
    row: rowValue !== null && taskNumber(rowValue) !== null ? rowValue : null,
    task: taskValue !== null && taskNumber(taskValue) !== null ? taskValue : null,
  };
}

/** Parameters at their default are left out. */
export function writeAddress(address: Address): string {
  const query = new URLSearchParams();
  if (address.view === 'board') query.set('view', 'board');
  if (address.dept !== null) query.set('dept', address.dept);
  if (address.blocked) query.set('blocked', '1');
  if (address.group !== 'status' && address.view !== 'board') query.set('group', address.group);
  if (address.cycle !== null) query.set('cycle', address.cycle);
  if (address.row !== null) query.set('row', address.row);
  if (address.task !== null) query.set('task', address.task);
  const text = query.toString();
  return text.length === 0 ? address.path : `${address.path}?${text}`;
}

export function sameAddress(a: Address, b: Address): boolean {
  return writeAddress(a) === writeAddress(b);
}
