import type { PoolClient } from 'pg';
import {
  isOpenStatus,
  taskId,
  type CycleKey,
  type Priority,
  type Status,
} from '../../shared/domain.js';
import type { Snapshot, Task } from '../../shared/types.js';
import type { CycleRow } from '../cycles.js';
import { currentCycleKey } from '../cycles.js';

export interface TaskRow {
  number: number;
  title: string;
  details: string;
  department: string | null;
  label: string | null;
  status: Status;
  priority: Priority;
  owner: string | null;
  cycle: CycleKey | null;
  parent: number | null;
  duplicate_of: number | null;
  request: string | null;
  version: number;
  updated_at: Date;
}

export interface Graph {
  tasks: Map<number, TaskRow>;
  /** blocked task number -> its blockers */
  blockedBy: Map<number, number[]>;
  /** blocker task number -> the tasks it blocks */
  blocks: Map<number, number[]>;
  /** parent number -> its sub-tasks */
  children: Map<number, number[]>;
}

const SELECT_TASKS = `
  select number, title, details, department, label, status, priority, owner, cycle,
         parent, duplicate_of, request, version, updated_at
  from tasks order by number`;

export async function loadGraph(client: PoolClient): Promise<Graph> {
  const taskRows = await client.query<TaskRow>(SELECT_TASKS);
  const relationRows = await client.query<{ blocker: number; blocked: number }>(
    'select blocker, blocked from relations order by blocker, blocked',
  );
  const graph: Graph = {
    tasks: new Map(),
    blockedBy: new Map(),
    blocks: new Map(),
    children: new Map(),
  };
  for (const row of taskRows.rows) {
    graph.tasks.set(row.number, row);
  }
  for (const row of taskRows.rows) {
    if (row.parent !== null) push(graph.children, row.parent, row.number);
  }
  for (const link of relationRows.rows) {
    push(graph.blockedBy, link.blocked, link.blocker);
    push(graph.blocks, link.blocker, link.blocked);
  }
  return graph;
}

function push(map: Map<number, number[]>, key: number, value: number): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

export function task(graph: Graph, number: number): TaskRow {
  const row = graph.tasks.get(number);
  if (!row) throw new Error(`Task ${number} is not loaded`);
  return row;
}

export function listOf(map: Map<number, number[]>, key: number): number[] {
  return map.get(key) ?? [];
}

/** The one place the blocked overlay is decided. */
export function isBlocked(graph: Graph, number: number): boolean {
  const row = task(graph, number);
  if (!isOpenStatus(row.status)) return false;
  return listOf(graph.blockedBy, number).some((blocker) =>
    isOpenStatus(task(graph, blocker).status),
  );
}

export function openBlockers(graph: Graph, number: number): number[] {
  return listOf(graph.blockedBy, number)
    .filter((blocker) => isOpenStatus(task(graph, blocker).status))
    .sort((a, b) => a - b);
}

export function blockedMap(graph: Graph): Map<number, boolean> {
  const map = new Map<number, boolean>();
  for (const number of graph.tasks.keys()) map.set(number, isBlocked(graph, number));
  return map;
}

export function rollUpOf(graph: Graph, number: number): { done: number; total: number } | null {
  const children = listOf(graph.children, number);
  if (children.length === 0) return null;
  let done = 0;
  let total = 0;
  for (const child of children) {
    const status = task(graph, child).status;
    if (status === 'cancelled') continue;
    total += 1;
    if (status === 'done') done += 1;
  }
  return { done, total };
}

export function toTask(graph: Graph, number: number): Task {
  const row = task(graph, number);
  return {
    id: taskId(row.number),
    number: row.number,
    title: row.title,
    details: row.details,
    department: row.department,
    label: row.label,
    status: row.status,
    priority: row.priority,
    owner: row.owner,
    cycle: row.cycle,
    parent: row.parent === null ? null : taskId(row.parent),
    subtasks: rollUpOf(graph, row.number),
    blocked_by: listOf(graph.blockedBy, row.number)
      .slice()
      .sort((a, b) => a - b)
      .map(taskId),
    blocks: listOf(graph.blocks, row.number)
      .slice()
      .sort((a, b) => a - b)
      .map(taskId),
    blocked: isBlocked(graph, row.number),
    duplicate_of: row.duplicate_of === null ? null : taskId(row.duplicate_of),
    request: row.request,
    version: row.version,
    updated_at: row.updated_at.toISOString().replace(/\.\d{3}Z$/, 'Z'),
  };
}

/** The one place the snapshot counts are defined. */
export function buildSnapshot(graph: Graph, cycles: CycleRow[], seq: number, now: Date): Snapshot {
  const columns = { backlog: 0, todo: 0, in_progress: 0, done: 0, cancelled: 0 };
  let triage = 0;
  let blocked = 0;
  for (const row of graph.tasks.values()) {
    if (row.status === 'triage') triage += 1;
    else if (row.status !== 'duplicate') columns[row.status] += 1;
    if (isBlocked(graph, row.number)) blocked += 1;
  }
  const current = currentCycleKey(cycles, now);
  return {
    seq,
    triage,
    columns,
    blocked,
    cycles: cycles.map((cycle) => {
      let done = 0;
      let total = 0;
      for (const row of graph.tasks.values()) {
        if (row.cycle !== cycle.key) continue;
        if (row.status === 'cancelled') continue;
        total += 1;
        if (row.status === 'done') done += 1;
      }
      return {
        key: cycle.key,
        name: cycle.name,
        starts_at: cycle.starts_at.toISOString().replace(/\.\d{3}Z$/, 'Z'),
        ends_at:
          cycle.ends_at === null
            ? null
            : cycle.ends_at.toISOString().replace(/\.\d{3}Z$/, 'Z'),
        current: cycle.key === current,
        done,
        total,
      };
    }),
  };
}
