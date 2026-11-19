import type { Request, Response } from 'express';
import type { PoolClient } from 'pg';
import { ApiError } from '../src-shared/errors.js';
import {
  addDays,
  cleanDate,
  cleanEstimate,
  cleanLocalTime,
  cleanName,
  cleanThreshold,
  cleanTitle,
  compareDates,
  dayLabel,
  isoInstant,
  localDateOf,
  localTimeOf,
  minutesOf,
  requireTimeZone,
} from '../src-shared/domain.js';
import {
  DEFAULT_THRESHOLD,
  FEED_WINDOW,
  MAX_CSV_ROWS,
  ROUTINE_MINUTES_MAX,
  ROUTINE_MINUTES_MIN,
  ROUTINE_MINUTES_STEP,
  SUGGESTION_LIMIT,
  TASK_ESTIMATE_MAX,
  TASK_ESTIMATE_MIN,
  TASK_ESTIMATE_STEP,
} from '../src-shared/constants.js';
import { parseTaskCsv } from '../src-shared/csv.js';
import { parseIcs, buildFeedIcs } from '../src-shared/ics.js';
import { routineAppliesOn } from '../src-shared/routines.js';
import { enqueueOutbox, type OutboxItem } from './outbox.js';
import { hashPassword, hashToken, newFeedToken, newId, newSessionToken, verifyPassword } from './ids.js';
import {
  buildDay,
  loadOwnRoutine,
  loadOwnSession,
  loadOwnTask,
  queryRows,
  sessionToApi,
  toApiMember,
  toApiTask,
  toApiWorkspace,
  routineToApi,
  overlapMinutesOnDate,
  routineOccurrences,
  type MemberRow,
  type MeetingRow,
  type RoutineRow,
  type SessionRow,
  type TaskRow,
} from './repo.js';
import {
  h,
  sendJson,
  memberToday,
  taskDay,
  loadBoardData,
  boardBacklog,
  buildBoardDays,
  affectedDays,
  requireMember,
  requireWritable,
  requireRole,
  requirePlanner,
  isPlainObject,
  cleanVersion,
  applyTaskMove,
  sessionInstants,
  isHalfHour,
  type BoardData,
  type AppDeps,
} from './api-core.js';

// ---------------------------------------------------------------------------
// GET /api/health

export const health = h((_req, res) => Promise.resolve(sendJson(res, 200, { status: 'ok' })));

// ---------------------------------------------------------------------------
// Auth

export function authHandlers(deps: AppDeps) {
  const workspaces = async (req: Request, res: Response): Promise<void> => {
    const body = isPlainObject(req.body) ? req.body : {};
    const workspaceName = cleanName(body.workspaceName, 'workspaceName');
    const ownerName = cleanName(body.ownerName, 'ownerName');
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const emailChecked = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
      ? email
      : (() => {
          throw new ApiError('validation', 'Enter a valid email address.', { fields: { email: 'Enter a valid email address.' } });
        })();
    const password = typeof body.password === 'string' && body.password.length >= 10 ? body.password : (() => {
      throw new ApiError('validation', 'Passwords are at least 10 characters.', { fields: { password: 'Use at least 10 characters.' } });
    })();
    const timeZone = requireTimeZone(body.timeZone);

    const existing = await deps.db.query("SELECT id FROM members WHERE lower(email) = $1 AND removed_at IS NULL", [emailChecked]);
    if (existing.length > 0) throw new ApiError('email_taken', 'That email already has a Daybook.');
    const takenWorkspace = await deps.db.query("SELECT 1 FROM workspaces WHERE lower(name) = lower($1)", [workspaceName]);
    void takenWorkspace;

    const workspaceId = newId('ws');
    const memberId = newId('mem');
    const now = new Date();
    const trialEnds = new Date(now.getTime() + deps.config.timing.trialLengthSeconds * 1000);

    // Register the account and owner seat now when Kill Bill answers; queue when it does not.
    let billingRegistered = true;
    const outbox: OutboxItem[] = [];
    try {
      await deps.killbill.ensureCatalog();
      await deps.killbill.ensureAccount(workspaceId, workspaceName, emailChecked);
      await deps.killbill.ensureSeat(workspaceId, memberId);
    } catch {
      billingRegistered = false;
      outbox.push({ kind: 'billing_account', workspaceId, memberId, workspaceName, ownerEmail: emailChecked });
    }

    const { db } = deps;
    await db.withTransaction(async (client) => {
      await client.query('INSERT INTO workspaces (id, name, state, trial_ends_at, created_at) VALUES ($1, $2, $3, $4, $5)', [
        workspaceId, workspaceName, 'trialing', trialEnds, now,
      ]);
      await client.query(
        `INSERT INTO members (id, workspace_id, name, email, password_hash, role, status, time_zone, threshold_minutes, feed_token, invite_token, invite_used)
         VALUES ($1, $2, $3, $4, $5, 'owner', 'active', $6, $7, $8, NULL, false)`,
        [memberId, workspaceId, ownerName, emailChecked, hashPassword(password), timeZone, DEFAULT_THRESHOLD, newFeedToken()],
      );
      await enqueueOutbox(client, outbox);
    });
    await setSessionCookie(deps, res, memberId);
    const member = (await loadMemberRow(deps, memberId)) as MemberRow;
    const workspace = await deps.db.query<{ id: string; name: string; state: string; trial_ends_at: string }>('SELECT id, name, state, trial_ends_at FROM workspaces WHERE id = $1', [workspaceId]);
    sendJson(res, 201, {
      workspace: toApiWorkspace(workspace[0] ?? { id: workspaceId, name: '', state: 'trialing', trial_ends_at: trialEnds.toISOString() }),
      member: toApiMember(member),
      billing: billingRegistered ? 'registered' : 'queued',
    });
  };

  const signIn = async (req: Request, res: Response): Promise<void> => {
    const body = isPlainObject(req.body) ? req.body : {};
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const rows = await deps.db.query<MemberRow>('SELECT * FROM members WHERE lower(email) = $1 AND removed_at IS NULL', [email]);
    const member = rows[0];
    if (member === undefined || member.status !== 'active' || !verifyPasswordSafe(password, member.password_hash)) {
      throw new ApiError('invalid_credentials', "That email and password don't match.");
    }
    await setSessionCookie(deps, res, member.id);
    const workspace = await deps.db.query<{ id: string; name: string; state: string; trial_ends_at: string }>('SELECT id, name, state, trial_ends_at FROM workspaces WHERE id = $1', [member.workspace_id]);
    sendJson(res, 200, { member: toApiMember(member), workspace: toApiWorkspace(workspace[0] ?? { id: member.workspace_id, name: '', state: 'trialing', trial_ends_at: new Date().toISOString() }) });
  };

  const signOut = async (req: Request, res: Response): Promise<void> => {
    const token = readSessionCookie(req);
    if (token !== null) await deps.db.query('DELETE FROM sessions_auth WHERE token_hash = $1', [hashToken(token)]);
    res.clearCookie('tidemark_session', { httpOnly: true, sameSite: 'lax', path: '/' });
    res.status(204).end();
  };

  const me = async (req: Request, res: Response): Promise<void> => {
    const member = requireMember(req);
    requirePlanner(member);
    const ws = await deps.db.query<{ id: string; name: string; state: string; trial_ends_at: string }>('SELECT id, name, state, trial_ends_at FROM workspaces WHERE id = $1', [member.workspace_id]);
    sendJson(res, 200, {
      member: toApiMember(member),
      workspace: toApiWorkspace(ws[0] ?? { id: member.workspace_id, name: '', state: 'trialing', trial_ends_at: new Date().toISOString() }),
      today: memberToday(member),
    });
  };

  const patchMe = async (req: Request, res: Response): Promise<void> => {
    const member = requireMember(req);
    requirePlanner(member);
    const body = isPlainObject(req.body) ? req.body : {};
    const updates: string[] = [];
    const values: unknown[] = [];
    let zone = member.time_zone;
    let threshold = member.threshold_minutes;
    if (body.timeZone !== undefined) {
      zone = requireTimeZone(body.timeZone);
      updates.push(`time_zone = $${values.length + 1}`);
      values.push(zone);
    }
    if (body.thresholdMinutes !== undefined) {
      threshold = cleanThreshold(body.thresholdMinutes);
      updates.push(`threshold_minutes = $${values.length + 1}`);
      values.push(threshold);
    }
    if (updates.length === 0) {
      sendJson(res, 200, { member: toApiMember(member), today: memberToday(member) });
      return;
    }
    await deps.db.withTransaction(async (client) => {
      await client.query(`UPDATE members SET ${updates.join(', ')} WHERE id = $${values.length + 1}`, [...values, member.id]);
      // Sessions keep their instant; local dates and times are recomputed.
      if (body.timeZone !== undefined && zone !== member.time_zone) {
        const sessions = await queryRows<SessionRow>(client, 'SELECT * FROM sessions WHERE member_id = $1', [member.id]);
        for (const s of sessions) {
          const start = new Date(s.start_at);
          const end = new Date(s.end_at);
          const localStart = localDateOf(start, zone);
          const task = await queryRows<TaskRow>(client, 'SELECT * FROM tasks WHERE id = $1', [s.task_id]);
          const t = task[0];
          if (t === undefined) continue;
          const taskDayStr = t.day_date === null ? null : (typeof t.day_date === 'string' ? t.day_date.slice(0, 10) : t.day_date.toISOString().slice(0, 10));
          if (taskDayStr !== localStart) {
            await client.query('UPDATE tasks SET day_date = $2, version = version + 1 WHERE id = $1', [t.id, localStart]);
          } else {
            await client.query('UPDATE tasks SET version = version + 1 WHERE id = $1', [t.id]);
          }
          await client.query('UPDATE sessions SET version = version + 1 WHERE id = $1', [s.id]);
          void end;
        }
      }
    });
    const fresh = await loadMemberRow(deps, member.id);
    sendJson(res, 200, { member: toApiMember(fresh), today: localDateOf(new Date(), zone) });
  };

  return { workspaces, signIn, signOut, me, patchMe };
}

// ---------------------------------------------------------------------------
// Board and tasks

export function taskHandlers(deps: AppDeps) {
  const board = async (req: Request, res: Response): Promise<void> => {
    const member = requireMember(req);
    requirePlanner(member);
    const today = memberToday(member);
    const rawStart = req.query.start;
    const start = rawStart === undefined ? today : cleanBoardStart(rawStart);
    const data = await loadBoardData(deps, member.id);
    const days = await buildBoardDays(deps, member, start, data);
    sendJson(res, 200, {
      today,
      timeZone: member.time_zone,
      thresholdMinutes: member.threshold_minutes,
      days,
      backlog: boardBacklog(data, today).map((t) => toApiTask(t, data.sessionsByTask.get(t.id) ?? null, member.time_zone)),
    });
  };

  const createTask = async (req: Request, res: Response): Promise<void> => {
    const member = requireMember(req);
    requirePlanner(member);
    await requireWritable(deps, member);
    const body = isPlainObject(req.body) ? req.body : {};
    const title = cleanTitle(body.title);
    const estimate = body.estimateMinutes === undefined ? null : cleanEstimate(body.estimateMinutes, 'estimateMinutes', TASK_ESTIMATE_MIN, TASK_ESTIMATE_MAX, TASK_ESTIMATE_STEP);
    const today = memberToday(member);
    const dayDate = body.dayDate === undefined || body.dayDate === null ? null : resolveDay(member, today, body.dayDate);
    const task = await deps.db.withTransaction(async (client) => {
      const id = newId('task');
      const day = dayDate;
      if (day !== null) {
        const existing = await queryRows<{ n: number }>(client, 'SELECT COALESCE(MAX(position), -1) + 1 AS n FROM tasks WHERE member_id = $1 AND day_date = $2', [member.id, day]);
        const pos = existing[0]?.n ?? 0;
        await client.query(
          'INSERT INTO tasks (id, member_id, title, estimate_minutes, day_date, position, status, version) VALUES ($1, $2, $3, $4, $5, $6, $7, 1)',
          [id, member.id, title, estimate, day, pos, 'open'],
        );
      } else {
        const existing = await queryRows<{ n: number }>(client, 'SELECT COALESCE(MAX(position), -1) + 1 AS n FROM tasks WHERE member_id = $1 AND day_date IS NULL', [member.id]);
        const pos = existing[0]?.n ?? 0;
        await client.query(
          'INSERT INTO tasks (id, member_id, title, estimate_minutes, day_date, position, status, version) VALUES ($1, $2, $3, $4, NULL, $5, $6, 1)',
          [id, member.id, title, estimate, pos, 'open'],
        );
      }
      const rows = await queryRows<TaskRow>(client, 'SELECT * FROM tasks WHERE id = $1', [id]);
      return rows[0];
    });
    if (task === undefined) throw new ApiError('bad_request', 'Something went wrong on our side. Nothing was changed.');
    const data = await loadBoardData(deps, member.id);
    const dates: string[] = [];
    if (taskDay(task) !== null) dates.push(taskDay(task) as string);
    sendJson(res, 201, { task: toApiTask(task, null, member.time_zone), days: await affectedDays(deps, member, dates, data) });
  };

  const patchTask = async (req: Request, res: Response): Promise<void> => {
    const member = requireMember(req);
    requirePlanner(member);
    await requireWritable(deps, member);
    const taskId = String(req.params.id);
    const body = isPlainObject(req.body) ? req.body : {};
    const version = cleanVersion(body.version);
    const today = memberToday(member);

    const result = await deps.db.withTransaction(async (client): Promise<{ task: TaskRow; session: SessionRow | null }> => {
      const rows = await queryRows<TaskRow>(client, 'SELECT * FROM tasks WHERE id = $1 AND member_id = $2 FOR UPDATE', [taskId, member.id]);
      const task = rows[0];
      if (task === undefined) throw new ApiError('not_found', "That task doesn't exist.");
      if (task.version !== version) {
        const session = await queryRows<SessionRow>(client, 'SELECT * FROM sessions WHERE task_id = $1', [task.id]);
        throw new ApiError('version_conflict', 'This task was changed on another device.', { current: toApiTask(task, session[0] ?? null, member.time_zone) });
      }

      let newDay: string | null | undefined;
      if (body.dayDate !== undefined) {
        newDay = body.dayDate === null ? null : resolveDay(member, today, body.dayDate as string);
      }
      const newTitle = body.title === undefined ? undefined : cleanTitle(body.title);
      const newEstimate = body.estimateMinutes === undefined ? undefined : (body.estimateMinutes === null ? null : cleanEstimate(body.estimateMinutes, 'estimateMinutes', TASK_ESTIMATE_MIN, TASK_ESTIMATE_MAX, TASK_ESTIMATE_STEP));
      const newPosition = body.position === undefined ? undefined : (typeof body.position === 'number' && Number.isInteger(body.position) && body.position >= 0 ? body.position : (() => {
        throw new ApiError('validation', 'Position is a whole number.', { fields: { position: 'Enter a whole number.' } });
      })());
      const newStatus = body.status === undefined ? undefined : (body.status === 'done' || body.status === 'open' ? body.status : (() => {
        throw new ApiError('validation', 'Status is open or done.', { fields: { status: 'Choose open or done.' } });
      })());

      const dayChanged = newDay !== undefined && newDay !== taskDay(task);
      if (dayChanged) {
        await applyTaskMove(client, member, today, task, newDay as string | null, newPosition);
      } else if (newPosition !== undefined && !dayChanged) {
        const day = taskDay(task);
        const target = newPosition;
        const existing = await queryRows<{ n: number }>(client, day === null ? 'SELECT COALESCE(MAX(position), -1) + 1 AS n FROM tasks WHERE member_id = $1 AND day_date IS NULL' : 'SELECT COALESCE(MAX(position), -1) + 1 AS n FROM tasks WHERE member_id = $1 AND day_date = $2', day === null ? [member.id] : [member.id, day]);
        const count = existing[0]?.n ?? 0;
        const at = Math.max(0, Math.min(target, count - 1));
        if (at !== task.position) {
          if (at > task.position) {
            await client.query('UPDATE tasks SET position = position - 1 WHERE member_id = $1 AND ' + (day === null ? 'day_date IS NULL' : 'day_date = $2') + ' AND position > $3 AND position <= $4', day === null ? [member.id, task.position, at] : [member.id, day, task.position, at]);
          } else {
            await client.query('UPDATE tasks SET position = position + 1 WHERE member_id = $1 AND ' + (day === null ? 'day_date IS NULL' : 'day_date = $2') + ' AND position >= $3 AND position < $4', day === null ? [member.id, at, task.position] : [member.id, day, at, task.position]);
          }
          await client.query('UPDATE tasks SET position = $2, version = version + 1, updated_at = now() WHERE id = $1', [task.id, at]);
        }
      }

      const sets: string[] = [];
      const values: unknown[] = [];
      if (newTitle !== undefined) {
        values.push(newTitle);
        sets.push(`title = $${values.length}`);
      }
      if (newEstimate !== undefined) {
        values.push(newEstimate);
        sets.push(`estimate_minutes = $${values.length}`);
      }
      if (newStatus !== undefined) {
        values.push(newStatus);
        sets.push(`status = $${values.length}`);
      }
      if (sets.length > 0) {
        sets.push('version = version + 1');
        sets.push('updated_at = now()');
        values.push(task.id);
        await client.query(`UPDATE tasks SET ${sets.join(', ')} WHERE id = $${values.length}`, values);
      }
      const after = await queryRows<TaskRow>(client, 'SELECT * FROM tasks WHERE id = $1', [task.id]);
      const session = await queryRows<SessionRow>(client, 'SELECT * FROM sessions WHERE task_id = $1', [task.id]);
      return { task: after[0] as TaskRow, session: session[0] ?? null };
    });

    const data = await loadBoardData(deps, member.id);
    const dates: string[] = [];
    const beforeDay = taskDay(result.task);
    if (beforeDay !== null) dates.push(beforeDay);
    if (result.session !== null) dates.push(localDateOf(new Date(result.session.start_at), member.time_zone));
    sendJson(res, 200, {
      task: toApiTask(result.task, result.session, member.time_zone),
      days: await affectedDays(deps, member, dates, data),
    });
  };

  const suggest = async (req: Request, res: Response): Promise<void> => {
    const member = requireMember(req);
    requirePlanner(member);
    const q = req.query.q;
    if (typeof q !== 'string' || q.length < 1 || q.length > 100) {
      throw new ApiError('validation', 'Type between 1 and 100 characters.', { fields: { q: 'Type between 1 and 100 characters.' } });
    }
    const rows = await deps.db.query<Pick<TaskRow, 'id' | 'title' | 'estimate_minutes' | 'updated_at'>>(
      `SELECT id, title, estimate_minutes, updated_at FROM tasks
       WHERE member_id = $1 AND status = 'open' AND lower(title) LIKE '%' || lower($2) || '%'
       ORDER BY updated_at DESC, id LIMIT ${SUGGESTION_LIMIT}`,
      [member.id, q],
    );
    sendJson(res, 200, { suggestions: rows.map((r) => ({ id: r.id, title: r.title, estimateMinutes: r.estimate_minutes })) });
  };

  return { board, createTask, patchTask, suggest };
}

// ---------------------------------------------------------------------------
// Sessions

export function sessionHandlers(deps: AppDeps) {
  const create = async (req: Request, res: Response): Promise<void> => {
    const member = requireMember(req);
    requirePlanner(member);
    await requireWritable(deps, member);
    const key = req.header('Idempotency-Key') ?? '';
    if (key.length < 1 || key.length > 200) throw new ApiError('idempotency_key_required', 'Send an Idempotency-Key header of 1 to 200 characters.');
    const body = isPlainObject(req.body) ? req.body : {};
    const taskId = typeof body.taskId === 'string' ? body.taskId : (() => {
      throw new ApiError('validation', 'Send the task to timebox.', { fields: { taskId: 'Send the task to timebox.' } });
    })();
    const date = cleanDate(body.date, 'date');
    const startTime = cleanLocalTime(body.startTime, 'startTime');
    const today = memberToday(member);
    if (compareDates(date, today) < 0) throw new ApiError('day_in_past', 'That day has already passed.');
    if (!isHalfHour(startTime)) {
      throw new ApiError('validation', 'Start times are on the half hour.', { fields: { startTime: 'Choose a time ending :00 or :30.' } });
    }

    const requestHash = hashToken(JSON.stringify({ taskId, date, startTime, member: member.id }));
    const replayed = await deps.db.query<{ status: number; body: unknown; request_hash: string }>(
      'SELECT status, body, request_hash FROM idempotency WHERE member_id = $1 AND key = $2 AND created_at > now() - ($3 || \' seconds\')::interval',
      [member.id, key, String(deps.config.timing.idempotencyTtlSeconds)],
    );
    if (replayed.length > 0) {
      const stored = replayed[0] as { status: number; body: unknown; request_hash: string };
      if (stored.request_hash !== requestHash) throw new ApiError('idempotency_key_mismatch', 'That idempotency key was used with a different request.');
      sendJson(res, stored.status, stored.body, { 'Idempotent-Replayed': 'true' });
      return;
    }

    const result = await deps.db.withTransaction(async (client) => {
      const task = await loadOwnTask(client, member.id, taskId);
      const estimate = task.estimate_minutes;
      if (estimate === null) {
        throw new ApiError('estimate_required', 'Add an estimate first.');
      }
      const existingSession = await queryRows<SessionRow>(client, 'SELECT * FROM sessions WHERE task_id = $1 FOR UPDATE', [task.id]);
      if (existingSession.length > 0) {
        throw new ApiError('already_scheduled', "It's already on the calendar.", { current: sessionToApi(existingSession[0] as SessionRow, task.title, member.time_zone) });
      }
      const instants = sessionInstants(member, date, startTime, estimate);
      if (instants === null) throw new ApiError('crosses_midnight', 'It would run past midnight.');
      const id = newId('sess');
      await client.query('INSERT INTO sessions (id, task_id, member_id, start_at, end_at, version) VALUES ($1, $2, $3, $4, $5, 1)', [id, task.id, member.id, instants.startAt, instants.endAt]);
      await client.query('UPDATE tasks SET day_date = $2, version = version + 1, updated_at = now() WHERE id = $1', [task.id, date]);
      const freshTask = await queryRows<TaskRow>(client, 'SELECT * FROM tasks WHERE id = $1', [task.id]);
      const session = await queryRows<SessionRow>(client, 'SELECT * FROM sessions WHERE id = $1', [id]);
      const response = {
        session: sessionToApi(session[0] as SessionRow, (freshTask[0] as TaskRow).title, member.time_zone),
        task: toApiTask(freshTask[0] as TaskRow, session[0] ?? null, member.time_zone),
        days: [] as unknown[],
      };
      await client.query('INSERT INTO idempotency (member_id, key, request_hash, status, body) VALUES ($1, $2, $3, $4, $5)', [member.id, key, requestHash, 201, JSON.stringify(response)]);
      return response;
    });

    const data = await loadBoardData(deps, member.id);
    const days = await affectedDays(deps, member, [date], data);
    const responseBody = { ...result, days };
    // Update the stored idempotency body to include the days.
    await deps.db.query('UPDATE idempotency SET body = $3 WHERE member_id = $1 AND key = $2', [member.id, key, JSON.stringify(responseBody)]);
    sendJson(res, 201, responseBody);
  };

  const patch = async (req: Request, res: Response): Promise<void> => {
    const member = requireMember(req);
    requirePlanner(member);
    await requireWritable(deps, member);
    const sessionId = String(req.params.id);
    const body = isPlainObject(req.body) ? req.body : {};
    const version = cleanVersion(body.version);
    const date = cleanDate(body.date, 'date');
    const startTime = cleanLocalTime(body.startTime, 'startTime');
    const today = memberToday(member);
    if (compareDates(date, today) < 0) throw new ApiError('day_in_past', 'That day has already passed.');
    if (!isHalfHour(startTime)) {
      throw new ApiError('validation', 'Start times are on the half hour.', { fields: { startTime: 'Choose a time ending :00 or :30.' } });
    }

    const result = await deps.db.withTransaction(async (client) => {
      const session = await loadOwnSession(client, member.id, sessionId);
      const task = await loadOwnTask(client, member.id, session.task_id);
      const rows = await queryRows<SessionRow>(client, 'SELECT * FROM sessions WHERE id = $1 FOR UPDATE', [session.id]);
      const current = rows[0];
      if (current === undefined) throw new ApiError('not_found', "That session doesn't exist.");
      if (current.version !== version) {
        throw new ApiError('version_conflict', 'This session was changed on another device.', { current: sessionToApi(current, task.title, member.time_zone) });
      }
      const estimate = task.estimate_minutes;
      if (estimate === null) throw new ApiError('estimate_required', 'Add an estimate first.');
      const instants = sessionInstants(member, date, startTime, estimate);
      if (instants === null) throw new ApiError('crosses_midnight', 'It would run past midnight.');
      await client.query('UPDATE sessions SET start_at = $2, end_at = $3, version = version + 1 WHERE id = $1', [session.id, instants.startAt, instants.endAt]);
      const oldDay = localDateOf(new Date(current.start_at), member.time_zone);
      if (oldDay !== date) {
        await client.query('UPDATE tasks SET day_date = $2, version = version + 1, updated_at = now() WHERE id = $1', [task.id, date]);
      } else {
        await client.query('UPDATE tasks SET version = version + 1, updated_at = now() WHERE id = $1', [task.id]);
      }
      const freshSession = await queryRows<SessionRow>(client, 'SELECT * FROM sessions WHERE id = $1', [session.id]);
      const freshTask = await queryRows<TaskRow>(client, 'SELECT * FROM tasks WHERE id = $1', [task.id]);
      return {
        session: sessionToApi(freshSession[0] as SessionRow, (freshTask[0] as TaskRow).title, member.time_zone),
        task: toApiTask(freshTask[0] as TaskRow, freshSession[0] ?? null, member.time_zone),
        oldDay,
        newDay: date,
      };
    });

    const data = await loadBoardData(deps, member.id);
    const dates = [result.oldDay, result.newDay];
    sendJson(res, 200, {
      session: result.session,
      task: result.task,
      days: await affectedDays(deps, member, dates, data),
    });
  };

  const remove = async (req: Request, res: Response): Promise<void> => {
    const member = requireMember(req);
    requirePlanner(member);
    await requireWritable(deps, member);
    const sessionId = String(req.params.id);
    const raw = req.query.version;
    const version = typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : (() => {
      throw new ApiError('validation', 'Send the version you based this change on.', { fields: { version: 'Send the current version.' } });
    })();
    const day = await deps.db.withTransaction(async (client) => {
      const rows = await queryRows<SessionRow>(client, 'SELECT * FROM sessions WHERE id = $1 AND member_id = $2 FOR UPDATE', [sessionId, member.id]);
      const session = rows[0];
      if (session === undefined) throw new ApiError('not_found', "That session doesn't exist.");
      if (session.version !== version) {
        const task = await loadOwnTask(client, member.id, session.task_id);
        throw new ApiError('version_conflict', 'This session was changed on another device.', { current: sessionToApi(session, task.title, member.time_zone) });
      }
      await client.query('DELETE FROM sessions WHERE id = $1', [session.id]);
      return localDateOf(new Date(session.start_at), member.time_zone);
    });
    const data = await loadBoardData(deps, member.id);
    res.status(204).end();
    void day;
    void data;
  };

  const calendar = async (req: Request, res: Response): Promise<void> => {
    const member = requireMember(req);
    requirePlanner(member);
    const from = cleanDate(req.query.from, 'from');
    const to = cleanDate(req.query.to, 'to');
    if (compareDates(to, from) > 0 || Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400000) > 30) {
      throw new ApiError('validation', 'The range is at most 31 days.', { fields: { to: 'Choose a range of at most 31 days.' } });
    }
    const [sessions, tasks, routines] = await Promise.all([
      deps.db.query<SessionRow>('SELECT * FROM sessions WHERE member_id = $1', [member.id]),
      deps.db.query<TaskRow>('SELECT * FROM tasks WHERE member_id = $1', [member.id]),
      deps.db.query<RoutineRow>('SELECT * FROM routines WHERE member_id = $1', [member.id]),
    ]);
    const byId = new Map(tasks.map((t) => [t.id, t]));
    const items: Array<{ kind: 'session' | 'routine' | 'meeting'; id: string; title: string; date: string; startTime: string; endTime: string; start: string; end: string; version?: number }> = [];
    for (const s of sessions) {
      const task = byId.get(s.task_id);
      const date = localDateOf(new Date(s.start_at), member.time_zone);
      if (compareDates(date, from) < 0 || compareDates(date, to) > 0) continue;
      items.push({
        kind: 'session',
        id: s.id,
        title: task?.title ?? '',
        date,
        startTime: localTimeOf(new Date(s.start_at), member.time_zone),
        endTime: localTimeOf(new Date(s.end_at), member.time_zone),
        start: isoInstant(new Date(s.start_at)),
        end: isoInstant(new Date(s.end_at)),
        version: s.version,
      });
    }
    const occurrences = routineOccurrences(member.id, routines, from, to, member.time_zone);
    const routineNames = new Map(routines.map((r) => [r.id, r.name]));
    for (const occ of occurrences) {
      items.push({ kind: 'routine', id: occ.id, title: routineNames.get(occ.routineId) ?? '', date: occ.date, startTime: occ.startTime, endTime: occ.endTime, start: occ.start, end: occ.end });
    }
    const meetings = await deps.db.query<MeetingRow>('SELECT * FROM meetings WHERE member_id = $1', [member.id]);
    for (const m of meetings) {
      const date = localDateOf(new Date(m.start_at), member.time_zone);
      if (compareDates(date, from) < 0 || compareDates(date, to) > 0) continue;
      items.push({
        kind: 'meeting',
        id: m.id,
        title: m.summary,
        date,
        startTime: localTimeOf(new Date(m.start_at), member.time_zone),
        endTime: localTimeOf(new Date(m.end_at), member.time_zone),
        start: isoInstant(new Date(m.start_at)),
        end: isoInstant(new Date(m.end_at)),
      });
    }
    sendJson(res, 200, { timeZone: member.time_zone, items });
  };

  return { create, patch, remove, calendar };
}

// ---------------------------------------------------------------------------
// Routines

export function routineHandlers(deps: AppDeps) {
  const list = async (req: Request, res: Response): Promise<void> => {
    const member = requireMember(req);
    requirePlanner(member);
    const rows = await deps.db.query<RoutineRow>('SELECT * FROM routines WHERE member_id = $1 ORDER BY start_time, id', [member.id]);
    sendJson(res, 200, { routines: rows.map(routineToApi) });
  };

  const create = async (req: Request, res: Response): Promise<void> => {
    const member = requireMember(req);
    requirePlanner(member);
    await requireWritable(deps, member);
    const body = isPlainObject(req.body) ? req.body : {};
    const name = cleanTitle(body.name);
    const startTime = cleanLocalTime(body.startTime, 'startTime');
    const duration = body.durationMinutes === undefined ? undefined : cleanEstimate(body.durationMinutes, 'durationMinutes', ROUTINE_MINUTES_MIN, ROUTINE_MINUTES_MAX, ROUTINE_MINUTES_STEP);
    if (duration === undefined || duration === null) {
      throw new ApiError('validation', `Minutes are ${ROUTINE_MINUTES_MIN} to ${ROUTINE_MINUTES_MAX} in steps of ${ROUTINE_MINUTES_STEP}.`, { fields: { durationMinutes: `Enter ${ROUTINE_MINUTES_MIN} to ${ROUTINE_MINUTES_MAX} in steps of ${ROUTINE_MINUTES_STEP}.` } });
    }
    const repeats = body.repeats === 'weekdays' ? 'weekdays' : body.repeats === 'daily' ? 'daily' : (() => {
      throw new ApiError('validation', 'Repeats is every day or weekdays.', { fields: { repeats: 'Choose every day or weekdays.' } });
    })();
    const id = newId('routine');
    await deps.db.query('INSERT INTO routines (id, member_id, name, start_time, duration_minutes, repeats) VALUES ($1, $2, $3, $4, $5, $6)', [id, member.id, name, startTime, duration, repeats]);
    const rows = await deps.db.query<RoutineRow>('SELECT * FROM routines WHERE id = $1', [id]);
    sendJson(res, 201, { routine: routineToApi(rows[0] as RoutineRow) });
  };

  const remove = async (req: Request, res: Response): Promise<void> => {
    const member = requireMember(req);
    requirePlanner(member);
    await requireWritable(deps, member);
    const id = String(req.params.id);
    const rows = await deps.db.query<RoutineRow>('SELECT * FROM routines WHERE id = $1 AND member_id = $2', [id, member.id]);
    if (rows.length === 0) throw new ApiError('not_found', "That routine doesn't exist.");
    await deps.db.query('DELETE FROM routines WHERE id = $1', [id]);
    res.status(204).end();
  };

  return { list, create, remove };
}

// ---------------------------------------------------------------------------
// Feed

export function feedHandlers(deps: AppDeps) {
  const urlFor = (req: Request, token: string): string => `${originOf(req)}/feed/${token}.ics`;

  const getFeedUrl = async (req: Request, res: Response): Promise<void> => {
    const member = requireMember(req);
    requirePlanner(member);
    sendJson(res, 200, { url: urlFor(req, member.feed_token) });
  };

  const rotate = async (req: Request, res: Response): Promise<void> => {
    const member = requireMember(req);
    requirePlanner(member);
    await deps.db.query('UPDATE members SET feed_token = $2 WHERE id = $1', [member.id, newFeedToken()]);
    const fresh = await loadMemberRow(deps, member.id);
    sendJson(res, 200, { url: urlFor(req, fresh.feed_token) });
  };

  const serve = async (req: Request, res: Response): Promise<void> => {
    const match = /^\/([A-Za-z0-9_-]+)\.ics$/.exec(req.path);
    const token = match === null ? '' : (match[1] ?? '');
    const rows = await deps.db.query<MemberRow>('SELECT * FROM members WHERE feed_token = $1 AND removed_at IS NULL', [token]);
    const member = rows[0];
    if (member === undefined || token === '') {
      res.status(404).type('text/plain').send('Not found');
      return;
    }
    const today = localDateOf(new Date(), member.time_zone);
    const from = addDays(today, -FEED_WINDOW.daysBack);
    const to = addDays(today, FEED_WINDOW.daysForward);
    const [sessions, tasks, routines] = await Promise.all([
      deps.db.query<SessionRow>('SELECT * FROM sessions WHERE member_id = $1', [member.id]),
      deps.db.query<TaskRow>('SELECT * FROM tasks WHERE member_id = $1', [member.id]),
      deps.db.query<RoutineRow>('SELECT * FROM routines WHERE member_id = $1', [member.id]),
    ]);
    const byId = new Map(tasks.map((t) => [t.id, t]));
    const events: Array<{ uid: string; summary: string; start: Date; end: Date }> = [];
    for (const s of sessions) {
      const date = localDateOf(new Date(s.start_at), member.time_zone);
      if (compareDates(date, from) < 0 || compareDates(date, to) > 0) continue;
      events.push({ uid: `session-${s.id}@tidemark`, summary: byId.get(s.task_id)?.title ?? '', start: new Date(s.start_at), end: new Date(s.end_at) });
    }
    const occurrences = routineOccurrences(member.id, routines, from, to, member.time_zone);
    const routineNames = new Map(routines.map((r) => [r.id, r.name]));
    for (const occ of occurrences) {
      events.push({ uid: `routine-${occ.routineId}-${occ.date.replace(/-/g, '')}@tidemark`, summary: routineNames.get(occ.routineId) ?? '', start: new Date(occ.start), end: new Date(occ.end) });
    }
    events.sort((a, b) => a.start.getTime() - b.start.getTime() || (a.uid < b.uid ? -1 : 1));
    res
      .status(200)
      .setHeader('Content-Type', 'text/calendar; charset=utf-8')
      .setHeader('Cache-Control', 'no-store')
      .send(buildFeedIcs(events));
  };

  return { getFeedUrl, rotate, serve };
}

// ---------------------------------------------------------------------------
// Helpers shared by route modules

export async function loadMemberRow(deps: AppDeps, memberId: string): Promise<MemberRow> {
  const rows = await deps.db.query<MemberRow>('SELECT * FROM members WHERE id = $1', [memberId]);
  const m = rows[0];
  if (m === undefined) throw new ApiError('not_found', "That member doesn't exist.");
  return m;
}

export function setSessionCookie(deps: AppDeps, res: Response, memberId: string): Promise<void> {
  const token = newSessionTokenValue();
  const expiresAt = new Date(Date.now() + deps.config.timing.sessionTtlSeconds * 1000);
  void deps.db.query('INSERT INTO sessions_auth (token_hash, member_id, expires_at) VALUES ($1, $2, $3)', [hashToken(token), memberId, expiresAt]);
  res.cookie('tidemark_session', token, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: deps.config.timing.sessionTtlSeconds * 1000 });
  return Promise.resolve();
}

/** Parses the session cookie without a cookie-parser dependency. */
export function readSessionCookie(req: Request): string | null {
  const header = req.header('Cookie') ?? '';
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === 'tidemark_session') {
      const value = part.slice(eq + 1).trim();
      return value.length > 0 ? value : null;
    }
  }
  return null;
}

function newSessionTokenValue(): string {
  return newSessionToken();
}

export const verifyPasswordSafe = verifyPassword;

export function originOf(req: Request): string {
  const proto = req.header('X-Forwarded-Proto') ?? req.protocol;
  const host = req.header('X-Forwarded-Host') ?? req.header('Host') ?? '';
  return `${proto}://${host}`;
}

function cleanBoardStart(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value + 'T00:00:00Z'))) {
    throw new ApiError('validation', 'Enter a date written YYYY-MM-DD.', { fields: { start: 'Use the format YYYY-MM-DD.' } });
  }
  return value;
}

function resolveDay(member: MemberRow, today: string, value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value + 'T00:00:00Z'))) {
    throw new ApiError('validation', 'Enter a date written YYYY-MM-DD.', { fields: { dayDate: 'Use the format YYYY-MM-DD.' } });
  }
  if (compareDates(value, today) < 0) throw new ApiError('day_in_past', 'That day has already passed.');
  return value;
}

