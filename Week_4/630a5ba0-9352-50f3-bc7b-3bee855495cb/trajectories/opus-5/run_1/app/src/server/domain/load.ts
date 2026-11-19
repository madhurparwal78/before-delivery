import type { DayDto, TaskDto } from '../../shared/types.js';
import type { MeetingRow, SessionRow, TaskRow } from '../db/records.js';
import type { RoutineRecord } from './routines.js';
import { occurrenceOn } from './routines.js';
import {
  dayLabel,
  endOfLocalDay,
  instantToIso,
  startOfLocalDay,
} from '../../shared/time.js';

export interface LoadInputs {
  timeZone: string;
  thresholdMinutes: number;
  tasks: TaskRow[];
  sessions: Map<string, SessionRow>;
  meetings: MeetingRow[];
  routines: RoutineRecord[];
}

export function taskDto(task: TaskRow, session: SessionRow | undefined): TaskDto {
  return {
    id: task.id,
    title: task.title,
    estimateMinutes: task.estimate_minutes,
    dayDate: task.day_date,
    position: task.position,
    status: task.status,
    source: task.source,
    externalId: task.external_id,
    dueDate: task.due_date,
    version: task.version,
    session: session
      ? {
          id: session.id,
          taskId: session.task_id,
          title: task.title,
          date: session.local_date,
          startTime: session.start_time,
          endTime: session.end_time,
          start: instantToIso(session.start_instant),
          end: instantToIso(session.end_instant),
          version: session.version,
        }
      : null,
  };
}

/** Minutes of a meeting that overlap one local day. */
export function meetingMinutesOnDay(
  meeting: MeetingRow,
  date: string,
  timeZone: string,
): number {
  const dayStart = startOfLocalDay(date, timeZone).getTime();
  const dayEnd = endOfLocalDay(date, timeZone).getTime();
  const overlapStart = Math.max(meeting.start_instant.getTime(), dayStart);
  const overlapEnd = Math.min(meeting.end_instant.getTime(), dayEnd);
  if (overlapEnd <= overlapStart) return 0;
  return Math.round((overlapEnd - overlapStart) / 60_000);
}

/**
 * A day's load, computed from stored records only. Task estimates count on their dayDate,
 * meetings count the minutes overlapping the local day, routines count their occurrence
 * durations, and a timed session adds nothing of its own.
 */
export function buildDay(date: string, inputs: LoadInputs): DayDto {
  const dayTasks = inputs.tasks
    .filter((task) => task.day_date === date)
    .sort((left, right) => left.position - right.position || left.created_at.getTime() - right.created_at.getTime());

  const taskMinutes = dayTasks.reduce((sum, task) => sum + (task.estimate_minutes ?? 0), 0);
  const meetingMinutes = inputs.meetings.reduce(
    (sum, meeting) => sum + meetingMinutesOnDay(meeting, date, inputs.timeZone),
    0,
  );
  const routineMinutes = inputs.routines.reduce((sum, routine) => {
    const occurrence = occurrenceOn(routine, date, inputs.timeZone);
    return sum + (occurrence ? occurrence.durationMinutes : 0);
  }, 0);

  const plannedMinutes = taskMinutes + meetingMinutes + routineMinutes;
  return {
    date,
    label: dayLabel(date),
    taskMinutes,
    meetingMinutes,
    routineMinutes,
    plannedMinutes,
    overByMinutes: Math.max(0, plannedMinutes - inputs.thresholdMinutes),
    tasks: dayTasks.map((task) => taskDto(task, inputs.sessions.get(task.id))),
  };
}
