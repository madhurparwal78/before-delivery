import { addDays, isBusinessMonth, monthDays, monthOf } from '../shared/businessTime.js';
import { refusals } from '../shared/copy.js';
import { pool } from './db.js';
import { refuse, refuseField } from './errors.js';
import { calendarScopeIds, employer, matchScopeByAddress, peopleByIds } from './people.js';
import { checkNoNul } from './bodyChecks.js';

const SEEDED_DAY_SPAN = 89;

function emptyCounts() {
  return { recorded: 0, incomplete: 0, leave_approved: 0, leave_pending: 0, waiting: 0 };
}

/** The per-day counts, read live over exactly the people given. */
export async function computeCounts(personIds, month, seededOn, client = pool) {
  const days = monthDays(month);
  const byDay = new Map(days.map((day) => [day, emptyCounts()]));
  if (personIds.length === 0) return byDay;

  const first = days[0];
  const last = days[days.length - 1];
  const seededFrom = addDays(seededOn, -SEEDED_DAY_SPAN);

  const attendance = await client.query(
    `SELECT day::text AS day, count(*) FILTER (WHERE recorded_in IS NOT NULL AND recorded_out IS NOT NULL)::int AS recorded
       FROM attendance_day WHERE person_id = ANY ($1::int[]) AND day BETWEEN $2 AND $3 GROUP BY day`,
    [personIds, first, last],
  );
  for (const row of attendance.rows) byDay.get(row.day).recorded = row.recorded;

  for (const day of days) {
    const inSeededSpan = day >= seededFrom && day <= seededOn;
    if (inSeededSpan) byDay.get(day).incomplete = personIds.length - byDay.get(day).recorded;
  }

  const leave = await client.query(
    `SELECT day::text AS day, status, count(*)::int AS people
       FROM leave_day WHERE person_id = ANY ($1::int[]) AND day BETWEEN $2 AND $3 GROUP BY day, status`,
    [personIds, first, last],
  );
  for (const row of leave.rows) {
    const counts = byDay.get(row.day);
    if (row.status === 'approved') counts.leave_approved = row.people;
    else counts.leave_pending = row.people;
  }

  const waiting = await client.query(
    `SELECT day::text AS day, count(*)::int AS people
       FROM regularisation_request WHERE person_id = ANY ($1::int[]) AND state = 'pending' AND day BETWEEN $2 AND $3
      GROUP BY day`,
    [personIds, first, last],
  );
  for (const row of waiting.rows) byDay.get(row.day).waiting = row.people;

  return byDay;
}

/** The calendar read: per-day counts and a person lookup over the caller's current scope. */
export async function readCalendar(caller, params) {
  if (caller.role !== 'manager' && caller.role !== 'admin') refuse(403, refusals.calendarRole);

  const site = await employer();
  const monthValue = params.month ?? '';
  if (monthValue !== '' && !isBusinessMonth(monthValue)) refuseField(400, refusals.monthFormat, 'month');
  checkNoNul(params.person, 'person');

  const month = monthValue === '' ? monthOf(site.seeded_on) : monthValue;
  const scopeIds = await calendarScopeIds(caller);
  const scope = await peopleByIds(scopeIds);

  let countedIds = scopeIds;
  if (params.person) {
    const matched = matchScopeByAddress(scope, params.person);
    countedIds = matched === null ? [] : [matched];
  }

  const byDay = await computeCounts(countedIds, month, site.seeded_on);
  return {
    month,
    days: [...byDay.entries()].map(([day, counts]) => ({ day, counts })),
    people: scope.map((person) => ({ name: person.name, work_address: person.work_address })),
  };
}
