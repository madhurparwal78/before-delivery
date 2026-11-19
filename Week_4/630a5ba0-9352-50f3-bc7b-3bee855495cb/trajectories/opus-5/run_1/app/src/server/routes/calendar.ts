import { pool, withTransaction } from '../db/pool.js';
import type { MeetingRow, MemberRow, RoutineRow, SessionRow } from '../db/records.js';
import type { CalendarItemDto, RoutineDto } from '../../shared/types.js';
import { Response, created, noContent, textResponse } from '../http/server.js';
import { jsonBody, requirePlanner, requireWritable, type RequestContext } from '../http/context.js';
import { notFound, unprocessable } from '../http/errors.js';
import { FieldErrors, checkDuration, checkName, checkTime } from '../http/validate.js';
import { newId, randomToken } from '../services/auth.js';
import { loadPlannerState, routineRecord } from '../services/planner.js';
import { expandRoutines } from '../domain/routines.js';
import {
  addDays,
  compareDates,
  icsStamp,
  instantToIso,
  isDateString,
  localDateOf,
  localTimeOf,
  todayInZone,
} from '../../shared/time.js';
import type { Router } from '../http/router.js';
import type { RoutineRepeats } from '../../shared/types.js';

function routineDto(row: RoutineRow): RoutineDto {
  return {
    id: row.id,
    name: row.name,
    startTime: row.start_time,
    durationMinutes: row.duration_minutes,
    repeats: row.repeats,
  };
}

function meetingItem(meeting: MeetingRow, timeZone: string): CalendarItemDto {
  return {
    kind: 'meeting',
    id: meeting.id,
    title: meeting.summary,
    date: localDateOf(meeting.start_instant, timeZone),
    startTime: localTimeOf(meeting.start_instant, timeZone),
    endTime: localTimeOf(meeting.end_instant, timeZone),
    start: instantToIso(meeting.start_instant),
    end: instantToIso(meeting.end_instant),
  };
}

async function calendar(context: RequestContext): Promise<unknown> {
  const { member } = requirePlanner(context);
  const from = context.query.get('from') ?? todayInZone(member.time_zone);
  const to = context.query.get('to') ?? addDays(from, 4);
  if (!isDateString(from) || !isDateString(to) || compareDates(from, to) > 0) {
    throw unprocessable('validation_failed', 'Use an inclusive date range.');
  }
  let span = 1;
  for (let date = from; compareDates(date, to) < 0; date = addDays(date, 1)) span += 1;
  if (span > 31) throw unprocessable('validation_failed', 'Ask for at most 31 days.');

  const state = await loadPlannerState(member.id);
  const sessionTitles = new Map(state.tasks.map((task) => [task.id, task.title]));
  const items: CalendarItemDto[] = [];

  for (const session of state.sessions.values()) {
    if (compareDates(session.local_date, from) < 0 || compareDates(session.local_date, to) > 0) continue;
    items.push({
      kind: 'session',
      id: session.id,
      title: sessionTitles.get(session.task_id) ?? 'Session',
      date: session.local_date,
      startTime: session.start_time,
      endTime: session.end_time,
      start: instantToIso(session.start_instant),
      end: instantToIso(session.end_instant),
      version: session.version,
    });
  }

  for (const occurrence of expandRoutines(state.routines, member.time_zone, from, to)) {
    items.push({
      kind: 'routine',
      id: occurrence.id,
      title: occurrence.name,
      date: occurrence.date,
      startTime: occurrence.startTime,
      endTime: occurrence.endTime,
      start: instantToIso(occurrence.start),
      end: instantToIso(occurrence.end),
    });
  }

  for (const meeting of state.meetings) {
    const item = meetingItem(meeting, member.time_zone);
    if (compareDates(item.date, from) < 0 || compareDates(item.date, to) > 0) continue;
    items.push(item);
  }

  items.sort((left, right) => left.start.localeCompare(right.start) || left.id.localeCompare(right.id));
  return { timeZone: member.time_zone, items };
}

async function listRoutines(context: RequestContext): Promise<unknown> {
  const { member } = requirePlanner(context);
  const result = await pool.query<RoutineRow>(
    'select * from routines where member_id = $1 order by start_time, created_at',
    [member.id],
  );
  return { routines: result.rows.map(routineDto) };
}

async function addRoutine(context: RequestContext): Promise<Response> {
  const { member } = requirePlanner(context);
  requireWritable(context);
  const body = jsonBody(context);
  const errors = new FieldErrors();
  const name = checkName(errors, 'name', body.name);
  const startTime = checkTime(errors, 'startTime', body.startTime);
  const durationMinutes = checkDuration(errors, 'durationMinutes', body.durationMinutes);
  const repeats: RoutineRepeats = body.repeats === 'weekdays' ? 'weekdays' : 'daily';
  if (body.repeats !== 'weekdays' && body.repeats !== 'daily') {
    errors.add('repeats', 'Use daily or weekdays.');
  }
  errors.throwIfAny();

  const inserted = await pool.query<RoutineRow>(
    `insert into routines (id, member_id, name, start_time, duration_minutes, repeats, created_at)
     values ($1, $2, $3, $4, $5, $6, now()) returning *`,
    [newId(), member.id, name, startTime, durationMinutes, repeats],
  );
  return created({ routine: routineDto(inserted.rows[0]!) });
}

async function deleteRoutine(context: RequestContext): Promise<Response> {
  const { member } = requirePlanner(context);
  requireWritable(context);
  const id = context.params.id ?? '';
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound();
  const result = await pool.query('delete from routines where id = $1 and member_id = $2', [id, member.id]);
  if (result.rowCount === 0) throw notFound();
  return noContent();
}

function feedUrl(origin: string, token: string): string {
  return `${origin}/feed/${token}.ics`;
}

async function getFeed(context: RequestContext): Promise<unknown> {
  const { member } = requirePlanner(context);
  return { url: feedUrl(context.origin, member.feed_token ?? '') };
}

async function rotateFeed(context: RequestContext): Promise<unknown> {
  const { member } = requirePlanner(context);
  const token = randomToken();
  await withTransaction(async (tx) => {
    await tx.query('update members set feed_token = $2, updated_at = now() where id = $1', [member.id, token]);
  });
  return { url: feedUrl(context.origin, token) };
}

function escapeIcs(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

function foldLine(line: string): string {
  if (line.length <= 73) return line;
  const parts: string[] = [line.slice(0, 73)];
  let rest = line.slice(73);
  while (rest.length > 72) {
    parts.push(` ${rest.slice(0, 72)}`);
    rest = rest.slice(72);
  }
  if (rest.length > 0) parts.push(` ${rest}`);
  return parts.join('\r\n');
}

/** The member's timed sessions and routine occurrences, one VEVENT each. Meetings are not included. */
async function serveFeed(context: RequestContext): Promise<Response> {
  const file = context.params.file ?? '';
  if (!file.endsWith('.ics')) throw notFound();
  const token = file.slice(0, -4);
  const found = await pool.query<MemberRow>(
    `select * from members where feed_token = $1 and status <> 'removed'`,
    [token],
  );
  const member = found.rows[0];
  if (!member || member.role === 'operator') {
    return textResponse(404, 'Not found\n', 'text/plain; charset=utf-8', { 'Cache-Control': 'no-store' });
  }

  const today = todayInZone(member.time_zone);
  const sessions = await pool.query<SessionRow & { title: string }>(
    `select s.*, t.title from task_sessions s join tasks t on t.id = s.task_id where s.member_id = $1`,
    [member.id],
  );
  const routines = await pool.query<RoutineRow>('select * from routines where member_id = $1', [member.id]);
  const occurrences = expandRoutines(
    routines.rows.map(routineRecord),
    member.time_zone,
    addDays(today, -7),
    addDays(today, 28),
  );

  const stamp = icsStamp(new Date());
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Tidemark Daybook//Planner//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeIcs(`${member.name} · Tidemark Daybook`)}`,
  ];
  for (const session of sessions.rows) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:session-${session.id}@tidemark`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${icsStamp(session.start_instant)}`,
      `DTEND:${icsStamp(session.end_instant)}`,
      foldLine(`SUMMARY:${escapeIcs(session.title)}`),
      'END:VEVENT',
    );
  }
  for (const occurrence of occurrences) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:routine-${occurrence.routineId}-${occurrence.date.replace(/-/g, '')}@tidemark`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${icsStamp(occurrence.start)}`,
      `DTEND:${icsStamp(occurrence.end)}`,
      foldLine(`SUMMARY:${escapeIcs(occurrence.name)}`),
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');

  return textResponse(200, `${lines.join('\r\n')}\r\n`, 'text/calendar; charset=utf-8', {
    'Cache-Control': 'no-store',
  });
}

export function registerCalendarRoutes(router: Router): void {
  router.get('/api/calendar', calendar);
  router.get('/api/routines', listRoutines);
  router.post('/api/routines', addRoutine);
  router.delete('/api/routines/:id', deleteRoutine);
  router.get('/api/feed', getFeed);
  router.post('/api/feed/rotate', rotateFeed);
  router.get('/feed/:file', serveFeed);
}
