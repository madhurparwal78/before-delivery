import { now, nowDate } from './clock.js';
import { db, type Queryable } from './db.js';
import { visibleProjectIds, type Actor } from './access.js';
import { midnightOn, todayOf, type CalendarHistory } from './domain/calendar.js';
import { cycleSpan, WORKING_DAYS_PER_CYCLE } from './domain/cycles.js';
import { attributedCycle, listIssueRows } from './issueview.js';
import { instantWithOffset } from './domain/zone.js';
import { currentCalendar } from './domain/calendar.js';
import type { BurndownEntry, Cycle, CycleDay } from '../shared/types.js';

type RecordIssue = {
  key: string;
  project_id: string;
  project_key: string;
  number: number;
  closed_at: string | null;
};

type CycleRecord = {
  number: number;
  starts_at: number;
  ends_at: number;
  first_working_date: string;
  last_working_date: string;
  days: CycleDay[];
  issues: RecordIssue[];
};

/**
 * A finished cycle's record holds each issue's state at the cycle's end, so its
 * dates, burndown and membership never move again.
 */
export async function finishedRecord(
  workspaceId: string,
  number: number,
  history: CalendarHistory,
): Promise<CycleRecord> {
  const existing = await db.one<{ record: CycleRecord }>(
    'select record from cycle_records where workspace_id = $1 and number = $2',
    [workspaceId, number],
  );
  if (existing !== undefined) return existing.record;

  const span = cycleSpan(history, number);
  const at = span.endsAt - 1;
  const rows = await db.query<{
    key: string;
    project_id: string;
    project_key: string;
    number: number;
    cycle_number: number | null;
    closed_at: string | null;
  }>(
    `select i.key, i.project_id, p.key as project_key, i.number, i.cycle_number, i.closed_at
       from issues i join projects p on p.id = i.project_id
      where i.workspace_id = $1 and i.cycle_number is not null`,
    [workspaceId],
  );
  const issues: RecordIssue[] = rows
    .filter((row) => attributedCycle(row, history, at) === number)
    .map((row) => ({
      key: row.key,
      project_id: row.project_id,
      project_key: row.project_key,
      number: row.number,
      closed_at: row.closed_at !== null && Date.parse(row.closed_at) <= at ? row.closed_at : null,
    }))
    .sort((left, right) =>
      left.project_key === right.project_key
        ? left.number - right.number
        : left.project_key < right.project_key
          ? -1
          : 1,
    );
  const record: CycleRecord = {
    number,
    starts_at: span.startsAt,
    ends_at: span.endsAt,
    first_working_date: span.firstWorkingDate,
    last_working_date: span.lastWorkingDate,
    days: span.days,
    issues,
  };
  await db.query(
    'insert into cycle_records (workspace_id, number, record, created_at) values ($1, $2, $3::jsonb, $4) on conflict do nothing',
    [workspaceId, number, JSON.stringify(record), nowDate().toISOString()],
  );
  const stored = await db.one<{ record: CycleRecord }>(
    'select record from cycle_records where workspace_id = $1 and number = $2',
    [workspaceId, number],
  );
  return stored?.record ?? record;
}

function endOfDay(history: CalendarHistory, date: string): number {
  const next = new Date(Date.parse(`${date}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
  return midnightOn(history, next) - 1;
}

function burndownOf(
  history: CalendarHistory,
  days: CycleDay[],
  issues: { closed_at: string | null }[],
  untilDate: string | null,
): BurndownEntry[] {
  const out: BurndownEntry[] = [];
  for (const day of days) {
    if (!day.counted) continue;
    if (untilDate !== null && day.date > untilDate) continue;
    const edge = endOfDay(history, day.date);
    const open = issues.filter(
      (issue) => issue.closed_at === null || Date.parse(issue.closed_at) > edge,
    ).length;
    out.push({ date: day.date, open });
  }
  return out;
}

/** The viewer's own cycle: its dates fixed, its issues and burndown their own. */
export async function cycleBodyFor(
  actor: Actor,
  number: number,
  history: CalendarHistory,
  client: Queryable = db,
): Promise<Cycle> {
  const at = now();
  const today = todayOf(history, at);
  const zone = currentCalendar(history).timeZone;
  const span = cycleSpan(history, number);
  const isFinished = span.endsAt <= at;
  const isCurrent = span.startsAt <= at && at < span.endsAt;
  const projectIds = await visibleProjectIds(actor, client);

  if (isFinished) {
    const record = await finishedRecord(history.workspaceId, number, history);
    const mine = record.issues.filter((issue) => projectIds.includes(issue.project_id));
    return {
      number,
      starts_at: instantWithOffset(zone, record.starts_at),
      ends_at: instantWithOffset(zone, record.ends_at),
      first_working_date: record.first_working_date,
      last_working_date: record.last_working_date,
      calendar_days: record.days.length,
      working_day_count: WORKING_DAYS_PER_CYCLE,
      days: record.days,
      burndown: burndownOf(history, record.days, mine, null),
      issue_keys: mine.map((issue) => issue.key),
      is_current: false,
      is_finished: true,
    };
  }

  const rows = await listIssueRows(actor, history, { cycle: number }, async () => null, client);
  return {
    number,
    starts_at: instantWithOffset(zone, span.startsAt),
    ends_at: instantWithOffset(zone, span.endsAt),
    first_working_date: span.firstWorkingDate,
    last_working_date: span.lastWorkingDate,
    calendar_days: span.days.length,
    working_day_count: WORKING_DAYS_PER_CYCLE,
    days: span.days,
    burndown: burndownOf(history, span.days, rows, today),
    issue_keys: rows.map((row) => row.key),
    is_current: isCurrent,
    is_finished: false,
  };
}

/** The member issue keys of a finished cycle, or null while it is still running. */
export async function finishedCycleKeys(
  workspaceId: string,
  number: number,
  history: CalendarHistory,
): Promise<string[] | null> {
  const span = cycleSpan(history, number);
  if (span.endsAt > now()) return null;
  const record = await finishedRecord(workspaceId, number, history);
  return record.issues.map((issue) => issue.key);
}
