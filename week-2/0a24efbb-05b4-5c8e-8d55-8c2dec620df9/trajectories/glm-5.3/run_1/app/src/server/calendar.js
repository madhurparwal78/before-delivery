import { query } from '../db/pg.js';
import { daysOfMonth, dayToUtcDate } from '../domain/time.js';
import { foldAddress } from '../domain/text.js';

/** Calendar scope: manager = current direct reports (inactive included); admin = all sixteen. */
export async function calendarScope(viewer) {
  if (viewer.role === 'admin') {
    const rows = await query(
      'SELECT id, name, work_address FROM person ORDER BY name'
    );
    return rows;
  }
  const rows = await query(
    'SELECT id, name, work_address FROM person WHERE manager_id = $1 ORDER BY name',
    [viewer.id]
  );
  return rows;
}

/**
 * Per-day counts for one month over the in-scope people, narrowed to one person
 * when the person is in scope. Live from the store on every call.
 */
export async function calendarCounts(month, scopePeople, personParam) {
  const people = scopePeople;
  let personFilter = null;
  if (personParam) {
    const folded = foldAddress(personParam);
    const match = people.find((p) => foldAddress(p.work_address) === folded);
    personFilter = match ? match.id : 'outside';
  }
  const ids = personFilter && personFilter !== 'outside'
    ? [personFilter]
    : people.map((p) => p.id);
  const days = daysOfMonth(month);

  if (personFilter === 'outside' || ids.length === 0) {
    return days.map((day) => ({ day, counts: zeroCounts() }));
  }

  const first = days[0];
  const last = days[days.length - 1];

  const attendance = await query(
    `SELECT day, recorded_in, recorded_out FROM attendance_day
     WHERE person_id = ANY($1) AND day >= $2 AND day <= $3`,
    [ids, first, last]
  );
  const leave = await query(
    `SELECT day, status FROM leave_day WHERE person_id = ANY($1) AND day >= $2 AND day <= $3`,
    [ids, first, last]
  );
  const waiting = await query(
    `SELECT day FROM regularisation_request
     WHERE person_id = ANY($1) AND state = 'pending' AND day >= $2 AND day <= $3`,
    [ids, first, last]
  );

  const seededRows = await query('SELECT seeded_on FROM employer WHERE id = 1');
  const seededOn = seededRows[0].seeded_on.toISOString().slice(0, 10);

  const dayMap = new Map();
  for (const row of attendance) {
    const key = row.day.toISOString().slice(0, 10);
    if (!dayMap.has(key)) dayMap.set(key, []);
    dayMap.get(key).push(row);
  }
  const leaveMap = new Map();
  for (const row of leave) {
    const key = row.day.toISOString().slice(0, 10);
    if (!leaveMap.has(key)) leaveMap.set(key, []);
    leaveMap.get(key).push(row);
  }
  const waitingMap = new Map();
  for (const row of waiting) {
    const key = row.day.toISOString().slice(0, 10);
    waitingMap.set(key, (waitingMap.get(key) || 0) + 1);
  }

  return days.map((day) => {
    const counts = zeroCounts();
    const attRows = dayMap.get(day) || [];
    const rowsWithBoth = attRows.filter((r) => r.recorded_in && r.recorded_out).length;
    counts.recorded = rowsWithBoth;
    const rowsPartial = attRows.filter((r) => (r.recorded_in || r.recorded_out) && !(r.recorded_in && r.recorded_out)).length;
    const offset = dayDiff(day, seededOn);
    const seededDay = offset >= 0 && offset <= 89;
    if (seededDay) {
      // a missing punch, or no row at all, on a seeded day counts incomplete
      counts.incomplete = rowsPartial + Math.max(0, ids.length - attRows.length);
    }
    for (const row of leaveMap.get(day) || []) {
      if (row.status === 'approved') counts.leave_approved++;
      else counts.leave_pending++;
    }
    counts.waiting = waitingMap.get(day) || 0;
    return { day, counts };
  });
}

function dayDiff(a, b) {
  return Math.round((dayToUtcDate(a) - dayToUtcDate(b)) / 86400000);
}

function zeroCounts() {
  return { recorded: 0, incomplete: 0, leave_approved: 0, leave_pending: 0, waiting: 0 };
}
