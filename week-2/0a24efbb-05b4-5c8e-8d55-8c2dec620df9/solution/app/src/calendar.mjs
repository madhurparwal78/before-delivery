import { rows } from "./db.mjs";
import { fieldRefusal, hasNul, nulRefusal, refuse } from "./http.mjs";
import { seededOn } from "./policy.mjs";
import { calendarScope, readsCalendar } from "./scope.mjs";
import { fold } from "./text.mjs";
import { addDays, daysBetween, daysOfMonth, isRealMonth, monthOf } from "./time.mjs";

const SEEDED_DAYS = 90;

/** Per-day counts of one month over the given people, read live from the store. */
export async function monthCounts(personIds, month) {
  const seeded = await seededOn();
  const days = daysOfMonth(month);
  const range = [personIds, days[0], days.at(-1)];
  const [recorded, leave, waiting] = await Promise.all([
    rows(`SELECT day, count(*)::int AS n FROM attendance_day
           WHERE person_id = ANY($1) AND day BETWEEN $2 AND $3 AND recorded_in IS NOT NULL AND recorded_out IS NOT NULL
           GROUP BY day`, range),
    rows(`SELECT day, (count(*) FILTER (WHERE status = 'approved'))::int AS approved,
                 (count(*) FILTER (WHERE status = 'pending'))::int AS pending
            FROM leave_day WHERE person_id = ANY($1) AND day BETWEEN $2 AND $3 GROUP BY day`, range),
    rows(`SELECT day, count(*)::int AS n FROM regularisation_request
           WHERE person_id = ANY($1) AND day BETWEEN $2 AND $3 AND state = 'pending' GROUP BY day`, range),
  ]);
  const byDay = (found) => Object.fromEntries(found.map((row) => [row.day, row]));
  const [complete, leaves, open] = [byDay(recorded), byDay(leave), byDay(waiting)];
  const firstSeeded = addDays(seeded, -(SEEDED_DAYS - 1));
  return days.map((day) => {
    const done = complete[day]?.n ?? 0;
    const seededDay = daysBetween(firstSeeded, day) >= 0 && daysBetween(day, seeded) >= 0;
    return {
      day,
      counts: {
        recorded: done,
        incomplete: seededDay ? personIds.length - done : 0,
        leave_approved: leaves[day]?.approved ?? 0,
        leave_pending: leaves[day]?.pending ?? 0,
        waiting: open[day]?.n ?? 0,
      },
    };
  });
}

/**
 * The month over the caller's current scope, with the scope's people (ids included, for the page's own use) and the
 * one person it is narrowed to, if that person is in scope.
 */
export async function teamMonth(caller, search) {
  if (!readsCalendar(caller)) throw refuse(403, "Only managers and people operations read the calendar.");
  const params = new URLSearchParams(search);
  const asked = params.get("month") || undefined;
  const person = params.get("person") || undefined;
  if (asked !== undefined && !isRealMonth(asked)) throw fieldRefusal(400, "month", "month must read YYYY-MM.");
  if (hasNul(person)) throw nulRefusal("person");

  const month = asked ?? monthOf(await seededOn());
  const people = await rows(
    `SELECT p.id, p.name, p.work_address FROM person p WHERE ${calendarScope(caller, "p", 1)}
      ORDER BY p.name COLLATE "C", p.id`, [caller.id]);
  const narrowed = person === undefined ? undefined : people.find((p) => fold(p.work_address) === fold(person));
  const counted = person === undefined ? people : [narrowed].filter(Boolean);
  return { month, days: await monthCounts(counted.map((p) => p.id), month), people, narrowed };
}

/** `GET /api/calendar`: per-day counts computed live over the caller's current scope. */
export async function calendar(caller, search) {
  const { month, days, people } = await teamMonth(caller, search);
  return { month, days, people: people.map(({ name, work_address }) => ({ name, work_address })) };
}
