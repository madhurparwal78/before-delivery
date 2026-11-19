import type { PoolClient } from 'pg';
import { pool, withTransaction } from '../db/pool.js';
import type { SessionRow, TaskRow } from '../db/records.js';
import type { SessionDto } from '../../shared/types.js';
import { Response, created, noContent } from '../http/server.js';
import { jsonBody, requirePlanner, requireWritable, type RequestContext } from '../http/context.js';
import { conflict, notFound, unprocessable, versionConflict } from '../http/errors.js';
import { FieldErrors, checkDate, checkTime, checkVersion } from '../http/validate.js';
import { newId } from '../services/auth.js';
import { requestHash, requireIdempotencyKey, withIdempotency } from '../services/idempotency.js';
import { affectedDays, taskWithSession } from '../services/planner.js';
import { isSlotStart, sessionTimes } from '../domain/sessions.js';
import { compareDates, instantToIso, todayInZone } from '../../shared/time.js';
import type { Router } from '../http/router.js';

function sessionDto(session: SessionRow, title: string): SessionDto {
  return {
    id: session.id,
    taskId: session.task_id,
    title,
    date: session.local_date,
    startTime: session.start_time,
    endTime: session.end_time,
    start: instantToIso(session.start_instant),
    end: instantToIso(session.end_instant),
    version: session.version,
  };
}

function guardSlot(date: string, startTime: string, timeZone: string, estimate: number): {
  start: Date;
  end: Date;
  endTime: string;
} {
  if (!isSlotStart(startTime)) {
    throw unprocessable('validation_failed', 'Start a session on the hour or the half hour.');
  }
  if (compareDates(date, todayInZone(timeZone)) < 0) {
    throw unprocessable('day_in_past', 'That day has already passed.');
  }
  const times = sessionTimes(date, startTime, estimate, timeZone);
  if (times === 'crosses_midnight') {
    throw unprocessable('crosses_midnight', 'It would run past midnight.');
  }
  return times;
}

async function ownTask(tx: PoolClient, memberId: string, taskId: unknown): Promise<TaskRow> {
  if (typeof taskId !== 'string' || !/^[0-9a-f-]{36}$/i.test(taskId)) throw notFound();
  const result = await tx.query<TaskRow>(
    'select * from tasks where id = $1 and member_id = $2 for update',
    [taskId, memberId],
  );
  const row = result.rows[0];
  if (!row) throw notFound();
  return row;
}

async function createSession(context: RequestContext): Promise<Response> {
  const { member } = requirePlanner(context);
  const key = requireIdempotencyKey(context.request.headers['idempotency-key']);
  const hash = requestHash(context.path, context.rawBody);

  return withIdempotency(member.id, key, hash, async () => {
    requireWritable(context);
    const body = jsonBody(context);

    const outcome = await withTransaction(async (tx) => {
      const task = await ownTask(tx, member.id, body.taskId);
      const existing = await tx.query('select 1 from task_sessions where task_id = $1', [task.id]);
      if ((existing.rowCount ?? 0) > 0) {
        throw conflict('already_scheduled', "It's already on the calendar.");
      }
      const errors = new FieldErrors();
      const date = checkDate(errors, 'date', body.date);
      const startTime = checkTime(errors, 'startTime', body.startTime);
      errors.throwIfAny();
      if (task.estimate_minutes === null) {
        throw unprocessable('estimate_required', 'Add an estimate first.');
      }
      const times = guardSlot(date!, startTime, member.time_zone, task.estimate_minutes);

      const inserted = await tx.query<SessionRow>(
        `insert into task_sessions (id, task_id, member_id, local_date, start_time, end_time,
                                    start_instant, end_instant, version, created_at, updated_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, 1, now(), now())
         returning *`,
        [newId(), task.id, member.id, date, startTime, times.endTime, times.start, times.end],
      );
      if (task.day_date !== date) {
        await tx.query(
          'update tasks set day_date = $2, version = version + 1, updated_at = now() where id = $1',
          [task.id, date],
        );
      }
      return { session: inserted.rows[0]!, previousDay: task.day_date, title: task.title };
    }).catch((error: unknown) => {
      if (error instanceof Error && 'code' in error && error.code === '23505') {
        throw conflict('already_scheduled', "It's already on the calendar.");
      }
      throw error;
    });

    const task = await taskWithSession(outcome.session.task_id);
    return created({
      session: sessionDto(outcome.session, outcome.title),
      task: task!,
      days: await affectedDays(member, [outcome.previousDay, outcome.session.local_date]),
    });
  });
}

async function patchSession(context: RequestContext): Promise<unknown> {
  const { member } = requirePlanner(context);
  requireWritable(context);
  const body = jsonBody(context);
  const id = context.params.id ?? '';

  const outcome = await withTransaction(async (tx) => {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound();
    const found = await tx.query<SessionRow>(
      'select * from task_sessions where id = $1 and member_id = $2 for update',
      [id, member.id],
    );
    const session = found.rows[0];
    if (!session) throw notFound();

    const errors = new FieldErrors();
    const version = checkVersion(errors, 'version', body.version);
    const date = checkDate(errors, 'date', body.date);
    const startTime = checkTime(errors, 'startTime', body.startTime);
    errors.throwIfAny();

    const task = await tx.query<TaskRow>('select * from tasks where id = $1 for update', [session.task_id]);
    const taskRow = task.rows[0]!;
    if (session.version !== version) {
      return { conflict: session, title: taskRow.title, session: null, previousDay: null };
    }

    const times = guardSlot(date!, startTime, member.time_zone, taskRow.estimate_minutes ?? 0);
    const updated = await tx.query<SessionRow>(
      `update task_sessions
          set local_date = $2, start_time = $3, end_time = $4, start_instant = $5, end_instant = $6,
              version = version + 1, updated_at = now()
        where id = $1 and version = $7
        returning *`,
      [session.id, date, startTime, times.endTime, times.start, times.end, version],
    );
    const row = updated.rows[0];
    if (!row) return { conflict: session, title: taskRow.title, session: null, previousDay: null };

    if (taskRow.day_date !== date) {
      await tx.query(
        'update tasks set day_date = $2, version = version + 1, updated_at = now() where id = $1',
        [taskRow.id, date],
      );
    }
    return { conflict: null, session: row, previousDay: taskRow.day_date, title: taskRow.title };
  });

  if (outcome.conflict) {
    const fresh = await pool.query<SessionRow>('select * from task_sessions where id = $1', [id]);
    throw versionConflict(sessionDto(fresh.rows[0] ?? outcome.conflict, outcome.title));
  }

  const task = await taskWithSession(outcome.session.task_id);
  return {
    session: sessionDto(outcome.session, outcome.title),
    task: task!,
    days: await affectedDays(member, [outcome.previousDay, outcome.session.local_date]),
  };
}

async function deleteSession(context: RequestContext): Promise<Response> {
  const { member } = requirePlanner(context);
  requireWritable(context);
  const id = context.params.id ?? '';
  const versionParam = context.query.get('version');

  const outcome = await withTransaction(async (tx) => {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound();
    const found = await tx.query<SessionRow>(
      'select * from task_sessions where id = $1 and member_id = $2 for update',
      [id, member.id],
    );
    const session = found.rows[0];
    if (!session) throw notFound();

    const version = Number(versionParam);
    if (!Number.isInteger(version) || version < 1) {
      throw unprocessable('validation_failed', 'Send the version you based this change on.');
    }
    const task = await tx.query<TaskRow>('select * from tasks where id = $1', [session.task_id]);
    if (session.version !== version) return { conflict: session, title: task.rows[0]!.title };
    await tx.query('delete from task_sessions where id = $1 and version = $2', [id, version]);
    return { conflict: null, title: '' };
  });

  if (outcome.conflict) {
    throw versionConflict(sessionDto(outcome.conflict, outcome.title));
  }
  return noContent();
}

export function registerSessionRoutes(router: Router): void {
  router.post('/api/sessions', createSession);
  router.patch('/api/sessions/:id', patchSession);
  router.delete('/api/sessions/:id', deleteSession);
}
