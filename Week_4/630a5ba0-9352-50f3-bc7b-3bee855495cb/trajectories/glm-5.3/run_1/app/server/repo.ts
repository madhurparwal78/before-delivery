import type { PoolClient } from 'pg';
import { Database } from './db.js';
import { ApiError } from '../src-shared/errors.js';
import {
  addDays,
  compareDates,
  dayLabel,
  isoInstant,
  localDateOf,
  localTimeOf,
  wallClockToInstant,
} from '../src-shared/domain.js';
import { expandRoutine, occurrenceEndTime, routineAppliesOn } from '../src-shared/routines.js';
import type { Routine } from '../src-shared/routines.js';

export interface MemberRow {
  readonly id: string;
  readonly workspace_id: string;
  readonly name: string;
  readonly email: string;
  readonly password_hash: string;
  readonly role: 'owner' | 'member' | 'operator';
  readonly status: 'active' | 'invited' | 'pending_billing';
  readonly time_zone: string;
  readonly threshold_minutes: number;
  readonly feed_token: string;
  readonly invite_token: string | null;
  readonly invite_used: boolean;
  readonly removed_at: string | null;
}

/** A pg date column arrives as a Date; normalise to YYYY-MM-DD. */
const asDate = (value: Date | string | null): string | null => {
  if (value === null) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  return value.toISOString().slice(0, 10);
};

const dayDateOf = (t: TaskRow): string | null => asDate(t.day_date);
const dueDateOf = (t: TaskRow): string | null => asDate(t.due_date);

export const taskDay = (t: TaskRow): string | null => dayDateOf(t);

export interface TaskRow {
  readonly id: string;
  readonly member_id: string;
  readonly title: string;
  readonly estimate_minutes: number | null;
  readonly day_date: Date | string | null;
  readonly position: number;
  readonly status: 'open' | 'done';
  readonly source: string | null;
  readonly external_id: string | null;
  readonly due_date: Date | string | null;
  readonly version: number;
  readonly updated_at: string;
}

export interface SessionRow {
  readonly id: string;
  readonly task_id: string;
  readonly member_id: string;
  readonly start_at: string;
  readonly end_at: string;
  readonly version: number;
}

export interface MeetingRow {
  readonly id: string;
  readonly member_id: string;
  readonly uid: string;
  readonly summary: string;
  readonly start_at: string;
  readonly end_at: string;
}

export interface RoutineRow {
  readonly id: string;
  readonly member_id: string;
  readonly name: string;
  readonly start_time: string;
  readonly duration_minutes: number;
  readonly repeats: 'daily' | 'weekdays';
}

export interface ApiSession {
  readonly id: string;
  readonly taskId: string;
  readonly title: string;
  readonly date: string;
  readonly startTime: string;
  readonly endTime: string;
  readonly start: string;
  readonly end: string;
  readonly version: number;
}

export interface ApiTask {
  readonly id: string;
  readonly title: string;
  readonly estimateMinutes: number | null;
  readonly dayDate: string | null;
  readonly position: number;
  readonly status: 'open' | 'done';
  readonly source: string | null;
  readonly externalId: string | null;
  readonly dueDate: string | null;
  readonly version: number;
  readonly session: ApiSession | null;
}

export interface ApiDay {
  readonly date: string;
  readonly label: string;
  readonly taskMinutes: number;
  readonly meetingMinutes: number;
  readonly routineMinutes: number;
  readonly plannedMinutes: number;
  readonly overByMinutes: number;
  readonly tasks: readonly ApiTask[];
}

export interface ApiMember {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly role: 'owner' | 'member' | 'operator';
  readonly timeZone: string;
  readonly thresholdMinutes: number;
}

export interface ApiRoutine {
  readonly id: string;
  readonly name: string;
  readonly startTime: string;
  readonly durationMinutes: number;
  readonly repeats: 'daily' | 'weekdays';
}

export interface ApiWorkspace {
  readonly id: string;
  readonly name: string;
  readonly state: 'trialing' | 'active' | 'past_due' | 'read_only' | 'cancelled';
  readonly trialEndsAt: string;
  readonly writable: boolean;
}

const WRITABLE = ['trialing', 'active', 'past_due'];

export function toApiMember(m: MemberRow): ApiMember {
  return { id: m.id, name: m.name, email: m.email, role: m.role, timeZone: m.time_zone, thresholdMinutes: m.threshold_minutes };
}

export function toApiWorkspace(ws: { id: string; name: string; state: string; trial_ends_at: string }): ApiWorkspace {
  const state = ws.state as ApiWorkspace['state'];
  return { id: ws.id, name: ws.name, state, trialEndsAt: isoInstant(new Date(ws.trial_ends_at)), writable: WRITABLE.includes(state) };
}

export function toApiTask(t: TaskRow, s: SessionRow | null, timeZone: string): ApiTask {
  return {
    id: t.id,
    title: t.title,
    estimateMinutes: t.estimate_minutes,
    dayDate: taskDay(t),
    position: t.position,
    status: t.status,
    source: t.source,
    externalId: t.external_id,
    dueDate: dueDateOf(t),
    version: t.version,
    session: s === null ? null : sessionToApi(s, t.title, timeZone),
  };
}

export function sessionToApi(s: SessionRow, title: string, timeZone: string): ApiSession {
  const start = new Date(s.start_at);
  const end = new Date(s.end_at);
  const startInstant = new Date(s.start_at);
  return {
    id: s.id,
    taskId: s.task_id,
    title,
    date: localDateOf(startInstant, timeZone),
    startTime: localTimeOf(start, timeZone),
    endTime: localTimeOf(end, timeZone),
    start: isoInstant(start),
    end: isoInstant(end),
    version: s.version,
  };
}

export function routineToApi(r: RoutineRow): ApiRoutine {
  return { id: r.id, name: r.name, startTime: r.start_time, durationMinutes: r.duration_minutes, repeats: r.repeats };
}


export async function loadMemberByToken(db: Database, tokenHash: string): Promise<MemberRow | null> {
  const rows = await db.query<MemberRow>('SELECT * FROM members WHERE id = (SELECT member_id FROM sessions_auth WHERE token_hash = $1 AND expires_at > now()) AND removed_at IS NULL', [tokenHash]);
  return rows[0] ?? null;
}

export async function loadMemberByEmail(db: Database, email: string): Promise<MemberRow | null> {
  const rows = await db.query<MemberRow>('SELECT * FROM members WHERE lower(email) = lower($1) AND removed_at IS NULL', [email]);
  return rows[0] ?? null;
}

export async function loadMember(db: Database | PoolClient, memberId: string): Promise<MemberRow | null> {
  const rows = await queryRows<MemberRow>(db, 'SELECT * FROM members WHERE id = $1', [memberId]);
  return rows[0] ?? null;
}

/** Runs a query on either the pool or a transaction client and returns its rows. */
export async function queryRows<R extends import('pg').QueryResultRow>(
  db: Database | PoolClient,
  text: string,
  params: readonly unknown[] = [],
): Promise<R[]> {
  if (db instanceof Database) return db.query<R>(text, params);
  const result = await db.query<R>(text, [...params]);
  return result.rows;
}

/** Loads a member's task, refusing anything of another member with not_found. */

export async function loadOwnTask(db: Database | PoolClient, memberId: string, taskId: string): Promise<TaskRow> {
  const rows = await queryRows<TaskRow>(db, 'SELECT * FROM tasks WHERE id = $1 AND member_id = $2', [taskId, memberId]);
  const task = rows[0];
  if (task === undefined) throw new ApiError('not_found', "That task doesn't exist.");
  return task;
}

export async function loadOwnSession(db: Database | PoolClient, memberId: string, sessionId: string): Promise<SessionRow> {
  const rows = await queryRows<SessionRow>(db, 'SELECT * FROM sessions WHERE id = $1 AND member_id = $2', [sessionId, memberId]);
  const session = rows[0];
  if (session === undefined) throw new ApiError('not_found', "That session doesn't exist.");
  return session;
}

export async function loadOwnRoutine(db: Database, memberId: string, routineId: string): Promise<RoutineRow> {
  const rows = await db.query<RoutineRow>('SELECT * FROM routines WHERE id = $1 AND member_id = $2', [routineId, memberId]);
  const routine = rows[0];
  if (routine === undefined) throw new ApiError('not_found', "That routine doesn't exist.");
  return routine;
}

/** Recomputes a member's session-local date and times after a zone change. */
export interface RecomputedSession {
  readonly startAt: Date;
  readonly endAt: Date;
}

/**
 * The single rule for a day's planned minutes, computed only from stored records.
 */
export async function buildDay(
  db: Database,
  memberId: string,
  date: string,
  timeZone: string,
  threshold: number,
  tasks: readonly TaskRow[],
  sessionsByTask: Map<string, SessionRow>,
  meetings: readonly MeetingRow[],
  routines: readonly RoutineRow[],
): Promise<ApiDay> {
  const dayTasks = tasks.filter((t) => taskDay(t) === date).sort((a, b) => a.position - b.position || compareDates(a.id, b.id));
  const taskMinutes = dayTasks.reduce((sum, t) => sum + (t.estimate_minutes ?? 0), 0);

  let meetingMinutes = 0;
  for (const m of meetings) {
    meetingMinutes += overlapMinutesOnDate(new Date(m.start_at), new Date(m.end_at), date, timeZone);
  }

  let routineMinutes = 0;
  for (const r of routines) {
    if (routineAppliesOn(routineFromRow(r), date)) routineMinutes += r.duration_minutes;
  }

  const plannedMinutes = taskMinutes + meetingMinutes + routineMinutes;
  const overByMinutes = Math.max(0, plannedMinutes - threshold);
  return {
    date,
    label: dayLabel(date, timeZone),
    taskMinutes,
    meetingMinutes,
    routineMinutes,
    plannedMinutes,
    overByMinutes,
    tasks: dayTasks.map((t) => toApiTask(t, sessionsByTask.get(t.id) ?? null, timeZone)),
  };
}

export function routineFromRow(r: RoutineRow): Routine {
  return { id: r.id, name: r.name, startTime: r.start_time, durationMinutes: r.duration_minutes, repeats: r.repeats };
}

/** Minutes of a meeting that overlap a local date. */
export function overlapMinutesOnDate(start: Date, end: Date, date: string, timeZone: string): number {
  const dayStart = wallClockToInstant(date, '00:00', timeZone);
  const dayEnd = wallClockToInstant(addDays(date, 1), '00:00', timeZone);
  if (dayStart === null || dayEnd === null) return 0;
  const from = Math.max(start.getTime(), dayStart.getTime());
  const to = Math.min(end.getTime(), dayEnd.getTime());
  if (to <= from) return 0;
  return Math.round((to - from) / 60_000);
}

/** All routine occurrences of a member that intersect a date range. */
export function routineOccurrences(
  memberId: string,
  routines: readonly RoutineRow[],
  fromDate: string,
  toDate: string,
  timeZone: string,
): Array<{ id: string; routineId: string; date: string; startTime: string; endTime: string; start: string; end: string }> {
  const out: Array<{ id: string; routineId: string; date: string; startTime: string; endTime: string; start: string; end: string }> = [];
  for (const r of routines.filter((x) => x.member_id === memberId)) {
    out.push(...expandRoutine(routineFromRow(r), fromDate, toDate, timeZone));
  }
  return out;
}

export function occurrenceEnd(r: RoutineRow, date: string, timeZone: string): string {
  const start = wallClockToInstant(date, r.start_time, timeZone);
  if (start === null) return r.start_time;
  return occurrenceEndTime(start, r.duration_minutes, timeZone);
}

