import type { Day, Session, Task, TaskStatus } from "../shared/types.js";
import { addDays, dayBounds, dayLabel, isoInstant, overlapMinutes, wallOf } from "../shared/time.js";
import type { Db } from "./db.js";
import { expandRoutines, routinesOf } from "./routines.js";

export type TaskRow = {
  id: string;
  title: string;
  estimate_minutes: number | null;
  day_date: string | null;
  position: number;
  status: TaskStatus;
  source: string | null;
  external_id: string | null;
  due_date: string | null;
  version: number;
  session: { id: string; starts_at: string; ends_at: string; version: number } | null;
};

export type SessionRow = { id: string; task_id: string; title: string; starts_at: Date; ends_at: Date; version: number };

export function sessionJson(row: SessionRow, zone: string): Session {
  const start = wallOf(row.starts_at.getTime(), zone);
  return {
    id: row.id,
    taskId: row.task_id,
    title: row.title,
    date: start.date,
    startTime: start.time,
    endTime: wallOf(row.ends_at.getTime(), zone).time,
    start: isoInstant(row.starts_at.getTime()),
    end: isoInstant(row.ends_at.getTime()),
    version: row.version,
  };
}

export function taskJson(row: TaskRow, zone: string): Task {
  return {
    id: row.id,
    title: row.title,
    estimateMinutes: row.estimate_minutes,
    dayDate: row.day_date,
    position: row.position,
    status: row.status,
    source: row.source,
    externalId: row.external_id,
    dueDate: row.due_date,
    version: row.version,
    session: row.session
      ? sessionJson(
          {
            id: row.session.id,
            task_id: row.id,
            title: row.title,
            starts_at: new Date(row.session.starts_at),
            ends_at: new Date(row.session.ends_at),
            version: row.session.version,
          },
          zone,
        )
      : null,
  };
}

const TASK_COLUMNS = (db: Db) => db`
  t.id, t.title, t.estimate_minutes, to_char(t.day_date, 'YYYY-MM-DD') AS day_date, t.position, t.status,
  t.source, t.external_id, to_char(t.due_date, 'YYYY-MM-DD') AS due_date, t.version,
  CASE WHEN s.id IS NULL THEN NULL
       ELSE json_build_object('id', s.id, 'starts_at', s.starts_at, 'ends_at', s.ends_at, 'version', s.version) END AS session`;

export function taskRows(db: Db, memberId: string, taskId: string): Promise<TaskRow[]> {
  return db<TaskRow[]>`
    SELECT ${TASK_COLUMNS(db)} FROM tasks t LEFT JOIN sessions s ON s.task_id = t.id
    WHERE t.id = ${taskId} AND t.member_id = ${memberId}`;
}

function tasksOn(db: Db, memberId: string, dates: string[]): Promise<TaskRow[]> {
  return db<TaskRow[]>`
    SELECT ${TASK_COLUMNS(db)} FROM tasks t LEFT JOIN sessions s ON s.task_id = t.id
    WHERE t.member_id = ${memberId} AND t.day_date = ANY(${dates}::date[])
    ORDER BY t.day_date, t.position, t.created_at`;
}

/** Backlog: undated tasks, plus open tasks whose day has passed (they count toward no shown day). */
export function backlogOf(db: Db, memberId: string, today: string): Promise<TaskRow[]> {
  return db<TaskRow[]>`
    SELECT ${TASK_COLUMNS(db)} FROM tasks t LEFT JOIN sessions s ON s.task_id = t.id
    WHERE t.member_id = ${memberId}
      AND (t.day_date IS NULL OR (t.day_date < ${today}::date AND t.status = 'open'))
    ORDER BY t.day_date NULLS LAST, t.position, t.created_at`;
}

/**
 * A day's load, computed from stored records only: task estimates dated that day, imported meeting
 * minutes overlapping the local day, and routine occurrence durations. This is the one place
 * planned minutes are decided.
 */
export async function buildDays(db: Db, memberId: string, zone: string, threshold: number, dates: string[]): Promise<Day[]> {
  if (dates.length === 0) return [];
  const sorted = [...dates].sort();
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const [tasks, routines, meetings] = await Promise.all([
    tasksOn(db, memberId, sorted),
    routinesOf(db, memberId),
    db<{ starts_at: Date; ends_at: Date }[]>`
      SELECT starts_at, ends_at FROM meetings
      WHERE member_id = ${memberId}
        AND starts_at < ${new Date(dayBounds(last, zone).end)} AND ends_at > ${new Date(dayBounds(first, zone).start)}`,
  ]);
  const occurrences = expandRoutines(routines, first, last, zone);
  return dates.map((date) => {
    const dayTasks = tasks.filter((t) => t.day_date === date);
    const taskMinutes = dayTasks.reduce((sum, t) => sum + (t.estimate_minutes ?? 0), 0);
    const meetingMinutes = meetings.reduce((sum, m) => sum + overlapMinutes(m.starts_at.getTime(), m.ends_at.getTime(), date, zone), 0);
    const routineMinutes = occurrences.filter((o) => o.date === date).reduce((sum, o) => sum + (o.end - o.start) / 60_000, 0);
    const plannedMinutes = taskMinutes + meetingMinutes + routineMinutes;
    return {
      date,
      label: dayLabel(date),
      taskMinutes,
      meetingMinutes,
      routineMinutes,
      plannedMinutes,
      overByMinutes: Math.max(0, plannedMinutes - threshold),
      tasks: dayTasks.map((t) => taskJson(t, zone)),
    };
  });
}

export function boardDates(start: string): string[] {
  return [0, 1, 2, 3, 4].map((n) => addDays(start, n));
}

/** Dates whose load a change touched, for the `days` array of a write response. */
export function touched(...dates: (string | null | undefined)[]): string[] {
  return [...new Set(dates.filter((d): d is string => typeof d === "string"))];
}
