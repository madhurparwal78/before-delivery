import type { PoolClient } from 'pg';
import { pool, withTransaction } from '../db/pool.js';
import type { MemberRow, TaskRow } from '../db/records.js';
import type { TaskStatus } from '../../shared/types.js';
import { created } from '../http/server.js';
import {
  jsonBody,
  requirePlanner,
  requireWritable,
  type RequestContext,
} from '../http/context.js';
import { notFound, unprocessable, versionConflict } from '../http/errors.js';
import { FieldErrors, checkDate, checkEstimate, checkTitle, checkVersion } from '../http/validate.js';
import { newId } from '../services/auth.js';
import {
  affectedDays,
  buildBoard,
  nextPosition,
  renumberColumn,
  taskWithSession,
} from '../services/planner.js';
import { taskDto } from '../domain/load.js';
import { compareDates, isDateString, todayInZone } from '../../shared/time.js';
import type { Router } from '../http/router.js';

async function board(context: RequestContext): Promise<unknown> {
  const { member } = requirePlanner(context);
  const start = context.query.get('start');
  if (start !== null && !isDateString(start)) {
    throw unprocessable('validation_failed', 'Use a date like 2026-03-14 for start.');
  }
  return buildBoard(member, start ?? undefined);
}

async function lockOwnTask(tx: PoolClient, memberId: string, taskId: string): Promise<TaskRow> {
  if (!/^[0-9a-f-]{36}$/i.test(taskId)) throw notFound();
  const result = await tx.query<TaskRow>(
    'select * from tasks where id = $1 and member_id = $2 for update',
    [taskId, memberId],
  );
  const row = result.rows[0];
  if (!row) throw notFound();
  return row;
}

function guardDayNotPast(member: MemberRow, dayDate: string | null): void {
  if (dayDate === null) return;
  if (compareDates(dayDate, todayInZone(member.time_zone)) < 0) {
    throw unprocessable('day_in_past', 'That day has already passed.');
  }
}

async function placeInColumn(
  tx: PoolClient,
  memberId: string,
  taskId: string,
  dayDate: string | null,
  position: number | null,
): Promise<number> {
  if (position === null) return nextPosition(tx, memberId, dayDate);
  await tx.query(
    `update tasks set position = position + 1
      where member_id = $1 and day_date is not distinct from $2 and position >= $3 and id <> $4`,
    [memberId, dayDate, position, taskId],
  );
  return position;
}

async function createTask(context: RequestContext): Promise<unknown> {
  const { member, workspace } = requirePlanner(context);
  requireWritable(context);
  const body = jsonBody(context);
  const errors = new FieldErrors();
  const title = checkTitle(errors, 'title', body.title);
  const estimateMinutes = 'estimateMinutes' in body ? checkEstimate(errors, 'estimateMinutes', body.estimateMinutes) : null;
  const dayDate = 'dayDate' in body ? checkDate(errors, 'dayDate', body.dayDate) : null;
  errors.throwIfAny();
  guardDayNotPast(member, dayDate);

  const task = await withTransaction(async (tx) => {
    const position = await nextPosition(tx, member.id, dayDate);
    const inserted = await tx.query<TaskRow>(
      `insert into tasks (id, member_id, workspace_id, title, estimate_minutes, day_date, position,
                          status, source, external_id, due_date, version, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, 'open', null, null, null, 1, now(), now())
       returning *`,
      [newId(), member.id, workspace.id, title, estimateMinutes, dayDate, position],
    );
    return inserted.rows[0]!;
  });

  return created({
    task: taskDto(task, undefined),
    days: await affectedDays(member, [dayDate]),
  });
}

async function patchTask(context: RequestContext): Promise<unknown> {
  const { member } = requirePlanner(context);
  requireWritable(context);
  const body = jsonBody(context);
  const errors = new FieldErrors();
  const version = checkVersion(errors, 'version', body.version);
  const title = 'title' in body ? checkTitle(errors, 'title', body.title) : null;
  const estimateMinutes = 'estimateMinutes' in body ? checkEstimate(errors, 'estimateMinutes', body.estimateMinutes) : undefined;
  const dayDate = 'dayDate' in body ? checkDate(errors, 'dayDate', body.dayDate) : undefined;
  const position = 'position' in body ? checkPosition(errors, body.position) : null;
  const status = 'status' in body ? checkStatus(errors, body.status) : null;
  errors.throwIfAny();
  if (dayDate !== undefined) guardDayNotPast(member, dayDate);

  const outcome = await withTransaction(async (tx) => {
    const current = await lockOwnTask(tx, member.id, context.params.id ?? '');
    if (current.version !== version) return { conflict: current, task: null, previousDay: null };

    const nextDay = dayDate === undefined ? current.day_date : dayDate;
    const dayChanged = nextDay !== current.day_date;
    if (dayChanged) {
      await tx.query('delete from task_sessions where task_id = $1', [current.id]);
    }
    const nextPositionValue =
      dayChanged || position !== null
        ? await placeInColumn(tx, member.id, current.id, nextDay, position)
        : current.position;

    const updated = await tx.query<TaskRow>(
      `update tasks
          set title = coalesce($2, title),
              estimate_minutes = case when $3::boolean then $4 else estimate_minutes end,
              day_date = $5,
              position = $6,
              status = coalesce($7, status),
              version = version + 1,
              updated_at = now()
        where id = $1
        returning *`,
      [
        current.id,
        title,
        estimateMinutes !== undefined,
        estimateMinutes ?? null,
        nextDay,
        nextPositionValue,
        status,
      ],
    );
    if (dayChanged || position !== null) {
      await renumberColumn(tx, member.id, nextDay);
      if (dayChanged) await renumberColumn(tx, member.id, current.day_date);
    }
    return { conflict: null, task: updated.rows[0]!, previousDay: current.day_date };
  });

  if (outcome.conflict) {
    const current = await taskWithSession(outcome.conflict.id);
    throw versionConflict(current!);
  }

  const task = await taskWithSession(outcome.task.id);
  return {
    task: task!,
    days: await affectedDays(member, [outcome.previousDay, outcome.task.day_date]),
  };
}

function checkPosition(errors: FieldErrors, value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number.NaN;
  if (!Number.isInteger(parsed) || parsed < 0) {
    errors.add('position', 'Use a whole number from 0 upward.');
    return null;
  }
  return parsed;
}

function checkStatus(errors: FieldErrors, value: unknown): TaskStatus | null {
  if (value === 'open' || value === 'done') return value;
  errors.add('status', 'Use open or done.');
  return null;
}

async function suggest(context: RequestContext): Promise<unknown> {
  const { member } = requirePlanner(context);
  const query = context.query.get('q') ?? '';
  if (query.length < 1 || query.length > 100) {
    throw unprocessable('validation_failed', 'Search with 1 to 100 characters.');
  }
  const result = await pool.query<{ id: string; title: string; estimate_minutes: number | null }>(
    `select id, title, estimate_minutes from tasks
      where member_id = $1 and status = 'open' and title ilike '%' || $2 || '%'
      order by updated_at desc, created_at desc
      limit 8`,
    [member.id, query],
  );
  return {
    suggestions: result.rows.map((row) => ({
      id: row.id,
      title: row.title,
      estimateMinutes: row.estimate_minutes,
    })),
  };
}

export function registerTaskRoutes(router: Router): void {
  router.get('/api/board', board);
  router.get('/api/tasks/suggest', suggest);
  router.post('/api/tasks', createTask);
  router.patch('/api/tasks/:id', patchTask);
}
