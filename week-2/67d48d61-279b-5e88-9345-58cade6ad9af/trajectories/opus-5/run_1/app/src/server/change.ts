import type { PoolClient } from 'pg';
import { isClosedStatus, taskId } from '../shared/domain.js';
import type {
  CascadeEntry,
  ChangeKind,
  ChangeResult,
  ReblockedEntry,
  Task,
} from '../shared/types.js';
import { loadCycles, type CycleRow } from './cycles.js';
import { computeCascade, computeReblocked, linkRemovalCascade } from './domain/cascade.js';
import {
  blockedMap,
  buildSnapshot,
  loadGraph,
  task,
  toTask,
  type Graph,
  type TaskRow,
} from './domain/graph.js';
import { rollUpEffects, type ChildStatusChange } from './domain/rollup.js';
import { takeWriteLock, withTransaction } from './db/pool.js';

export const RESTORE_FIELDS = [
  'status',
  'priority',
  'owner',
  'title',
  'details',
  'label',
  'cycle',
] as const;
export type RestoreField = (typeof RESTORE_FIELDS)[number];
export type RestoreState = Pick<TaskRow, RestoreField>;

const DIFF_FIELDS = [...RESTORE_FIELDS, 'department', 'parent', 'duplicate_of'] as const;
type DiffField = (typeof DIFF_FIELDS)[number];

export type ActivityKind =
  | 'created'
  | 'edited'
  | 'auto_closed'
  | 'auto_reopened'
  | 'linked'
  | 'unlinked'
  | 'attached'
  | 'decided'
  | 'rolled'
  | 'undo';

/** Entries Promptside itself makes, which carry no crew member. */
const SERVER_KINDS: ActivityKind[] = ['auto_closed', 'auto_reopened', 'rolled'];

export interface UndoEntry {
  number: number;
  before: RestoreState;
  version_after: number;
}

export interface UndoData {
  entries: UndoEntry[];
  cascade: CascadeEntry[];
}

function pushLink(map: Map<number, number[]>, key: number, value: number): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

function dropLink(map: Map<number, number[]>, key: number, value: number): void {
  const list = map.get(key);
  if (!list) return;
  map.set(
    key,
    list.filter((entry) => entry !== value),
  );
}

export function restoreState(row: TaskRow): RestoreState {
  return {
    status: row.status,
    priority: row.priority,
    owner: row.owner,
    title: row.title,
    details: row.details,
    label: row.label,
    cycle: row.cycle,
  };
}

/** The working copy of one change. Everything a route changes goes through here. */
export class ChangeSession {
  readonly client: PoolClient;
  readonly graph: Graph;
  readonly cycles: CycleRow[];
  readonly now: Date;
  readonly actor: string | null;
  /** Undo restores parents directly, so it turns the roll-up off. */
  suppressRollUp = false;

  readonly touches = new Map<number, ActivityKind>();
  readonly created = new Set<number>();
  readonly statusChanges = new Map<number, ChildStatusChange>();
  readonly directClosures = new Set<number>();
  readonly addedLinks: [number, number][] = [];
  readonly removedLinks: [number, number][] = [];

  constructor(
    client: PoolClient,
    graph: Graph,
    cycles: CycleRow[],
    now: Date,
    actor: string | null,
  ) {
    this.client = client;
    this.graph = graph;
    this.cycles = cycles;
    this.now = now;
    this.actor = actor;
  }

  setFields(
    number: number,
    fields: Partial<Pick<TaskRow, DiffField>>,
    kind: ActivityKind = 'edited',
  ): void {
    const row = task(this.graph, number);
    const from = row.status;
    Object.assign(row, fields);
    if (fields.status !== undefined && fields.status !== from) {
      this.statusChanges.set(number, { from, to: fields.status });
      if (isClosedStatus(fields.status) && !isClosedStatus(from)) this.directClosures.add(number);
    }
    this.touches.set(number, kind);
  }

  createTask(row: TaskRow): void {
    this.graph.tasks.set(row.number, row);
    if (row.parent !== null) pushLink(this.graph.children, row.parent, row.number);
    this.created.add(row.number);
    this.touches.set(row.number, 'created');
    this.statusChanges.set(row.number, { from: null, to: row.status });
  }

  /** Records that `blocker` blocks `blocked`. */
  addLink(blocker: number, blocked: number): void {
    this.addedLinks.push([blocker, blocked]);
    pushLink(this.graph.blockedBy, blocked, blocker);
    pushLink(this.graph.blocks, blocker, blocked);
    this.touches.set(blocker, 'linked');
    this.touches.set(blocked, 'linked');
  }

  removeLink(blocker: number, blocked: number): void {
    this.removedLinks.push([blocker, blocked]);
    dropLink(this.graph.blockedBy, blocked, blocker);
    dropLink(this.graph.blocks, blocker, blocked);
    this.touches.set(blocker, 'unlinked');
    this.touches.set(blocked, 'unlinked');
  }

  /** Marks a task as touched without changing a field, for attachments. */
  note(number: number, kind: ActivityKind): void {
    this.touches.set(number, kind);
  }
}

export interface ChangeOptions<T> {
  kind: ChangeKind;
  actor: string | null;
  undoable?: boolean;
  /** Tasks to list in the result even when the change left them untouched. */
  alwaysInclude?: number[];
  /** Orders the re-blocked list, used by undo to play its cascade backwards. */
  reblockedOrder?: () => number[];
  body: (session: ChangeSession) => Promise<T> | T;
}

export interface ChangeOutcome<T> {
  result: ChangeResult;
  /** Whatever the change's body returned. */
  value: T;
}

export async function runChange<T>(options: ChangeOptions<T>): Promise<ChangeOutcome<T>> {
  return withTransaction(async (client) => {
    await takeWriteLock(client);
    const now = new Date();
    const cycles = await loadCycles(client);
    const graph = await loadGraph(client);
    const before = new Map<number, TaskRow>();
    for (const [number, row] of graph.tasks) before.set(number, { ...row });
    const blockedBefore = blockedMap(graph);

    const session = new ChangeSession(client, graph, cycles, now, options.actor);
    const value = await options.body(session);

    const levels = new Map<number, number>();
    for (const number of session.directClosures) levels.set(number, 0);

    if (!session.suppressRollUp && session.statusChanges.size > 0) {
      for (const effect of rollUpEffects(graph, session.statusChanges)) {
        task(graph, effect.parent).status = effect.status;
        session.touches.set(effect.parent, effect.kind);
        if (effect.kind === 'auto_closed') {
          const childLevels = effect.closedChildren.map((child) => levels.get(child) ?? 0);
          levels.set(effect.parent, Math.max(0, ...childLevels) + 1);
        }
      }
    }

    const blockedAfter = blockedMap(graph);
    const removal = session.removedLinks[0];
    const cascade: CascadeEntry[] =
      removal && levels.size === 0
        ? linkRemovalCascade(graph, removal[0], removal[1], blockedBefore, blockedAfter)
        : computeCascade(graph, blockedBefore, blockedAfter, levels);
    const reblocked = orderReblocked(
      computeReblocked(blockedBefore, blockedAfter),
      options.reblockedOrder?.(),
    );

    const touched: number[] = [];
    const diffs = new Map<number, Record<string, { from: unknown; to: unknown }>>();
    for (const [number, kind] of session.touches) {
      const row = task(graph, number);
      const previous = before.get(number);
      const diff: Record<string, { from: unknown; to: unknown }> = {};
      for (const field of DIFF_FIELDS) {
        const was = previous ? previous[field] : null;
        const value = row[field];
        if (was !== value) diff[field] = { from: was, to: value };
      }
      const structural = kind === 'linked' || kind === 'unlinked' || kind === 'attached';
      if (Object.keys(diff).length === 0 && !structural) continue;
      touched.push(number);
      diffs.set(number, diff);
    }
    touched.sort((a, b) => a - b);

    const nothingHappened = touched.length === 0;
    let seq: number;

    if (nothingHappened) {
      seq = await lastSeq(client);
    } else {
      const undoable = options.undoable === true;
      const inserted = await client.query<{ seq: string }>(
        `insert into changes (kind, actor, at, undoable)
         values ($1, $2, $3, $4) returning seq::text as seq`,
        [options.kind, options.actor, now, undoable],
      );
      seq = Number((inserted.rows[0] as { seq: string }).seq);

      for (const number of touched) {
        const row = task(graph, number);
        row.version += 1;
        row.updated_at = now;
        await writeTask(client, row, session.created.has(number));
      }
      for (const [blocker, blocked] of session.addedLinks) {
        await client.query('insert into relations (blocker, blocked) values ($1, $2)', [
          blocker,
          blocked,
        ]);
      }
      for (const [blocker, blocked] of session.removedLinks) {
        await client.query('delete from relations where blocker = $1 and blocked = $2', [
          blocker,
          blocked,
        ]);
      }
      for (const number of touched) {
        const kind = session.touches.get(number) as ActivityKind;
        await client.query(
          `insert into activity (task, at, actor, kind, changes, change)
           values ($1, $2, $3, $4, $5, $6)`,
          [
            number,
            now,
            SERVER_KINDS.includes(kind) ? null : options.actor,
            kind,
            JSON.stringify(diffs.get(number) ?? {}),
            seq,
          ],
        );
      }
      if (undoable) {
        const undoData: UndoData = {
          entries: touched.map((number) => ({
            number,
            before: restoreState(before.get(number) as TaskRow),
            version_after: task(graph, number).version,
          })),
          cascade,
        };
        await client.query('update changes set undo_data = $2 where seq = $1', [
          seq,
          JSON.stringify(undoData),
        ]);
      }
    }

    const included = new Set(touched);
    for (const number of options.alwaysInclude ?? []) {
      if (graph.tasks.has(number)) included.add(number);
    }
    const tasks: Task[] = [...included]
      .sort((a, b) => a - b)
      .map((number) => toTask(graph, number));

    const result: ChangeResult = {
      change: seq,
      undoable: options.undoable === true && !nothingHappened,
      tasks,
      cascade,
      reblocked,
      snapshot: buildSnapshot(graph, cycles, seq, now),
    };

    if (!nothingHappened) {
      await client.query('update changes set result = $2 where seq = $1', [
        seq,
        JSON.stringify({ ...result, kind: options.kind }),
      ]);
      await client.query('select pg_notify($1, $2)', ['promptside_change', String(seq)]);
    }

    return { result, value };
  });
}

function orderReblocked(entries: ReblockedEntry[], order: number[] | undefined): ReblockedEntry[] {
  if (!order) return entries;
  const wanted = order.map(taskId);
  const sorted = entries.slice().sort((a, b) => rank(wanted, a.id) - rank(wanted, b.id));
  return sorted.map((entry, index) => ({ id: entry.id, order: index + 1 }));
}

function rank(order: string[], id: string): number {
  const index = order.indexOf(id);
  return index === -1 ? order.length : index;
}

async function writeTask(client: PoolClient, row: TaskRow, isNew: boolean): Promise<void> {
  const values = [
    row.number,
    row.title,
    row.details,
    row.department,
    row.label,
    row.status,
    row.priority,
    row.owner,
    row.cycle,
    row.parent,
    row.duplicate_of,
    row.request,
    row.version,
    row.updated_at,
  ];
  if (isNew) {
    await client.query(
      `insert into tasks (number, title, details, department, label, status, priority,
                          owner, cycle, parent, duplicate_of, request, version, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      values,
    );
  } else {
    await client.query(
      `update tasks set title=$2, details=$3, department=$4, label=$5, status=$6, priority=$7,
                        owner=$8, cycle=$9, parent=$10, duplicate_of=$11, request=$12,
                        version=$13, updated_at=$14
       where number=$1`,
      values,
    );
  }
}

async function lastSeq(client: PoolClient): Promise<number> {
  const result = await client.query<{ seq: string }>(
    'select coalesce(max(seq), 0)::text as seq from changes',
  );
  return Number(result.rows[0]?.seq ?? '0');
}

/** Reads the committed state without making a change. */
export async function readState<T>(
  run: (graph: Graph, cycles: CycleRow[], seq: number, client: PoolClient) => Promise<T> | T,
): Promise<T> {
  return withTransaction(async (client) => {
    const cycles = await loadCycles(client);
    const graph = await loadGraph(client);
    return run(graph, cycles, await lastSeq(client), client);
  });
}
