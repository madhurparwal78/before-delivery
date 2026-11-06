import { fieldMessage } from '../../shared/copy.js';
import {
  crewMember,
  crewName,
  CYCLE_KEYS,
  department,
  DEPARTMENTS,
  isEditableStatus,
  isLegalTransition,
  isOpenStatus,
  MAX_BULK_TASKS,
  STATUSES,
  taskId,
  taskNumber,
  type CycleKey,
  type Priority,
  type Status,
} from '../../shared/domain.js';
import type { ActivityEntry, Task } from '../../shared/types.js';
import { readState, runChange, type ChangeSession, type UndoData } from '../change.js';
import { currentCycleKey } from '../cycles.js';
import {
  buildSnapshot,
  isBlocked,
  listOf,
  openBlockers,
  task,
  toTask,
  type Graph,
  type TaskRow,
} from '../domain/graph.js';
import { pool } from '../db/pool.js';
import type { Ctx } from '../http/context.js';
import { apiError } from '../http/errors.js';
import { withIdempotency } from '../http/idempotency.js';
import { json, type Reply } from '../http/reply.js';
import {
  parseCycle,
  parseDepartment,
  parseDetails,
  parseLabel,
  parseOwner,
  parsePriority,
  parseStatus,
  parseTaskRef,
  parseTitle,
  refuseIfAny,
  type Fields,
} from './validate.js';

export async function requireTask(number: number | null): Promise<number> {
  if (number === null) throw apiError.notFound();
  const found = await pool.query('select 1 from tasks where number = $1', [number]);
  if (found.rowCount === 0) throw apiError.notFound();
  return number;
}

const FILTER_KEYS = ['dept', 'status', 'blocked', 'cycle', 'owner', 'label'] as const;

export async function listTasks(ctx: Ctx): Promise<Reply> {
  const query = ctx.url.searchParams;
  const fields: Fields = {};
  for (const key of query.keys()) {
    if (!(FILTER_KEYS as readonly string[]).includes(key)) fields[key] = fieldMessage.queryFilter;
  }
  const dept = query.get('dept');
  const status = query.get('status');
  const blocked = query.get('blocked');
  const cycle = query.get('cycle');
  const owner = query.get('owner');
  const label = query.get('label');

  if (dept !== null && department(dept) === undefined) fields.dept = fieldMessage.queryFilter;
  if (status !== null && !(STATUSES as readonly string[]).includes(status)) {
    fields.status = fieldMessage.queryFilter;
  }
  if (blocked !== null && blocked !== '1') fields.blocked = fieldMessage.queryFilter;
  if (cycle !== null && !CYCLE_KEYS.includes(cycle as CycleKey)) {
    fields.cycle = fieldMessage.queryFilter;
  }
  if (owner !== null && owner !== 'none' && crewMember(owner) === undefined) {
    fields.owner = fieldMessage.queryFilter;
  }
  if (label !== null && !DEPARTMENTS.some((row) => row.labels.some((it) => it.key === label))) {
    fields.label = fieldMessage.queryFilter;
  }
  refuseIfAny(fields);

  return readState((graph, cycles, seq) => {
    const tasks: Task[] = [];
    for (const row of [...graph.tasks.values()].sort((a, b) => a.number - b.number)) {
      if (status === null) {
        if (row.status === 'triage' || row.status === 'duplicate') continue;
      } else if (row.status !== status) continue;
      if (dept !== null && row.department !== dept) continue;
      if (cycle !== null && row.cycle !== cycle) continue;
      if (owner !== null && (owner === 'none' ? row.owner !== null : row.owner !== owner)) continue;
      if (label !== null && row.label !== label) continue;
      if (blocked === '1' && !isBlocked(graph, row.number)) continue;
      tasks.push(toTask(graph, row.number));
    }
    return json(200, {
      tasks,
      snapshot: buildSnapshot(graph, cycles, seq, new Date()),
    });
  });
}

export async function getTask(number: number): Promise<Reply> {
  return readState((graph) => {
    const found = toTask(graph, number);
    return json(200, { task: found }, { ETag: `"${found.version}"` });
  });
}

export async function createTask(ctx: Ctx): Promise<Reply> {
  return withIdempotency(ctx.idempotencyKey, 'POST', '/api/tasks', ctx.body, async () => {
    const outcome = await runChange({
      kind: 'create',
      actor: ctx.actor,
      body: (session) => {
        const fields: Fields = { ...ctx.headerFields };
        const body = ctx.body;
        const title = parseTitle(body.title, fields);
        const departmentKey = parseDepartment(body.department, fields);
        const details = body.details === undefined ? '' : parseDetails(body.details, fields);
        const label =
          body.label === undefined || body.label === null
            ? null
            : parseLabel(body.label, departmentKey ?? null, fields);
        const priority = body.priority === undefined ? 0 : parsePriority(body.priority, fields);
        const owner = body.owner === undefined ? null : parseOwner(body.owner, fields);
        const status = body.status === undefined ? 'backlog' : parseStatus(body.status, fields);
        if (status !== undefined && status !== 'backlog' && status !== 'todo') {
          fields.status = fieldMessage.status;
        }
        const cycle =
          body.cycle === undefined || body.cycle === null
            ? currentCycleKey(session.cycles, session.now)
            : parseCycle(body.cycle, session.cycles, session.now, fields);

        let parent: number | null = null;
        if (body.parent !== undefined && body.parent !== null) {
          const reference = parseTaskRef(body.parent, fields, 'parent');
          if (reference !== undefined) {
            const parentRow = session.graph.tasks.get(reference);
            if (!parentRow || parentRow.parent !== null) fields.parent = fieldMessage.parent;
            else if (!isEditableStatus(parentRow.status)) fields.parent = fieldMessage.parent;
            else parent = reference;
          }
        }
        if (parent !== null && listOf(session.graph.blockedBy, parent).length > 0) {
          throw apiError.conflict(
            'blocks_parent',
            `${taskId(parent)} has blockers, so it cannot take sub-tasks.`,
          );
        }
        refuseIfAny(fields);

        const number = nextNumber(session.graph);
        const row: TaskRow = {
          number,
          title: title as string,
          details: (details as string) ?? '',
          department: departmentKey as string,
          label: (label as string | null) ?? null,
          status: status as Status,
          priority: priority as Priority,
          owner: (owner as string | null) ?? null,
          cycle: cycle as CycleKey,
          parent,
          duplicate_of: null,
          request: null,
          version: 0,
          updated_at: session.now,
        };
        session.createTask(row);
      },
    });
    return json(201, outcome.result);
  });
}

function nextNumber(graph: Graph): number {
  let highest = 0;
  for (const number of graph.tasks.keys()) highest = Math.max(highest, number);
  return highest + 1;
}

export async function patchTask(ctx: Ctx, number: number): Promise<Reply> {
  const ifMatch = ctx.req.headers['if-match'];
  if (ifMatch === undefined) throw apiError.preconditionRequired();
  const expected = Number(String(ifMatch).replace(/^"|"$/g, ''));

  const outcome = await runChange({
    kind: 'edit',
    actor: ctx.actor,
    undoable: true,
    alwaysInclude: [number],
    body: (session) => {
      const row = task(session.graph, number);
      if (!Number.isInteger(expected) || row.version !== expected) {
        throw apiError.versionConflict(
          `${taskId(number)} was changed by someone else.`,
          toTask(session.graph, number),
        );
      }
      if (!isEditableStatus(row.status)) {
        throw apiError.conflict(
          'not_editable',
          `${taskId(number)} cannot be edited in ${row.status}.`,
        );
      }

      const fields: Fields = { ...ctx.headerFields };
      const body = ctx.body;
      const update: Partial<TaskRow> = {};
      if (body.title !== undefined) {
        const title = parseTitle(body.title, fields);
        if (title !== undefined) update.title = title;
      }
      if (body.details !== undefined) {
        const details = parseDetails(body.details, fields);
        if (details !== undefined) update.details = details;
      }
      if (body.priority !== undefined) {
        const priority = parsePriority(body.priority, fields);
        if (priority !== undefined) update.priority = priority;
      }
      if (body.owner !== undefined) {
        const owner = parseOwner(body.owner, fields);
        if (owner !== undefined) update.owner = owner;
      }
      if (body.label !== undefined) {
        const label = parseLabel(body.label, row.department, fields);
        if (label !== undefined) update.label = label;
      }
      if (body.cycle !== undefined) {
        const cycle = parseCycle(body.cycle, session.cycles, session.now, fields);
        if (cycle !== undefined) update.cycle = cycle;
      }
      let status: Status | undefined;
      if (body.status !== undefined) {
        status = parseStatus(body.status, fields);
        if (status !== undefined) {
          if (!isLegalTransition(row.status, status)) {
            throw apiError.conflict(
              'illegal_transition',
              `${taskId(number)} cannot move from ${row.status} to ${status}.`,
            );
          }
          if (status === 'done') {
            const open = openBlockers(session.graph, number);
            if (open.length > 0) {
              throw apiError.conflict(
                'blocked_by_open',
                `${taskId(number)} is still blocked.`,
                { blocked_by: open.map(taskId) },
              );
            }
            if (hasOpenSubtasks(session.graph, number)) {
              throw apiError.conflict(
                'open_subtasks',
                `${taskId(number)} has open sub-tasks.`,
              );
            }
          }
          update.status = status;
        }
      }
      refuseIfAny(fields);
      session.setFields(number, update);
    },
  });
  return json(200, outcome.result);
}

function hasOpenSubtasks(graph: Graph, number: number): boolean {
  return listOf(graph.children, number).some((child) => isOpenStatus(task(graph, child).status));
}

interface BulkEntry {
  number: number;
  version: number;
}

export async function bulkTasks(ctx: Ctx): Promise<Reply> {
  const fields: Fields = { ...ctx.headerFields };
  const raw = ctx.body.tasks;
  let entries: BulkEntry[] | null = null;
  if (
    Array.isArray(raw) &&
    raw.length >= 1 &&
    raw.length <= MAX_BULK_TASKS &&
    raw.every(
      (entry) =>
        entry !== null &&
        typeof entry === 'object' &&
        typeof (entry as { id?: unknown }).id === 'string' &&
        Number.isInteger((entry as { version?: unknown }).version),
    )
  ) {
    const parsed = raw.map((entry) => {
      const item = entry as { id: string; version: number };
      return { number: taskNumber(item.id), version: item.version };
    });
    if (parsed.every((entry) => entry.number !== null)) {
      entries = parsed as BulkEntry[];
    }
  }
  if (entries === null) {
    fields.tasks = fieldMessage.tasks;
    throw apiError.validation(fields);
  }

  const known = await pool.query<{ number: number }>(
    'select number from tasks where number = any($1::int[])',
    [entries.map((entry) => entry.number)],
  );
  const present = new Set(known.rows.map((row) => row.number));
  const missing = entries.filter((entry) => !present.has(entry.number));
  if (missing.length > 0) {
    throw apiError.notFoundTasks(
      missing
        .map((entry) => entry.number)
        .sort((a, b) => a - b)
        .map(taskId),
    );
  }

  const numbers = entries.map((entry) => entry.number);
  return withIdempotency(ctx.idempotencyKey, 'POST', '/api/tasks/bulk', ctx.body, async () => {
    const outcome = await runChange({
      kind: 'bulk',
      actor: ctx.actor,
      undoable: true,
      alwaysInclude: numbers,
      body: (session) => applyBulk(session, ctx, entries as BulkEntry[], fields),
    });
    return json(200, outcome.result);
  });
}

function applyBulk(session: ChangeSession, ctx: Ctx, entries: BulkEntry[], fields: Fields): void {
  const set = ctx.body.set;
  let status: Status | undefined;
  let priority: Priority | undefined;
  let owner: string | null | undefined;
  if (set === null || typeof set !== 'object' || Array.isArray(set)) {
    fields.set = fieldMessage.set;
  } else {
    const values = set as Record<string, unknown>;
    if (values.status !== undefined) status = parseStatus(values.status, fields);
    if (values.priority !== undefined) priority = parsePriority(values.priority, fields);
    if (values.owner !== undefined) owner = parseOwner(values.owner, fields);
    if (
      values.status === undefined &&
      values.priority === undefined &&
      values.owner === undefined
    ) {
      fields.set = fieldMessage.set;
    }
  }

  const stale = entries.filter(
    (entry) => task(session.graph, entry.number).version !== entry.version,
  );
  if (stale.length > 0) {
    throw apiError.versionConflict(
      'Some tasks were changed by someone else.',
      stale
        .map((entry) => toTask(session.graph, entry.number))
        .sort((a, b) => a.number - b.number),
    );
  }

  const notEditable = entries.filter(
    (entry) => !isEditableStatus(task(session.graph, entry.number).status),
  );
  if (notEditable.length > 0) {
    throw apiError.conflict('not_editable', 'Some tasks cannot be edited.', {
      tasks: notEditable.map((entry) => taskId(entry.number)),
    });
  }

  if (status !== undefined) {
    const illegal = entries.filter(
      (entry) => !isLegalTransition(task(session.graph, entry.number).status, status as Status),
    );
    if (illegal.length > 0) {
      throw apiError.conflict('illegal_transition', 'Some tasks cannot make that move.', {
        tasks: illegal.map((entry) => taskId(entry.number)),
      });
    }
  }

  for (const entry of entries) {
    const update: Partial<TaskRow> = {};
    if (status !== undefined) update.status = status;
    if (priority !== undefined) update.priority = priority;
    if (owner !== undefined) update.owner = owner;
    session.setFields(entry.number, update);
  }

  // Blockedness and sub-tasks are judged after every task in this change has been applied.
  if (status === 'done') {
    const blocked = entries.filter(
      (entry) => openBlockers(session.graph, entry.number).length > 0,
    );
    if (blocked.length > 0) {
      const blockers = new Set<number>();
      for (const entry of blocked) {
        for (const blocker of openBlockers(session.graph, entry.number)) blockers.add(blocker);
      }
      throw apiError.conflict('blocked_by_open', 'Some tasks are still blocked.', {
        tasks: blocked.map((entry) => taskId(entry.number)),
        blocked_by: [...blockers].sort((a, b) => a - b).map(taskId),
      });
    }
    const withOpenSubtasks = entries.filter((entry) =>
      hasOpenSubtasks(session.graph, entry.number),
    );
    if (withOpenSubtasks.length > 0) {
      throw apiError.conflict('open_subtasks', 'Some tasks have open sub-tasks.', {
        tasks: withOpenSubtasks.map((entry) => taskId(entry.number)),
      });
    }
  }

  refuseIfAny(fields);
}

export async function undoLastChange(ctx: Ctx): Promise<Reply> {
  return withIdempotency(ctx.idempotencyKey, 'POST', '/api/undo', ctx.body, async () => {
    let undone: UndoData | null = null;
    const outcome = await runChange({
      kind: 'undo',
      actor: ctx.actor,
      reblockedOrder: () =>
        (undone?.cascade ?? [])
          .slice()
          .reverse()
          .map((entry) => taskNumber(entry.id) ?? 0),
      body: async (session) => {
        if (Object.keys(ctx.headerFields).length > 0) {
          throw apiError.validation(ctx.headerFields);
        }
        session.suppressRollUp = true;
        const found = await session.client.query<{ seq: string; undo_data: UndoData }>(
          `select seq::text as seq, undo_data from changes
           where actor = $1 and undoable and not undone and undo_data is not null
           order by seq desc limit 1`,
          [ctx.actor],
        );
        const row = found.rows[0];
        if (!row) {
          throw apiError.conflict('nothing_to_undo', 'There is nothing to undo.');
        }
        undone = row.undo_data;
        for (const entry of undone.entries) {
          if (task(session.graph, entry.number).version !== entry.version_after) {
            throw apiError.conflict('undo_stale', 'A task changed after that edit.');
          }
        }
        for (const entry of undone.entries) {
          session.setFields(entry.number, entry.before, 'undo');
        }
        await session.client.query('update changes set undone = true where seq = $1', [
          Number(row.seq),
        ]);
      },
    });
    return json(200, outcome.result);
  });
}

export async function addRelation(ctx: Ctx, number: number): Promise<Reply> {
  const outcome = await runChange({
    kind: 'relation',
    actor: ctx.actor,
    body: (session) => {
      const fields: Fields = { ...ctx.headerFields };
      const target = parseTaskRef(ctx.body.blocks, fields, 'blocks');
      if (target !== undefined) {
        if (target === number) fields.blocks = fieldMessage.blocksSelf;
        else if (!session.graph.tasks.has(target)) fields.blocks = fieldMessage.blocksUnknown;
      }
      refuseIfAny(fields);
      const blocked = target as number;
      const blocker = task(session.graph, number);
      const blockedRow = task(session.graph, blocked);
      if (!isEditableStatus(blocker.status) || !isEditableStatus(blockedRow.status)) {
        throw apiError.conflict('illegal_relation', 'That link cannot be added.');
      }
      if (listOf(session.graph.blocks, number).includes(blocked)) {
        throw apiError.conflict('relation_exists', 'That link is already recorded.');
      }
      if (listOf(session.graph.children, blocked).length > 0) {
        throw apiError.conflict('blocks_parent', 'That task has sub-tasks.');
      }
      if (reaches(session.graph, blocked, number)) {
        throw apiError.conflict('relation_cycle', 'That link would make a loop.');
      }
      session.addLink(number, blocked);
    },
  });
  return json(201, outcome.result);
}

/** Whether `from` blocks `to` through any chain of links. */
function reaches(graph: Graph, from: number, to: number): boolean {
  const seen = new Set<number>([from]);
  const queue = [from];
  while (queue.length > 0) {
    const current = queue.shift() as number;
    if (current === to) return true;
    for (const next of listOf(graph.blocks, current)) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return false;
}

export async function removeRelation(
  ctx: Ctx,
  number: number,
  target: number,
): Promise<Reply> {
  const outcome = await runChange({
    kind: 'relation',
    actor: ctx.actor,
    alwaysInclude: [number, target],
    body: (session) => {
      if (Object.keys(ctx.headerFields).length > 0) {
        throw apiError.validation(ctx.headerFields);
      }
      if (!listOf(session.graph.blocks, number).includes(target)) throw apiError.notFound();
      session.removeLink(number, target);
    },
  });
  return json(200, outcome.result);
}

export async function taskActivity(number: number): Promise<Reply> {
  const rows = await pool.query<{
    id: string;
    task: number;
    at: Date;
    actor: string | null;
    kind: string;
    changes: Record<string, { from: unknown; to: unknown }>;
    change: string;
  }>(
    `select id::text as id, task, at, actor, kind, changes, change::text as change
     from activity where task = $1 order by id`,
    [number],
  );
  const activity: ActivityEntry[] = rows.rows.map((row) => ({
    id: Number(row.id),
    task: taskId(row.task),
    at: row.at.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    actor: row.actor === null ? null : { handle: row.actor, name: crewName(row.actor) },
    kind: row.kind,
    changes: row.changes,
    change: Number(row.change),
  }));
  return json(200, { activity });
}

export async function snapshotReply(): Promise<Reply> {
  return readState((graph, cycles, seq) =>
    json(200, buildSnapshot(graph, cycles, seq, new Date())),
  );
}
