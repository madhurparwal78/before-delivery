import type { Queryable } from '../db/pool.js';
import { toWorkout, workoutsBetween, type WorkoutRow } from '../db/workouts.js';
import { seriesDay } from '../db/records.js';
import type { UserRow } from '../db/users.js';
import { dayItems, emptyTally, tallyItems } from '../domain/compliance.js';
import { addDays, datesBetween, isoWeekOf, minDate, mondayOfWeek } from '../domain/time.js';
import type { Item, WeekSports, WeekView, Workout } from '../domain/types.js';

function splitDay(rows: readonly WorkoutRow[]): { planned: Workout[]; completed: Workout[] } {
  const planned: Workout[] = [];
  const completed: Workout[] = [];
  for (const row of rows) {
    const workout = toWorkout(row);
    if (workout.kind === 'planned') planned.push(workout);
    else completed.push(workout);
  }
  return { planned, completed };
}

export function sportsOfItems(items: readonly Item[]): WeekSports {
  const sports: WeekSports = { bike_tss: 0, run_tss: 0, bike_s: 0, run_s: 0, sessions: 0 };
  for (const item of items) {
    const completed = item.completed;
    if (!completed) continue;
    sports.sessions += 1;
    if (completed.sport === 'bike') {
      sports.bike_tss += completed.tss ?? 0;
      sports.bike_s += completed.duration_s;
    } else {
      sports.run_tss += completed.tss ?? 0;
      sports.run_s += completed.duration_s;
    }
  }
  return sports;
}

/** A week's form is the TSB of the earlier of the following Monday and today. */
export async function weekForm(
  client: Queryable,
  athlete: UserRow,
  monday: string,
  today: string,
): Promise<number> {
  const date = minDate(addDays(monday, 7), today);
  const day = await seriesDay(client, athlete.id, date);
  return day ? day.tsb : athlete.start_ctl - athlete.start_atl;
}

export async function buildWeek(
  client: Queryable,
  athlete: UserRow,
  week: string,
  today: string,
): Promise<WeekView> {
  const monday = mondayOfWeek(week);
  const sunday = addDays(monday, 6);
  const rows = await workoutsBetween(client, athlete.id, monday, sunday);
  const byDate = new Map<string, WorkoutRow[]>();
  for (const row of rows) {
    const list = byDate.get(row.date) ?? [];
    list.push(row);
    byDate.set(row.date, list);
  }
  const days = datesBetween(monday, sunday).map((date) => {
    const { planned, completed } = splitDay(byDate.get(date) ?? []);
    return { date, items: dayItems(planned, completed, date, today) };
  });
  const items = days.flatMap((day) => day.items);
  const plannedTssTotal = items.reduce(
    (total, item) => total + (item.planned?.planned_tss ?? 0),
    0,
  );
  const completedTssTotal = items.reduce((total, item) => total + (item.completed?.tss ?? 0), 0);
  return {
    week,
    monday,
    planned_tss: plannedTssTotal,
    completed_tss: completedTssTotal,
    tsb: await weekForm(client, athlete, monday, today),
    tally: items.length === 0 ? emptyTally() : tallyItems(items),
    sports: sportsOfItems(items),
    days,
  };
}

export async function buildWeeks(
  client: Queryable,
  athlete: UserRow,
  centre: string,
  before: number,
  after: number,
  today: string,
): Promise<WeekView[]> {
  const centreMonday = mondayOfWeek(centre);
  const weeks: WeekView[] = [];
  for (let offset = -before; offset <= after; offset += 1) {
    const week = isoWeekOf(addDays(centreMonday, offset * 7));
    weeks.push(await buildWeek(client, athlete, week, today));
  }
  return weeks;
}

/** The item a workout belongs to on its day, with its pairing and compliance. */
export async function itemForWorkout(
  client: Queryable,
  athleteId: string,
  workout: Workout,
  today: string,
): Promise<Item> {
  const rows = await workoutsBetween(client, athleteId, workout.date, workout.date);
  const { planned, completed } = splitDay(rows);
  const items = dayItems(planned, completed, workout.date, today);
  const found = items.find(
    (item) => item.planned?.id === workout.id || item.completed?.id === workout.id,
  );
  return found as Item;
}
