import { addDays, isoWeekOf, mondayOfWeek } from '../shared/dates.js';
import type { AthleteRow, Item, SeriesDay, WeekSummary } from '../shared/types.js';
import { type User } from './access.js';
import { pool } from './db.js';
import { itemsOfDay, tallyOf, type Stored } from './domain/calendar.js';
import { ensureSeriesCurrent } from './series.js';
import { loadDay, loadRange } from './workouts.js';

/** The form (TSB) a week shows: the series' TSB on the earlier of the following Monday and today. */
function formOn(date: string, athlete: User, series: Map<string, SeriesDay>): number {
  return series.get(date)?.tsb ?? athlete.start_ctl - athlete.start_atl;
}

export async function weekSummaries(athlete: User, today: string, weekIds: readonly string[]): Promise<WeekSummary[]> {
  await ensureSeriesCurrent(athlete, today);
  const mondays = weekIds.map(mondayOfWeek);
  const first = mondays[0];
  const last = mondays[mondays.length - 1];
  if (first === undefined || last === undefined) return [];
  const stored = await loadRange(athlete.id, first, addDays(last, 6), pool);
  const byDate = new Map<string, Stored[]>();
  for (const row of stored) byDate.set(row.workout.date, [...(byDate.get(row.workout.date) ?? []), row]);
  const formDates = mondays.map((monday) => (addDays(monday, 7) < today ? addDays(monday, 7) : today));
  const { rows } = await pool.query<SeriesDay>('SELECT date, tss, ctl, atl, tsb FROM series_days WHERE athlete_id = $1 AND date = ANY($2::date[])', [athlete.id, formDates]);
  const series = new Map(rows.map((row) => [row.date, row]));

  return mondays.map((monday, index): WeekSummary => {
    const days = Array.from({ length: 7 }, (_, offset) => {
      const date = addDays(monday, offset);
      return { date, items: itemsOfDay(byDate.get(date) ?? [], date, today) };
    });
    const items = days.flatMap((day) => day.items);
    const completed = items.flatMap((item) => (item.completed ? [item.completed] : []));
    const sum = (values: (number | null)[]): number => values.reduce<number>((total, value) => total + (value ?? 0), 0);
    const ofSport = (sport: string) => completed.filter((workout) => workout.sport === sport);
    return {
      week: isoWeekOf(monday),
      monday,
      planned_tss: sum(items.map((item) => item.planned?.planned_tss ?? null)),
      completed_tss: sum(completed.map((workout) => workout.tss)),
      tsb: formOn(formDates[index] as string, athlete, series),
      tally: tallyOf(items),
      sports: {
        bike_tss: sum(ofSport('bike').map((workout) => workout.tss)),
        run_tss: sum(ofSport('run').map((workout) => workout.tss)),
        bike_s: sum(ofSport('bike').map((workout) => workout.duration_s)),
        run_s: sum(ofSport('run').map((workout) => workout.duration_s)),
        sessions: completed.length
      },
      days
    };
  });
}

/** The item that holds a workout on its day. */
export async function itemOf(workoutId: string, athleteId: string, date: string, today: string): Promise<Item> {
  const items = itemsOfDay(await loadDay(athleteId, date), date, today);
  return items.find((item) => item.planned?.id === workoutId || item.completed?.id === workoutId) as Item;
}

async function latestItem(athlete: User, today: string): Promise<Item | null> {
  const { rows } = await pool.query<{ id: string; date: string }>(
    "SELECT id, date FROM workouts WHERE athlete_id = $1 AND kind = 'completed' ORDER BY date DESC, seq DESC LIMIT 1",
    [athlete.id]
  );
  const row = rows[0];
  return row ? itemOf(row.id, athlete.id, row.date, today) : null;
}

export async function athleteRows(user: User, today: string): Promise<AthleteRow[]> {
  const { rows } =
    user.role === 'athlete'
      ? { rows: [user] }
      : await pool.query<User>(
          `SELECT ${['id', 'role', 'name', 'email', 'tz', 'coach_code', 'series_start', 'start_ctl', 'start_atl'].map((c) => `u.${c}`).join(', ')}
             FROM users u JOIN links l ON l.athlete_id = u.id AND l.coach_id = $1 AND l.status = 'accepted' ORDER BY u.name, u.id`,
          [user.id]
        );
  return Promise.all(
    rows.map(async (athlete): Promise<AthleteRow> => {
      const [current] = await weekSummaries(athlete, today, [isoWeekOf(today)]);
      return {
        id: athlete.id,
        name: athlete.name,
        tz: athlete.tz,
        week: { week: current?.week ?? isoWeekOf(today), planned_tss: current?.planned_tss ?? 0, completed_tss: current?.completed_tss ?? 0 },
        latest: await latestItem(athlete, today)
      };
    })
  );
}
