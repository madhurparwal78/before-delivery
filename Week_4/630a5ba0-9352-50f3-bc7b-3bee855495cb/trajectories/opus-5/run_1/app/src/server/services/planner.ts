import type { PoolClient } from 'pg';
import { pool } from '../db/pool.js';
import type { MeetingRow, MemberRow, RoutineRow, SessionRow, TaskRow } from '../db/records.js';
import type { BoardDto, DayDto, TaskDto } from '../../shared/types.js';
import { buildDay, taskDto, type LoadInputs } from '../domain/load.js';
import type { RoutineRecord } from '../domain/routines.js';
import { addDays, compareDates, todayInZone } from '../../shared/time.js';

type Queryable = Pick<PoolClient, 'query'>;

export interface PlannerState {
  tasks: TaskRow[];
  sessions: Map<string, SessionRow>;
  meetings: MeetingRow[];
  routines: RoutineRecord[];
}

export function routineRecord(row: RoutineRow): RoutineRecord {
  return {
    id: row.id,
    name: row.name,
    startTime: row.start_time,
    durationMinutes: row.duration_minutes,
    repeats: row.repeats,
  };
}

export async function loadPlannerState(memberId: string, client: Queryable = pool): Promise<PlannerState> {
  const [tasks, sessions, meetings, routines] = await Promise.all([
    client.query<TaskRow>('select * from tasks where member_id = $1', [memberId]),
    client.query<SessionRow>('select * from task_sessions where member_id = $1', [memberId]),
    client.query<MeetingRow>('select * from meetings where member_id = $1', [memberId]),
    client.query<RoutineRow>('select * from routines where member_id = $1 order by start_time, created_at', [
      memberId,
    ]),
  ]);
  return {
    tasks: tasks.rows,
    sessions: new Map(sessions.rows.map((row) => [row.task_id, row])),
    meetings: meetings.rows,
    routines: routines.rows.map(routineRecord),
  };
}

export function loadInputs(member: MemberRow, state: PlannerState): LoadInputs {
  return {
    timeZone: member.time_zone,
    thresholdMinutes: member.threshold_minutes,
    tasks: state.tasks,
    sessions: state.sessions,
    meetings: state.meetings,
    routines: state.routines,
  };
}

export function daysFrom(member: MemberRow, state: PlannerState, dates: string[]): DayDto[] {
  const inputs = loadInputs(member, state);
  return dates.map((date) => buildDay(date, inputs));
}

/** Backlog: tasks with no day, plus open tasks whose day has already passed. */
export function backlogOf(state: PlannerState, today: string): TaskDto[] {
  return state.tasks
    .filter(
      (task) =>
        task.day_date === null || (task.status === 'open' && compareDates(task.day_date, today) < 0),
    )
    .sort(
      (left, right) =>
        left.position - right.position || left.created_at.getTime() - right.created_at.getTime(),
    )
    .map((task) => taskDto(task, state.sessions.get(task.id)));
}

export async function buildBoard(member: MemberRow, start?: string): Promise<BoardDto> {
  const today = todayInZone(member.time_zone);
  const first = start ?? today;
  const state = await loadPlannerState(member.id);
  const dates = [0, 1, 2, 3, 4].map((offset) => addDays(first, offset));
  return {
    today,
    timeZone: member.time_zone,
    thresholdMinutes: member.threshold_minutes,
    days: daysFrom(member, state, dates),
    backlog: backlogOf(state, today),
  };
}

export async function affectedDays(member: MemberRow, dates: (string | null)[]): Promise<DayDto[]> {
  const unique = [...new Set(dates.filter((date): date is string => date !== null))].sort(compareDates);
  if (unique.length === 0) return [];
  const state = await loadPlannerState(member.id);
  return daysFrom(member, state, unique);
}

export async function taskWithSession(
  taskId: string,
  client: Queryable = pool,
): Promise<TaskDto | null> {
  const task = await client.query<TaskRow>('select * from tasks where id = $1', [taskId]);
  const row = task.rows[0];
  if (!row) return null;
  const session = await client.query<SessionRow>('select * from task_sessions where task_id = $1', [taskId]);
  return taskDto(row, session.rows[0]);
}

/** Appends to the end of a column and renumbers nothing; callers that insert renumber instead. */
export async function nextPosition(
  client: Queryable,
  memberId: string,
  dayDate: string | null,
): Promise<number> {
  const result = await client.query<{ next: number }>(
    `select coalesce(max(position) + 1, 0) as next from tasks
      where member_id = $1 and day_date is not distinct from $2`,
    [memberId, dayDate],
  );
  return result.rows[0]?.next ?? 0;
}

/** Renumbers a column so positions are the 0-based reading order. */
export async function renumberColumn(
  client: Queryable,
  memberId: string,
  dayDate: string | null,
): Promise<void> {
  await client.query(
    `with ordered as (
       select id, row_number() over (order by position, updated_at, created_at) - 1 as seat
         from tasks
        where member_id = $1 and day_date is not distinct from $2
     )
     update tasks t set position = ordered.seat
       from ordered
      where t.id = ordered.id and t.position <> ordered.seat`,
    [memberId, dayDate],
  );
}
