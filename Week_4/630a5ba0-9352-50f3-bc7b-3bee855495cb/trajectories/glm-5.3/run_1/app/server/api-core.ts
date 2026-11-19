import express, { type Request, type Response, type NextFunction, type RequestHandler, type Express } from 'express';
import type { PoolClient } from 'pg';
import { Database } from './db.js';
import { loadConfig, type Config } from './config.js';
import { applySchema } from './schema.js';
import { runSeed } from './seed.js';
import { KillBillClient, KillBillError } from './killbill.js';
import { Mailer, type MailMessage } from './mail.js';
import { OutboxWorker, enqueueOutbox, type OutboxItem } from './outbox.js';
import { hashPassword, hmacSign, hashToken, newFeedToken, newId, newInviteToken, newSessionToken, verifyPassword } from './ids.js';
import { ApiError, errorBody, reasonText } from '../src-shared/errors.js';
import {
  addDays,
  cleanDate,
  cleanEmail,
  cleanEstimate,
  cleanLocalTime,
  cleanName,
  cleanPassword,
  cleanThreshold,
  cleanTitle,
  compareDates,
  dayLabel,
  isoInstant,
  isoWeekDates,
  isoWeekOf,
  isKnownTimeZone,
  localDateOf,
  localTimeOf,
  minutesOf,
  requireTimeZone,
  wallClockToInstant,
  wallStamp,
} from '../src-shared/domain.js';
import {
  DEFAULT_THRESHOLD,
  FEED_WINDOW,
  MAX_CSV_ROWS,
  MAX_IMPORT_BYTES,
  MAX_JSON_BYTES,
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
import {
  buildDay,
  loadMember,
  loadMemberByEmail,
  loadMemberByToken,
  loadOwnRoutine,
  loadOwnSession,
  loadOwnTask,
  queryRows,
  routineFromRow,
  sessionToApi,
  toApiMember,
  toApiTask,
  toApiWorkspace,
  routineToApi,
  overlapMinutesOnDate,
  routineOccurrences,
  taskDay,
  type MemberRow,
  type MeetingRow,
  type RoutineRow,
  type SessionRow,
  type TaskRow,
} from './repo.js';
import {
  eventApplied,
  loadWorkspace,
  newestSeatsEvent,
  replayState,
  workspaceLock,
  type StateEventRow,
  type WorkspaceRow,
} from './subscriptions.js';
import { routineAppliesOn } from '../src-shared/routines.js';

export { reasonText, taskDay };

export const SESSION_COOKIE = 'tidemark_session';

declare module 'express-serve-static-core' {
  interface Request {
    member?: MemberRow;
  }
}

export interface AppDeps {
  readonly db: Database;
  readonly config: Config;
  readonly killbill: KillBillClient;
  readonly mailer: Mailer;
  readonly outbox: OutboxWorker;
}

export const h =
  (fn: (req: Request, res: Response) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    void fn(req, res).catch(next);
  };

export const sendJson = (res: Response, status: number, body: unknown, headers?: Record<string, string>): void => {
  for (const [k, v] of Object.entries(headers ?? {})) res.setHeader(k, v);
  res.status(status).json(body);
};

export const memberToday = (m: MemberRow): string => localDateOf(new Date(), m.time_zone);

export const errorResponder = (err: unknown, _req: Request, res: Response, next: NextFunction): void => {
  if (res.headersSent) {
    next(err);
    return;
  }
  if (err instanceof ApiError) {
    sendJson(res, err.status, errorBody(err));
    return;
  }
  if (process.env.TIDEMARK_DEBUG === '1') {
    process.stderr.write(`[debug] unhandled: ${err instanceof Error ? err.stack : String(err)}\n`);
  }
  sendJson(res, 500, { error: 'bad_request', message: 'Something went wrong on our side. Nothing was changed.' });
};

// ---------------------------------------------------------------------------
// Sessions and roles

export async function setSession(deps: AppDeps, res: Response, memberId: string): Promise<void> {
  const token = newSessionToken();
  const expiresAt = new Date(Date.now() + deps.config.timing.sessionTtlSeconds * 1000);
  await deps.db.query('INSERT INTO sessions_auth (token_hash, member_id, expires_at) VALUES ($1, $2, $3)', [hashToken(token), memberId, expiresAt]);
  res.cookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: deps.config.timing.sessionTtlSeconds * 1000 });
}

export const clearSession = (res: Response): void => {
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: 'lax', path: '/' });
};

export const requireMember = (req: Request): MemberRow => {
  if (req.member === undefined) throw new ApiError('unauthenticated', 'Sign in to continue.');
  return req.member;
};

interface WorkspaceFull extends WorkspaceRow {
  readonly writable: boolean;
}

export async function workspaceFor(deps: AppDeps, member: MemberRow): Promise<WorkspaceFull> {
  const ws = await loadWorkspace(deps.db, member.workspace_id);
  if (ws === null) throw new ApiError('not_found', "That workspace doesn't exist.");
  const writable = ws.state === 'trialing' || ws.state === 'active' || ws.state === 'past_due';
  return { ...ws, writable };
}

export async function requireWritable(deps: AppDeps, member: MemberRow): Promise<WorkspaceFull> {
  const ws = await workspaceFor(deps, member);
  if (!ws.writable) throw new ApiError('workspace_read_only', 'This workspace is read-only. Planning resumes when the subscription is active.');
  return ws;
}

export const requireRole = (member: MemberRow, role: 'owner' | 'operator'): void => {
  if (member.role !== role) throw new ApiError('forbidden', "You can't do that from this account.");
};

export const requirePlanner = (member: MemberRow): void => {
  if (member.role === 'operator') throw new ApiError('forbidden', "You can't do that from this account.");
};

// ---------------------------------------------------------------------------
// Board data

export interface BoardData {
  readonly tasks: readonly TaskRow[];
  readonly sessionsByTask: Map<string, SessionRow>;
  readonly meetings: readonly MeetingRow[];
  readonly routines: readonly RoutineRow[];
}

export async function loadBoardData(deps: AppDeps, memberId: string): Promise<BoardData> {
  const [tasks, sessions, meetings, routines] = await Promise.all([
    deps.db.query<TaskRow>('SELECT * FROM tasks WHERE member_id = $1', [memberId]),
    deps.db.query<SessionRow>('SELECT * FROM sessions WHERE member_id = $1', [memberId]),
    deps.db.query<MeetingRow>('SELECT * FROM meetings WHERE member_id = $1', [memberId]),
    deps.db.query<RoutineRow>('SELECT * FROM routines WHERE member_id = $1', [memberId]),
  ]);
  const byTask = new Map<string, SessionRow>();
  for (const s of sessions) byTask.set(s.task_id, s);
  return { tasks, sessionsByTask: byTask, meetings, routines };
}

export const fiveDatesFrom = (start: string): string[] => [0, 1, 2, 3, 4].map((i) => addDays(start, i));

export async function buildBoardDays(deps: AppDeps, member: MemberRow, start: string, data: BoardData) {
  const dates = fiveDatesFrom(start);
  return Promise.all(
    dates.map((date) =>
      buildDay(deps.db, member.id, date, member.time_zone, member.threshold_minutes, data.tasks, data.sessionsByTask, data.meetings, data.routines),
    ),
  );
}

/** The Backlog holds undated tasks plus open tasks whose day has passed. */
export function boardBacklog(data: BoardData, today: string): TaskRow[] {
  const open = data.tasks.filter((t) => t.status === 'open');
  const backlogTasks = open.filter((t) => {
    const day = taskDay(t);
    return day === null || compareDates(day, today) < 0;
  });
  return backlogTasks.sort((a, b) => {
    const ad = taskDay(a);
    const bd = taskDay(b);
    if (ad === null && bd === null) return a.position - b.position || compareDates(a.id, b.id);
    if (ad === null) return -1;
    if (bd === null) return 1;
    return compareDates(ad, bd) || a.position - b.position || compareDates(a.id, b.id);
  });
}

/** Board days for the affected dates of a write. */
export async function affectedDays(deps: AppDeps, member: MemberRow, dates: readonly string[], data: BoardData) {
  const unique = [...new Set(dates)].sort();
  return Promise.all(
    unique.map((date) =>
      buildDay(deps.db, member.id, date, member.time_zone, member.threshold_minutes, data.tasks, data.sessionsByTask, data.meetings, data.routines),
    ),
  );
}

// ---------------------------------------------------------------------------
// Task writes share versioning and renumbering in one place

interface TaskPatch {
  readonly version: number;
  readonly title?: string;
  readonly estimateMinutes?: number | null;
  readonly dayDate?: string | null;
  readonly position?: number;
  readonly status?: 'open' | 'done';
}

export const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const cleanVersion = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new ApiError('validation', 'Send the version you based this change on.', { fields: { version: 'Send the current version.' } });
  }
  return value;
};

/** Applies a day move inside a transaction: renumbering, session removal, version bump. */
export async function applyTaskMove(
  client: PoolClient,
  member: MemberRow,
  today: string,
  task: TaskRow,
  newDay: string | null,
  newPosition: number | undefined,
): Promise<{ movedFrom: string | null; movedTo: string | null }> {
  const oldDay = taskDay(task);
  const targetPosition = newPosition ?? task.position;
  // Renumber both affected columns.
  if (oldDay !== null) {
    await client.query(
      `UPDATE tasks SET position = position - 1 WHERE member_id = $1 AND day_date = $2 AND position > $3`,
      [member.id, oldDay, task.position],
    );
  } else if (newDay === null) {
    await client.query(
      `UPDATE tasks SET position = position - 1 WHERE member_id = $1 AND day_date IS NULL AND position > $2`,
      [member.id, task.position],
    );
  }
  if (newDay !== null) {
    const existing = await queryRows<{ n: number }>(client, 'SELECT COALESCE(MAX(position), -1) + 1 AS n FROM tasks WHERE member_id = $1 AND day_date = $2', [member.id, newDay]);
    const count = existing[0]?.n ?? 0;
    const insertAt = newPosition === undefined ? count : Math.max(0, Math.min(newPosition, count));
    await client.query('UPDATE tasks SET position = position + 1 WHERE member_id = $1 AND day_date = $2 AND position >= $3', [member.id, newDay, insertAt]);
    await client.query('UPDATE tasks SET day_date = $2, position = $3, version = version + 1, updated_at = now() WHERE id = $1', [task.id, newDay, insertAt]);
  } else {
    const existing = await queryRows<{ n: number }>(client, 'SELECT COALESCE(MAX(position), -1) + 1 AS n FROM tasks WHERE member_id = $1 AND day_date IS NULL', [member.id]);
    const count = existing[0]?.n ?? 0;
    const insertAt = newPosition === undefined ? count : Math.max(0, Math.min(newPosition, count));
    await client.query('UPDATE tasks SET position = position + 1 WHERE member_id = $1 AND day_date IS NULL AND position >= $3', [member.id, insertAt]);
    await client.query('UPDATE tasks SET day_date = NULL, position = $2, version = version + 1, updated_at = now() WHERE id = $1', [task.id, insertAt]);
  }
  // Moving to another day (or the Backlog) deletes the session in the same change.
  if (oldDay !== newDay) {
    await client.query('DELETE FROM sessions WHERE task_id = $1', [task.id]);
  }
  return { movedFrom: oldDay, movedTo: newDay };
}

export const resolveDayOrPast = (member: MemberRow, today: string, day: string | null): string | null => {
  if (day === null) return null;
  if (compareDates(day, today) < 0) {
    throw new ApiError('day_in_past', 'That day has already passed.');
  }
  return day;
};

// ---------------------------------------------------------------------------
// Session instants

interface SessionInstant {
  readonly startAt: Date;
  readonly endAt: Date;
}

/** Builds session instants from a local date and start time in the member's zone. */
export function sessionInstants(member: MemberRow, date: string, startTime: string, estimateMinutes: number): SessionInstant | null {
  const startAt = wallClockToInstant(date, startTime, member.time_zone);
  if (startAt === null) return null;
  const endAt = new Date(startAt.getTime() + estimateMinutes * 60_000);
  const endLocal = wallStampOf(endAt, member.time_zone);
  const startLocal = wallStampOf(startAt, member.time_zone);
  if (endLocal.slice(0, 10) !== startLocal.slice(0, 10)) return null;
  return { startAt, endAt };
}

export const wallStampOf = (d: Date, zone: string): string => wallStamp(d.getTime(), zone);

/** True when a start time is on a half-hour boundary. */
export const isHalfHour = (hhmm: string): boolean => hhmm.endsWith(':00') || hhmm.endsWith(':30');


