import { nowDate } from './clock.js';
import { db, type Queryable } from './db.js';
import { ApiError } from './errors.js';
import { activeMemberCount, type Actor } from './access.js';
import { loadHistory, workspaceToday } from './calendarstore.js';
import { countedDay, currentCalendar, type CalendarHistory } from './domain/calendar.js';
import { codePointLength, isBlank, isStorableText } from './domain/text.js';
import { addDays, isCalendarDate, instantWithOffset, isoWeekday, isValidTimeZone, localWallTime } from './domain/zone.js';
import { confirmedSeats, pendingInviteCount } from './seats.js';
import type { Holiday, Workspace } from '../shared/types.js';

export const DIGEST_HOUR = 8;

type WorkspaceRow = { id: string; name: string; slug: string };

export async function workspaceRow(workspaceId: string, client: Queryable = db): Promise<WorkspaceRow> {
  const row = await client.one<WorkspaceRow>('select id, name, slug from workspaces where id = $1', [
    workspaceId,
  ]);
  if (row === undefined) throw new ApiError('not_found');
  return row;
}

/** 08:00 workspace time on the next counted day whose digest is not queued yet. */
export async function nextDigestAt(workspaceId: string, history: CalendarHistory): Promise<string> {
  const today = workspaceToday(history);
  const recipients = await db.one<{ count: number }>(
    `select count(*)::int as count from people
      where workspace_id = $1 and removed = false and role in ('owner','member')`,
    [workspaceId],
  );
  const expected = recipients?.count ?? 0;
  const queued = await db.query<{ digest_date: string; count: number }>(
    `select digest_date, count(*)::int as count from digests
      where workspace_id = $1 and digest_date >= $2 group by digest_date`,
    [workspaceId, today],
  );
  const done = new Map(queued.map((row) => [row.digest_date, row.count]));
  let date = today;
  for (let step = 0; step < 400; step += 1) {
    if (countedDay(history, date).counted && (done.get(date) ?? 0) < Math.max(expected, 1)) {
      const zone = currentCalendar(history).timeZone;
      return instantWithOffset(zone, localWallTime(zone, date, DIGEST_HOUR));
    }
    date = addDays(date, 1);
  }
  throw new Error('No counted day ahead for a digest');
}

export async function workspaceBody(actor: Actor, workspaceId: string): Promise<Workspace> {
  const row = await workspaceRow(workspaceId);
  const history = await loadHistory(workspaceId);
  const calendar = currentCalendar(history);
  const today = workspaceToday(history);
  const seats =
    actor.role === 'owner'
      ? {
          limit: (await confirmedSeats(workspaceId)).limit,
          active: await activeMemberCount(workspaceId),
          pending: await pendingInviteCount(workspaceId),
        }
      : null;
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    time_zone: calendar.timeZone,
    working_weekdays: [...calendar.workingWeekdays].sort((left, right) => left - right),
    holidays: [...calendar.holidays].sort((left, right) => (left.date < right.date ? -1 : 1)),
    cycle_anchor: calendar.cycleAnchor,
    today,
    is_working_day: countedDay(history, today).counted,
    next_digest_at: await nextDigestAt(workspaceId, history),
    seats,
  };
}

export const calendarCopy = {
  timeZone: 'Choose a time zone from the list.',
  weekdays: 'Pick at least one working day.',
  anchorWorkingDay: 'The first cycle must start on a working day.',
  anchorLocked: "The first cycle start can't change after cycle 1 has begun.",
  duplicateHoliday: 'That date is already a holiday.',
  holidayName: 'Give the holiday a name.',
  holidayNameLength: 'Holiday names can be up to 60 characters.',
  badDate: 'Enter a date as YYYY-MM-DD.',
} as const;

export type CalendarSubmission = {
  timeZone: string;
  workingWeekdays: number[];
  holidays: Holiday[];
  cycleAnchor: string;
};

/** Judges a calendar save, reporting every failing field at once. */
export function validateCalendar(
  submission: unknown,
  storedAnchor: string,
  today: string,
): { value: CalendarSubmission; fields: Record<string, string> } {
  const fields: Record<string, string> = {};
  const body = (submission ?? {}) as Record<string, unknown>;

  const timeZone = typeof body.time_zone === 'string' ? body.time_zone : '';
  if (timeZone === '' || !isStorableText(timeZone) || !isValidTimeZone(timeZone)) {
    fields.time_zone = calendarCopy.timeZone;
  }

  const rawWeekdays = Array.isArray(body.working_weekdays) ? body.working_weekdays : [];
  const workingWeekdays = [
    ...new Set(
      rawWeekdays.filter(
        (value): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 7,
      ),
    ),
  ].sort((left, right) => left - right);
  if (workingWeekdays.length === 0 || workingWeekdays.length !== new Set(rawWeekdays).size) {
    fields.working_weekdays = calendarCopy.weekdays;
  }

  const rawHolidays = Array.isArray(body.holidays) ? body.holidays : [];
  const holidays: Holiday[] = [];
  const seen = new Set<string>();
  for (const entry of rawHolidays) {
    const holiday = (entry ?? {}) as Record<string, unknown>;
    const date = typeof holiday.date === 'string' ? holiday.date : '';
    const name = typeof holiday.name === 'string' ? holiday.name : '';
    if (!isCalendarDate(date)) {
      fields.holidays = fields.holidays ?? calendarCopy.badDate;
    } else if (seen.has(date)) {
      fields.holidays = fields.holidays ?? calendarCopy.duplicateHoliday;
    } else if (name === '' || isBlank(name)) {
      fields.holidays = fields.holidays ?? calendarCopy.holidayName;
    } else if (codePointLength(name) > 60) {
      fields.holidays = fields.holidays ?? calendarCopy.holidayNameLength;
    } else if (!isStorableText(name)) {
      fields.holidays = fields.holidays ?? calendarCopy.holidayName;
    }
    if (isCalendarDate(date)) seen.add(date);
    holidays.push({ date, name });
  }

  const cycleAnchor = typeof body.cycle_anchor === 'string' ? body.cycle_anchor : '';
  const anchorMutable = today < storedAnchor;
  if (!isCalendarDate(cycleAnchor)) {
    fields.cycle_anchor = calendarCopy.badDate;
  } else if (!anchorMutable && cycleAnchor !== storedAnchor) {
    fields.cycle_anchor = calendarCopy.anchorLocked;
  } else if (anchorMutable) {
    const isWorkingWeekday = workingWeekdays.includes(isoWeekday(cycleAnchor));
    const isHoliday = holidays.some((holiday) => holiday.date === cycleAnchor);
    if (!isWorkingWeekday || isHoliday) fields.cycle_anchor = calendarCopy.anchorWorkingDay;
  }

  return { value: { timeZone, workingWeekdays, holidays, cycleAnchor }, fields };
}

export async function saveCalendar(workspaceId: string, body: unknown): Promise<void> {
  const history = await loadHistory(workspaceId);
  const stored = currentCalendar(history);
  const today = workspaceToday(history);
  const { value, fields } = validateCalendar(body, stored.cycleAnchor, today);
  if (Object.keys(fields).length > 0) {
    throw new ApiError('validation', { fields, message: 'Calendar not saved.' });
  }
  await db.query(
    `insert into calendars (workspace_id, effective_date, time_zone, working_weekdays, holidays, cycle_anchor, created_at)
     values ($1, $2, $3, $4, $5::jsonb, $6, $7)`,
    [
      workspaceId,
      today,
      value.timeZone,
      value.workingWeekdays,
      JSON.stringify(value.holidays),
      value.cycleAnchor,
      nowDate().toISOString(),
    ],
  );
}
